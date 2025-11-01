import {
	code,
	type CodeBuilder,
	join,
	type Stringable,
	substringStringify
} from "./builder";
import { tokenize, type SyntaxVariant } from "./tokenizer";
import { name as packageName } from "../package.json";

type Passthru = <T>(fn: () => T) => T | undefined;

const defaults = {
	emitTs: true,
	emitParams: false,
	emitPath: false
};

function when(condition: boolean): Passthru {
	if (condition) {
		return (fn) => fn();
	}
	return () => undefined;
}

export interface CompileOptions {
	mode?: "dot" | "nested";
	syntax?: SyntaxVariant;
	emitTs?: boolean;
	emitParams?: boolean;
	emitPath?: boolean;
}

function setupImports(
	js: CodeBuilder,
	ts: CodeBuilder,
	whenTs: Passthru,
	emitParams: boolean,
	emitPath: boolean
) {
	const jsimports = js.imports().from(packageName);
	const tsimports = ts.imports().from(packageName);
	if (emitParams) {
		jsimports.import("PARAMS");
	}
	if (emitPath) {
		jsimports.import("PATH");
		whenTs(() => tsimports.import("PATH"));
	}
	jsimports.import("TOKENS");
	whenTs(() => tsimports.import("TOKENS").import("PARAMS").import("Token"));
}

function setupDeclarations(js: CodeBuilder) {
	const declarations = js.declarations();

	declarations.lookup('"v"', "v").threshold(3);
	declarations.lookup('"t"', "t").threshold(3);
	declarations.lookup('"w"', "w").threshold(3);
	declarations.lookup('"n"', "n").threshold(3);

	return declarations;
}

function compileJsMeta(
	emitParams: boolean,
	emitPath: boolean,
	path: Stringable,
	params: Stringable
): CodeBuilder {
	const meta = code`{\n\t`.indent((sub) => {
		const parts: CodeBuilder[] = [code`[TOKENS]: true`];
		if (emitParams) {
			parts.push(code`[PARAMS]: ${params}`);
		}
		if (emitPath) {
			parts.push(code`[PATH]: ${path}`);
		}
		sub.append(join(parts, ",\n"));
	}).append`\n}`;
	return meta;
}

function compileTsMeta(
	emitPath: boolean,
	key: string,
	params: any
): CodeBuilder {
	const meta = code`{\n\t`.indent((sub) => {
		const parts: CodeBuilder[] = [code`[TOKENS]: true`];
		parts.push(code`[PARAMS]: ${JSON.stringify(params)}`);
		if (emitPath) {
			parts.push(code`[PATH]: ${JSON.stringify(key)}`);
		}
		sub.append(join(parts, ";\n"));
	}).append`\n}`;
	return meta;
}

function compileString(
	src: string,
	variant: SyntaxVariant = "default",
	emitTs = defaults.emitTs,
	emitParams = defaults.emitParams
): [js: string, ts: string | undefined] {
	const whenTs = when(emitTs);
	const js = code();
	const ts = code();

	setupImports(js, ts, whenTs, emitParams, false);

	const [tokens, params] = tokenize(src, variant);

	const meta = compileJsMeta(
		emitParams,
		false,
		null,
		code(JSON.stringify(params))
	);

	js.line`export const entry Object.assign(${JSON.stringify(tokens)}, ${meta});`;
	js.line`export default entry;`;

	whenTs(() => {
		ts.line`export const entry: Token[] & ${compileTsMeta(false, "", params)};`;
		ts.line`export default entry;`;
	});

	return [js.toString(), whenTs(() => ts.toString())];
}

function travel(
	cb: (path: string[], val: string) => void,
	obj: any,
	path: string[]
) {
	if (typeof obj === "string") {
		cb(path, obj);
		return;
	}
	if (!obj || typeof obj !== "object") {
		throw new Error(`Unexpected value at '${["$", ...path].join(".")}'`);
	}
	for (const [key, value] of Object.entries(obj)) {
		travel(cb, value, path.concat(key));
	}
}

