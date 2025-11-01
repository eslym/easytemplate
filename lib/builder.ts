import { xxHash32 } from "js-xxhash";

export type Stringable =
	| { toString(): string }
	| IterateString
	| undefined
	| null
	| false;

function* chars(parts: Iterable<Stringable>): Iterable<string> {
	for (const obj of parts) {
		if (!obj) {
		} else if (typeof obj === "string") {
			yield* obj;
		} else if (obj instanceof IterateString) {
			yield* chars(obj.iterateString());
		} else {
			yield* obj.toString();
		}
	}
}

function* pass(
	template: TemplateStringsArray,
	...args: Stringable[]
): Iterable<Stringable> {
	for (let i = 0; i < args.length; i++) {
		yield template[i]!;
		yield args[i]!;
	}
	yield template[template.length - 1]!;
}

abstract class IterateString {
	toString(): string {
		return Array.from(this.iterateString()).join("");
	}

	*[Symbol.iterator]() {
		yield* chars(this.iterateString());
	}

	abstract iterateString(): Iterable<Stringable>;
}

export class CodeBuilder extends IterateString {
	#indent = 0;
	#parts: Stringable[] = [];

	constructor(...parts: Stringable[]) {
		super();
		this.#parts.push(...parts);
	}

	placeholder() {
		const part = new CodeBuilder();
		this.#parts.push(part);
		return part;
	}

	declarations() {
		const decls = new Declarations();
		this.#parts.push(decls);
		return decls;
	}

	imports() {
		const imps = new Imports();
		this.#parts.push(imps);
		return imps;
	}

	indent(callback: (builder: CodeBuilder) => void) {
		const child = new CodeBuilder();
		child.#indent = this.#indent + 1;
		callback(child);
		this.#parts.push(child);
		return this;
	}

	append(arr: TemplateStringsArray, ...args: Stringable[]): this;
	append(item: Stringable, ...rest: Stringable[]): this;
	append(...params: any): this {
		if (Array.isArray(params[0]) && "raw" in params[0]) {
			const [arr, ...args] = params;
			for (let i = 0; i < args.length; i++) {
				this.#parts.push(arr[i]!);
				this.#parts.push(args[i]!);
			}
			this.#parts.push(arr[arr.length - 1]!);
			return this;
		}
		this.#parts.push(...params);
		return this;
	}

	line(arr: TemplateStringsArray, ...args: Stringable[]): this;
	line(item: Stringable, ...rest: Stringable[]): this;
	line(...params: any): this {
		(this.append as any)(...params);
		this.#parts.push("\n");
		return this;
	}

	*iterateString(): Iterable<string> {
		for (const char of chars(this.#parts)) {
			if (char === "\n") {
				yield char;
				yield "\t".repeat(this.#indent);
			} else {
				yield char;
			}
		}
	}
}

export class Join extends IterateString {
	#parts: Stringable[];
	#separator: Stringable;

	constructor(parts: Stringable[], separator: Stringable) {
		super();
		this.#parts = parts;
		this.#separator = separator;
	}

	*iterateString(): Iterable<Stringable> {
		const parts = this.#parts.filter(
			(part) => part !== null && part !== undefined && part !== false
		);
		const len = parts.length;
		for (let i = 0; i < len; i++) {
			yield parts[i];
			if (i < len - 1) {
				yield this.#separator;
			}
		}
	}
}

export class Declaration {
	#key: string;
	#value: string;
	#occurences: number = 0;
	#threshold: number = 2;

	get occurences() {
		return this.#occurences;
	}

	get key() {
		return this.#key;
	}

	get value() {
		return this.#value;
	}

	constructor(key: string, value: string) {
		this.#key = key;
		this.#value = value;
	}

	incr<T>(passthru: T): T;
	incr(): this;
	incr(...args: [any?]): any {
		this.#occurences++;
		if (args.length > 0) {
			return args[0];
		}
		return this;
	}

	threshold(threshold: number) {
		this.#threshold = threshold;
		return this;
	}

	shouldInline() {
		return this.#occurences <= this.#threshold;
	}

	accessor(accessor = true): Declaration | Accessor {
		if (accessor) {
			return new Accessor(this);
		}
		return this;
	}

	toString() {
		return this.shouldInline() ? this.#value : this.#key;
	}
}

export class Accessor {
	#declaration: Declaration;

	get declaration() {
		return this.#declaration;
	}

