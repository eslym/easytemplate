await Bun.$`rm -rf ./dist`;
await Bun.build({
	entrypoints: ["lib/index.ts", "lib/vite.ts"],
	splitting: true,
	minify: true,
	sourcemap: true,
	target: "node",
	format: "esm",
	outdir: "./dist/esm",
	external: ["vite"]
});
await Bun.build({
	entrypoints: ["lib/index.ts", "lib/vite.ts"],
	splitting: true,
	minify: true,
	sourcemap: true,
	target: "node",
	format: "cjs",
	outdir: "./dist/cjs",
	external: ["vite"]
});
await Bun.$`bunx tsc`;

export {};
