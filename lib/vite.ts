import type { Plugin } from "rollup";
import { createFilter } from "vite";
import { dirname } from "path";
import { writeFile, exists, mkdir } from "fs/promises";
import { tokenize, type ParamsDef, type Token } from "./tokenizer";
import { hashName, T } from "./generator";

type DeserializeFunction = (data: string, filename: string) => any;

const dfn = T.fn`d`;

function defaultDtsPath(id: string) {
	if (/\.[tj]s$/.test(id)) {
		return id.replace(/\.[tj]s$/, ".d.ts");
	} else if (id.endsWith(".d.ts")) {
		return id;
	}
	return id + ".d.ts";
}

function wrapDtsFn(fn: (id: string) => string | boolean | null | undefined) {
	return (id: string) => {
		const result = fn(id);
		if (typeof result === "string") {
			return result;
		}
		if (result === true) {
			return defaultDtsPath(id);
		}
		return false;
	};
}

async function writeFileSafe(path: string | false, data: string) {
	if (path === false) return;
	const dir = dirname(path);
	if (!(await exists(dir))) {
		await mkdir(dir, { recursive: true });
	}
	await writeFile(path, data);
}

export type PluginOptions = {
	/**
	 * File extensions to process.
	 * Can be a string, array of strings, or an object mapping extensions to deserialization functions.
	 */
	extensions: string | string[] | Record<string, DeserializeFunction>;

	/**
	 * Files to include.
	 */
	include?: string | RegExp | (string | RegExp)[];

	/**
	 * Files to exclude.
	 */
	exclude?: string | RegExp | (string | RegExp)[];

	/**
	 * Custom deserialization function for file contents.
	 * @default JSON.parse
	 */
	deserialize?: DeserializeFunction;

	/**
	 * Generate TypeScript declaration files.
	 * Can be a boolean or a function that returns the declaration file path.
	 * @default false
	 */
	typescriptDeclarations?:
		| ((id: string) => string | boolean | null | undefined)
		| boolean;

	/**
	 * Mode for generated code structure.
	 * "dot" for flat structure using dot notation, "nested" for nested object structure.
	 * @default "dot"
	 */
	mode?: "dot" | "nested";
};

function travelDot(
	id: string,
	obj: any,
	fn: (path: string[], tokens: Token[], params: ParamsDef) => void,
	path: string[] = []
) {
	const type = typeof obj;
	if (type === "string") {
		const [tokens, params] = tokenize(obj);
		fn(path, tokens, params);
		return;
	}
	if (type === "object" || obj !== null) {
		for (const [key, value] of Object.entries(obj)) {
			travelDot(id, value, fn, path.concat(key));
		}
		return;
	}
	throw new Error(
		`Unexpected '${type ? `type ${type}` : "null"}' at '${["$", ...path].join(".")}'\n\tfile: ${id}`
	);
}

async function transformStringOnly(
	data: string,
	id: string,
	dts: (id: string) => string | false
) {
	const [tokens, params] = tokenize(data);
	await writeFileSafe(
		dts(id),
		T.str(
			T.lf([
				'import type { Token, PARAMS } from "@eslym/easytemplate";',
				"",
				`export const entry: Token[] & { [PARAMS]: ${JSON.stringify(params)} } };`
			])
		)
	);
	return `export const entry = ${JSON.stringify(tokens)};`;
}

async function transformDot(
	filter: (id: string) => boolean,
	extensions: string[],
	deserializers: Record<string, DeserializeFunction>,
	defaultDeserialize: DeserializeFunction,
	dts: (id: string) => string | false,
	id: string,
	src: string
) {
	if (!filter(id)) return null;
	if (!extensions.some((ext) => id.endsWith(ext))) {
		return null;
	}
	const deserialize =
		deserializers[extensions.find((ext) => id.endsWith(ext)) || ""] ??
		defaultDeserialize;
	let data = deserialize(src, id);
	if (data instanceof Promise) {
		data = await data;
	}
	if (typeof data === "string") {
		return transformStringOnly(data, id, dts);
	}
	const result: Iterable<string>[] = ["export const entries = {"];
	const definitions = [
		'import type { Token, PARAMS } from "@eslym/easytemplate";',
		"",
		"export const entries: {"
	];
	const variables = new Map<string, string>();
	travelDot(id, data, (path, tokens, params) => {
		let pathParts = [];
		for (const part of path) {
			const { name, wrapped } = hashName(part);
			if (part.length >= 4) {
				variables.set(name, `const ${name} = ${wrapped};`);
				pathParts.push(name);
			} else if (pathParts[pathParts.length - 1]?.[0] === '"') {
				const last: string = pathParts.pop()!;
				pathParts.push(
					last.substring(0, last.length - 1) + wrapped.substring(1)
				);
			} else {
				pathParts.push(wrapped);
			}
		}
		const pathString = T.code`[${pathParts.length > 1 ? dfn(...pathParts) : pathParts[0]!}]`;

		result.push(T.code`\t${pathString}: ${JSON.stringify(tokens)},`);

		definitions.push(
			`\t${JSON.stringify(path.join("."))}: Token[] & { [PARAMS]: ${JSON.stringify(params)} },`
		);
	});
	result.push("};");
	definitions.push("};");
	await writeFileSafe(dts(id), T.str(T.lf(definitions)));
	return T.str(
		T.lf(
			(
				[
					'const d = (...path) => path.join(".");',
					...variables.values()
				] as Iterable<string>[]
			).concat(result)
		)
	);
}

