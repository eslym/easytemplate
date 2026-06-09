import type { Plugin, PluginBuild } from "esbuild";
import { name as packageName } from "../package.json";
import { defaultDtsPath, exists, wrapDtsFn, writeFileSafe } from "./utils";
import { compile, type CompileOptions } from "./compile";
import { readFile } from "fs/promises";
import { resolve } from "path";
import type { PluginBuilder } from "bun";
import type { SyntaxVariant } from "./tokenizer";

const ESBUILD_NAMESPACE = "easytemplate";

export interface PluginOptions {
	filter: RegExp;
	deserialize?: (data: string, filename: string) => any;
	typescriptDeclarations?:
		| ((id: string) => string | boolean | null | undefined)
		| boolean;
	mode?: "dot" | "nested";
	syntax?: SyntaxVariant;
	emitPath?: boolean;
	emitParams?: boolean;
}

export function easyTemplate(options: PluginOptions) {
	const filter = options.filter;
	const deserialize = options.deserialize ?? ((data) => JSON.parse(data));

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
		setup(build: PluginBuild | PluginBuilder) {
			build.onResolve({ filter }, async ({ path, resolveDir }) => {
				if (path.includes("?")) {
					path = path.split("?")[0]!;
				}
				if (!(await exists(path))) {
					return null;
				}
				return {
					path: resolve(resolveDir, path),
					namespace: ESBUILD_NAMESPACE
				};
			});
			build.onLoad(
				{ filter: /.*/, namespace: ESBUILD_NAMESPACE },
				async (args) => {
					const code = await readFile(args.path, "utf-8");
					const data = deserialize(code, args.path);
					const dtsPath = dts(args.path);
					const [compiledCode, dtsDef] = compile(data, {
						...compileOptions,
						emitTs: dtsPath !== false
					});

					if (dtsPath !== false) {
						await writeFileSafe(dtsPath, dtsDef!);
					}

					return {
						contents: compiledCode,
						loader: "js"
					};
				}
			);
		}
	} satisfies Plugin;
}
export default easyTemplate;