	constructor(declaration: Declaration) {
		this.#declaration = declaration;
	}

	toString() {
		return this.#declaration.shouldInline()
			? this.#declaration.value
			: `[${this.#declaration.key}]`;
	}
}

export class Declarations extends IterateString {
	#values = new Map<string, Declaration>();

	lookup(value: string, as: string | null = null): Declaration {
		let v = this.#values.get(value);
		if (v) {
			return v;
		}
		const key = as ?? "_" + xxHash32(value).toString(32);
		v = new Declaration(key, value);
		this.#values.set(value, v);
		return v;
	}

	*iterateString() {
		for (const v of this.#values.values()) {
			if (v.shouldInline() || v.occurences === 0) continue;
			yield `const ${v.key} = ${v.value};\n`;
		}
	}
}

export class ImportEntry extends IterateString {
	#imports = new Map<string, string>();
	#type = false;
	#sideEffects: boolean = false;

	get size() {
		return this.#imports.size;
	}

	get isType() {
		return this.#type;
	}

	omit() {
		return this.#imports.size === 0 && !this.#sideEffects;
	}

	type(value: boolean = true): this {
		this.#type = value;
		return this;
	}

	sideEffects(value: boolean = true): this {
		this.#sideEffects = value;
		return this;
	}

	import(val: string, as?: string): this;
	import(entries: Record<string, string>): this;
	import(val: string | Record<string, string>, as?: string): this {
		if (typeof val === "string") {
			this.#imports.set(as ?? val, val);
		} else {
			for (const [k, v] of Object.entries(val)) {
				this.#imports.set(k, v);
			}
		}
		return this;
	}

	iterateString(): Iterable<Stringable> {
		return join(
			Array.from(this.#imports.entries()).map(([as, val]) => {
				if (as === val) {
					return code(val);
				} else {
					return code`${val} as ${as}`;
				}
			}),
			", "
		).iterateString();
	}
}

export class Imports extends IterateString {
	#froms = new Map<string, ImportEntry>();

	from(module: string): ImportEntry {
		let iv = this.#froms.get(module);
		if (!iv) {
			iv = new ImportEntry();
			this.#froms.set(module, iv);
		}
		return iv;
	}

	*iterateString(): Iterable<Stringable> {
		for (const [module, imports] of this.#froms.entries()) {
			if (imports.omit()) continue;
			if (imports.size === 0) {
				yield* pass`import ${imports.isType && "type "}${JSON.stringify(module)};\n`;
				continue;
			}
			yield* pass`import ${imports.isType && "type "}{ ${imports} } from ${JSON.stringify(module)};\n`;
		}
	}
}

export function code(
	template: TemplateStringsArray,
	...args: Stringable[]
): CodeBuilder;
export function code(...initial: Stringable[]): CodeBuilder;
export function code(...args: any[]): CodeBuilder {
	if (Array.isArray(args[0]) && "raw" in args[0]) {
		const arr = args[0] as TemplateStringsArray;
		const parts = args.slice(1) as Stringable[];
		const builder = new CodeBuilder();
		return builder.append(arr, ...parts);
	}
	return new CodeBuilder(...args);
}

export function join(parts: Stringable[], separator: Stringable = ", "): Join {
	return new Join(parts, separator);
}

export function substringStringify(
	definitions: Declarations,
	obj: any,
	delimiter: string = ",\n",
	accessor: boolean = false
): Stringable {
	if (typeof obj === "string") {
		return definitions
			.lookup(JSON.stringify(obj))
			.incr()
			.accessor(accessor);
	}
	if (obj instanceof IterateString) {
		return obj;
	}
	if (typeof obj === "number" || typeof obj === "boolean") {
		return obj.toString();
	}
	if (obj === null) {
		return "null";
	}
	if (Array.isArray(obj)) {
		return code`[${join(
			obj.map((item) => substringStringify(definitions, item)),
			", "
		)}]`;
	}
	const entries = (
		obj instanceof Map ? Array.from(obj.entries()) : Object.entries(obj)
	).map(
		([k, v]) =>
			code`${substringStringify(definitions, k, delimiter, true)}: ${substringStringify(definitions, v, delimiter)}`
	);
	if (entries.length === 0) {
		return "{}";
	}
	return code`{\n\t`.indent((sub) => {
		sub.append(join(entries, delimiter));
	}).append`\n}`;
}
