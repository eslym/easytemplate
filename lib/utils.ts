import { dirname, extname } from "path";
import { mkdir, writeFile, rename, exists } from "fs/promises";
import { xxHash32 } from "js-xxhash";

export function defaultDtsPath(id: string) {
	if (/\.[tj]s$/.test(id)) {
		return id.replace(/\.[tj]s$/, ".d.ts");
	} else if (id.endsWith(".d.ts")) {
		return id;
	}
	return id + ".d.ts";
}

export function wrapDtsFn(
	fn: (id: string) => string | boolean | null | undefined
) {
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

export async function writeFileSafe(path: string | false, data: string) {
	if (path === false) return;
	const dir = dirname(path);
	if (!(await exists(dir))) {
		await mkdir(dir, { recursive: true });
	}
	const atomic = path + "." + xxHash32(Math.random().toString()).toString(32);
	await writeFile(atomic, data);
	await rename(atomic, path);
}

export function filterWithExtensions(
	filter: (id: string) => boolean,
	extensions: string[],
	id: string
) {
	if (!filter(id)) return false;
	const ext = extname(id).toLowerCase();
	return extensions.includes(ext);
}

export function resolveDeserialize(
	serializers: Record<string, (code: string, id: string) => any>,
	defaultDeserializer: (code: string, id: string) => any,
	code: string,
	id: string
) {
	const ext = extname(id).toLowerCase();
	const deserializer = serializers[ext] ?? defaultDeserializer;
	return deserializer(code, id);
}
