export type TextToken = [type: "t", value: string];
export type VariableToken = [type: "v", name: string];
export type WrapperToken = [type: "w", name: string, children: Token[]];
export type NewLineToken = [type: "n", value: string];

export type Token = TextToken | VariableToken | WrapperToken | NewLineToken;

export type ParamsDef = Record<string, "v" | "w">;

const newline_regex = /^(?:\r?\n|\r)/;

const syntax = {
	default: {
		var: /^\{\{\s*([a-z_][0-9a-z_]*)\s*}}/i,
		open: /^\{\{\s*#([a-z_][0-9a-z_]*)\s*}}/i,
		close: /^\{\{\s*\/([a-z_][0-9a-z_]*)\s*}}/i
	},
	laravel: {
		var: /^:([a-z_][0-9a-z_]*)/i,
		open: /^<([a-z_][0-9a-z_]*)>/i,
		close: /^<\/([a-z_][0-9a-z_]*)>/i
	}
};

export type SyntaxVariant = keyof typeof syntax;

const types = {
	v: "variable",
	w: "wrapper"
};

export class ParamTypeMismatch extends Error {
	#cursor: number;
	#param: string;
	#expected: "v" | "w";
	#actual: "v" | "w";

	get cursor() {
		return this.#cursor;
	}

	get param() {
		return this.#param;
	}

	get expected() {
		return this.#expected;
	}

	get actual() {
		return this.#actual;
	}

	constructor(
		param: string,
		cursor: number,
		expected: "v" | "w",
		actual: "v" | "w"
	) {
		super(
			`Parameter "${param}" type mismatch at ${cursor}: expected ${types[expected]}, got ${types[actual]}`
		);
		this.name = "ParamTypeMismatch";
		this.#cursor = cursor;
		this.#param = param;
		this.#expected = expected;
		this.#actual = actual;
	}
}

function appendText(tokens: Token[], text: string) {
	if (text.length === 0) return;
	if (!tokens.length) {
		tokens.push(["t", text]);
		return;
	}
	const last = tokens[tokens.length - 1]!;
	if (last[0] === "t") {
		last[1] += text;
	} else {
		tokens.push(["t", text]);
	}
}

function assertParam(
	name: string,
	cursor: number,
	params: Record<string, "v" | "w">,
	expected: "v" | "w"
) {
	if (!(name in params)) {
		params[name] = expected;
		return;
	}
	if (params[name] !== expected) {
		throw new ParamTypeMismatch(name, cursor, expected, params[name]!);
	}
}

export function tokenize(
	src: string,
	variant: SyntaxVariant = "default"
): [tokens: Token[], params: ParamsDef] {
	const {
		var: var_regex,
		open: open_regex,
		close: close_regex
	} = syntax[variant];

	const root: Token[] = [];

	const stack: [
		[name: string | null, Token[]],
		...[name: string | null, Token[]][]
	] = [[null, root]];

	const params: ParamsDef = {};

	for (let cursor = 0; cursor < src.length; ) {
		const [name, tokens] = stack[0];
		if (src[cursor]! === "\\") {
			if (cursor + 1 < src.length) {
				appendText(tokens, src[cursor + 1]!);
				cursor += 2;
			}
			continue;
		}
		const rest = src.slice(cursor);
		let match = rest.match(newline_regex);
		if (match) {
			tokens.push(["n", match[0]!]);
			cursor += match[0]!.length;
			continue;
		}
		match = rest.match(var_regex);
		if (match) {
			const next = match[1]!;
			assertParam(next, cursor, params, "v");
			tokens.push(["v", match[1]!]);
			cursor += match[0]!.length;
			continue;
		}
		match = rest.match(open_regex);
		if (match) {
			const next = match[1]!;
			assertParam(next, cursor, params, "w");
			const child: Token[] = [];
			tokens.push(["w", next, child]);
			stack.unshift([next, child]);
			cursor += match[0]!.length;
			continue;
		}
		if (name !== null) {
			match = rest.match(close_regex);
			if (match) {
				if (match[1] !== name) {
					const char = rest[0]!;
					appendText(tokens, char);
					cursor++;
					continue;
				}
				appendText(tokens, rest.slice(0, match.index));
				stack.shift();
				cursor += match[0]!.length;
				continue;
			}
		}
		const char = rest[0]!;
		appendText(tokens, char);
		cursor++;
	}

	return [root, params];
}
