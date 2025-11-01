import type { DeserializeFunction } from "./types";
import type { Plugin } from "rollup";
import { name as packageName, version } from "../package.json";
import { createFilter } from "vite";
import { compile, type CompileOptions } from "./compile";
import {
	defaultDtsPath,
	filterWithExtensions,
	resolveDeserialize,
	wrapDtsFn,
	writeFileSafe
} from "./utils";
import type { SyntaxVariant } from "./tokenizer";

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

	/**
	 * Emit path information in the generated metadata.
	 * @default false
	 */
	emitPath?: boolean;

	/**
	 * Emit parameter information in the generated metadata.
	 * @default false
	 */
	emitParams?: boolean;

	/**
	 * Variant of template syntax to use.
	 * @default "default"
	 */
	syntax?: SyntaxVariant;
};

async function transform(
	filter: (id: string) => boolean,
	deserialize: DeserializeFunction,
	dts: (id: string) => string | false,
	compileOptions: CompileOptions,
	code: string,
	id: string
) {
	if (!filter(id)) return null;
	const data = deserialize(code, id);
	const dtsPath = dts(id);
	const [compiledCode, dtsDef] = compile(data, {
		...compileOptions,
		emitTs: dtsPath !== false
	});

	if (dtsPath !== false) {
		await writeFileSafe(dtsPath, dtsDef!);
	}

	return compiledCode;
}

export function easyTemplate(options: PluginOptions) {
	const extensions = (
		Array.isArray(options.extensions)
			? options.extensions
			: typeof options.extensions === "string"
				? [options.extensions]
				: Object.keys(options.extensions || {})
	).map((ext) => ext.toLowerCase());

	const deserializers: Record<string, DeserializeFunction> =
		Object.fromEntries(
			Object.entries(
				typeof options.extensions === "object" &&
					!Array.isArray(options.extensions)
					? options.extensions
					: {}
			).map(([ext, fn]) => [ext.toLowerCase(), fn] as const)
		);

	const filter = filterWithExtensions.bind(
		null,
		createFilter(options.include, options.exclude),
		extensions
	);

	const deserialize = resolveDeserialize.bind(
		null,
		deserializers,
		options.deserialize ?? ((data) => JSON.parse(data))
	);

	const dts =
		typeof options.typescriptDeclarations === "function"
			? wrapDtsFn(options.typescriptDeclarations)
			: defaultDtsPath;

	const compileOptions: CompileOptions = {
		mode: options.mode ?? "dot",
		syntax: options.syntax ?? "default",
		emitPath: options.emitPath ?? false,
		emitParams: options.emitParams ?? false
	};

	return {
		name: packageName,
		version,
		transform: transform.bind(
			null,
			filter,
			deserialize,
			dts,
			compileOptions
		)
	} satisfies Plugin;
}
export default easyTemplate;