function compileDot(
	src: any,
	variant: SyntaxVariant = "default",
	emitTs = defaults.emitTs,
	emitParams = defaults.emitParams,
	emitPath = defaults.emitPath
): [js: string, ts: string | undefined] {
	const whenTs = when(emitTs);
	const js = code();
	const ts = code();

	setupImports(js, ts, whenTs, emitParams, emitPath);

	const decls = setupDeclarations(js);
	const oa = decls.lookup("Object.assign", "oa").threshold(0);
	const dfn = decls.lookup("(...p)=>p.join('.')", "d").threshold(0);

	const str = substringStringify.bind(null, decls);

	const jsentries = new Map<CodeBuilder, CodeBuilder>();
	const tsentries: Record<string, CodeBuilder> = {};

	travel(
		(path, val) => {
			const key = path.join(".");
			const dparams = join(
				path.map((p) => str(p)),
				","
			);

			const [tokens, params] = tokenize(val, variant);

			const entryKey = code`${dfn.incr()}(${dparams})`;

			const meta = compileJsMeta(
				emitParams,
				emitPath,
				entryKey,
				code`${str(params, ", ")}`
			);
			const entryVal = code`${oa.incr()}(${str(tokens)}, ${meta})`;
			jsentries.set(code`[${entryKey}]`, entryVal);

			whenTs(() => {
				const meta = compileTsMeta(emitPath, key, params);
				tsentries[key] = code`Token[] & ${meta}`;
			});
		},
		src,
		[]
	);

	js.line`export const entries = ${str(jsentries)};`;
	js.line`export default entries;`;

	whenTs(() => {
		ts.line`export const entries: ${str(tsentries, ";\n")}`;
		ts.line`export default entries;`;
		ts.line`export type Entries = typeof entries;`;
	});

	return [js.toString(), whenTs(() => ts.toString())];
}

function compileNested(
	src: any,
	variant: SyntaxVariant = "default",
	emitTs = defaults.emitTs,
	emitParams = defaults.emitParams,
	emitPath = defaults.emitPath
): [js: string, ts: string | undefined] {
	const whenTs = when(emitTs);
	const js = code();
	const ts = code();

	setupImports(js, ts, whenTs, emitParams, emitPath);

	const decls = setupDeclarations(js);
	const oa = decls.lookup("Object.assign", "oa").threshold(0);

	function walk(
		obj: any,
		path: string[]
	): [Stringable, Stringable | undefined] {
		if (typeof obj === "string") {
			const [tokens, params] = tokenize(obj, variant);
			const str = substringStringify.bind(null, decls);

			const entryKey = emitPath ? code`${str(path.join("."))}` : null;
			const meta = compileJsMeta(
				emitParams,
				emitPath,
				entryKey,
				code`${str(params, ", ")}`
			);
			return [
				code`${oa.incr()}(${str(tokens)}, ${meta})`,
				whenTs(
					() =>
						code`Token[] & ${compileTsMeta(
							emitPath,
							path.join("."),
							params
						)}`
				)
			];
		}
		if (!obj || typeof obj !== "object") {
			throw new Error(
				`Unexpected value at '${["$", ...path].join(".")}'`
			);
		}
		const entries: [
			Stringable,
			Stringable,
			string,
			Stringable | undefined
		][] = [];
		for (const [key, value] of Object.entries(obj)) {
			const [subJs, subTs] = walk(value, path.concat(key));
			entries.push([
				decls.lookup(JSON.stringify(key)).incr().accessor(),
				subJs,
				JSON.stringify(key),
				subTs
			]);
		}
		const jsObj = code`{\n\t`.indent((sub) =>
			sub.append(
				join(
					entries.map(([k, v]) => code`${k}: ${v}`),
					",\n"
				)
			)
		).append`\n}`;

		const tsObj = whenTs(
			() =>
				code`{\n\t`.indent((sub) =>
					sub.append(
						join(
							entries.map(([, , k, v]) => code`${k}: ${v}`),
							";\n"
						)
					)
				).append`\n}`
		);
		return [jsObj, tsObj];
	}

	const [jsObj, tsObj] = walk(src, []);

	js.line`export const entries = ${jsObj};`;
	js.line`export default entries;`;

	whenTs(() => {
		ts.line`export const entries: ${tsObj};`;
		ts.line`export default entries;`;
		ts.line`export type Entries = typeof entries;`;
	});

	return [js.toString(), whenTs(() => ts.toString())];
}

export function compile(
	object: any,
	options: CompileOptions = {}
): [js: string, ts: string | undefined] {
	if (typeof object === "string") {
		return compileString(
			object,
			options.syntax,
			options.emitTs,
			options.emitParams
		);
	}
	if (options.mode === "nested") {
		return compileNested(
			object,
			options.syntax,
			options.emitTs,
			options.emitParams,
			options.emitPath
		);
	}
	return compileDot(
		object,
		options.syntax,
		options.emitTs,
		options.emitParams,
		options.emitPath
	);
}
