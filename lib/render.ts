import type { ParamsDef, Token } from "./tokenizer";

export const PARAMS = Symbol("params");

export type Param = { toString(): string } | null | undefined;
export type Wrapper =
	| ((content: string) => { toString(): string })
	| null
	| undefined;

type Prettify<T> = { [K in keyof T]: T[K] } & {};

type TranslationParams<T extends ParamsDef> = Prettify<{
	[P in keyof T]?: T[P] extends "v" ? Param : Wrapper;
}>;

export function render<D extends ParamsDef>(
	tokens: Token[] & { [PARAMS]?: D },
	params: TranslationParams<D>
): string {
	return tokens
		.map((t) => {
			switch (t[0]) {
				case "t":
					return t[1];
				case "v": {
					const val = params[t[1] as keyof typeof params];
					if (val === null || val === undefined) return "";
					return String(val);
				}
				case "w": {
					const wrapper = params[t[1] as keyof typeof params];
					const content = render(t[2] as any, params);
					if (typeof wrapper === "function") {
						return String(wrapper(content));
					}
					return content;
				}
				default:
					return "";
			}
		})
		.join("");
}

export function render_func<D extends ParamsDef>(
	tokens: Token[] & { [PARAMS]?: D }
): (params: TranslationParams<D>) => string {
	return (params) => render(tokens, params);
}