function travelNested(
	id: string,
	obj: any,
	path: string[],
	variables: Map<string, string>
): [code: Iterable<string>, dts: Iterable<string>] {
	const type = typeof obj;
	if (type === "string") {
		const [tokens, params] = tokenize(obj);
		return [
			T.code`${JSON.stringify(tokens)}`,
			T.code`Token[] & { [PARAMS]: ${JSON.stringify(params)} }`
		];
	}
	if (type !== "object" || obj === null) {
		throw new Error(
			`Unexpected '${type ? `type ${type}` : "null"}' at '${["$", ...path].join(".")}'\n\tfile: ${id}`
		);
	}
	const code: Iterable<string>[] = ["{"];
	const dts: Iterable<string>[] = ["{"];

	for (const [key, value] of Object.entries(obj)) {
		const [childCode, childDts] = travelNested(
			id,
			value,
			path.concat(key),
			variables
		);

		let hashed = hashName(key, JSON.stringify, true);

		if (key.length >= 4) {
			variables.set(
				hashed.name,
				`const ${hashed.name} = ${hashed.wrapped};`
			);
			code.push(T.code`\t${hashed.accessor}: ${T.indent(childCode)},`);
		} else {
			code.push(T.code`\t${hashed.wrapped}: ${T.indent(childCode)},`);
		}

		dts.push(T.code`\t${JSON.stringify(key)}: ${T.indent(childDts)},`);
	}
	code.push("}");
	dts.push("}");

	return [T.lf(code), T.lf(dts)];
}

async function transformNested(
	filter: (id: string) => boolean,
	extensions: string[],
	deserializers: Record<string, DeserializeFunction>,
	defaultDeserialize: DeserializeFunction,
	dts: (id: string) => string | false,
	id: string,
	src: string
) {
	if (!filter(id)) return null;
	if (!extensions.some((ext) => id.endsWith(ext))) {
		return null;
	}
	const deserialize =
		deserializers[extensions.find((ext) => id.endsWith(ext)) || ""] ??
		defaultDeserialize;
	let data = deserialize(src, id);
	if (data instanceof Promise) {
		data = await data;
	}
	if (typeof data === "string") {
		return transformStringOnly(data, id, dts);
	}
	const variables = new Map<string, string>();
	const [code, dtsDef] = travelNested(id, data, [], variables);
	await writeFileSafe(
		dts(id),
		T.str(
			T.lf([
				'import type { Token, PARAMS } from "@eslym/easytemplate";',
				"",
				T.code`export const entries: ${dtsDef};`
			])
		)
	);
	return T.str(
		T.lf([...variables.values(), T.code`export const entries = ${code};`])
	);
}

export function easyTemplate(opts = {} as PluginOptions) {
	const extensions =
		typeof opts.extensions === "string"
			? [opts.extensions]
			: Array.isArray(opts.extensions)
				? opts.extensions
				: Object.keys(opts.extensions || {});

	const deserializers: Record<string, DeserializeFunction> =
		typeof opts.extensions === "object" && !Array.isArray(opts.extensions)
			? opts.extensions
			: {};

	const dts =
		opts.typescriptDeclarations === true
			? defaultDtsPath
			: typeof opts.typescriptDeclarations === "function"
				? wrapDtsFn(opts.typescriptDeclarations)
				: () => false as const;

	const defaultDeserialize: DeserializeFunction =
		opts.deserialize ?? ((data) => JSON.parse(data));

	const filter = createFilter(opts.include, opts.exclude);

	const mode =
		(opts.mode ?? "dot") === "dot" ? transformDot : transformNested;

	return {
		name: "@eslym/easytemplate",
		transform: mode.bind(
			null,
			filter,
			extensions,
			deserializers,
			defaultDeserialize,
			dts
		)
	} satisfies Plugin<never>;
}
