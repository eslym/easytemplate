import { type Plugin, createFilter } from "vite";
import { writeFile } from "fs/promises";
import { tokenize, type ParamsDef, type Token } from "./tokenizer";

type DeserializeFunction = (data: string) => any;

export type PluginOptions = {
	extensions: string | string[] | Record<string, DeserializeFunction>;
	include?: string | RegExp | (string | RegExp)[];
	exclude?: string | RegExp | (string | RegExp)[];
	deserialize?: DeserializeFunction;
	typescriptDeclarations?: boolean;
};

function ln(lines: string[]) {
	return lines.join("\n") + "\n";
}

function travel(
	id: string,
	obj: any,
	fn: (key: string, tokens: Token[], params: ParamsDef) => void,
	path: string[] = []
) {
	const type = typeof obj;
	if (type === "string") {
		const [tokens, params] = tokenize(obj);
		fn(path.join("."), tokens, params);
		return;
	}
	if (type === "object" || obj !== null) {
		for (const [key, value] of Object.entries(obj)) {
			travel(id, value, fn, path.concat(key));
		}
		return;
	}
	throw new Error(
		`Unexpected type '${type}' at '${["$", ...path].join(".")}'\n\tfile: ${id}`
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

	const dts = opts.typescriptDeclarations !== false;

	const defaultDeserialize: DeserializeFunction =
		opts.deserialize ?? ((data) => JSON.parse(data));

	const filter = createFilter(opts.include, opts.exclude);

	return {
		name: "@eslym/easytemplate",
		async transform(src, id) {
			if (!filter(id)) return null;
			if (!extensions.some((ext) => id.endsWith(ext))) {
				return null;
			}
			const deserialize =
				deserializers[
					extensions.find((ext) => id.endsWith(ext)) || ""
				] ?? defaultDeserialize;
			let data = deserialize(src);
			if (data instanceof Promise) {
				data = await data;
			}
			if (typeof data === "string") {
				const [tokens, params] = tokenize(data);
				if (dts) {
					const file = id + ".d.ts";
					await writeFile(
						file,
						ln([
							'import type { Token, PARAMS } from "@eslym/easytemplate";',
							"",
							`export const entry: Token[] & { [PARAMS]: ${JSON.stringify(params)} } };`
						])
					);
				}
				return `export const entry = ${JSON.stringify(tokens)};`;
			}
			const result = ["export const entries = {"];
			const definitions = [
				'import type { Token, PARAMS } from "@eslym/easytemplate";',
				"",
				"export const entries: {"
			];
			travel(id, data, (key, tokens, params) => {
				result.push(
					`\t${JSON.stringify(key)}: ${JSON.stringify(tokens)},`
				);
				definitions.push(
					`\t${JSON.stringify(key)}: Token[] & { [PARAMS]: ${JSON.stringify(params)} },`
				);
			});
			result.push("};");
			definitions.push("};");
			if (dts) {
				const file = id + ".d.ts";
				await writeFile(file, ln(definitions));
			}
			return ln(result);
		}
	} satisfies Plugin;
}
