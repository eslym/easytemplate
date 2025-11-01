# @eslym/easytemplate

A lightweight, type-safe template engine for JavaScript/TypeScript, designed for easy integration and extensibility. Includes a Vite plugin for template processing.

## Features

- **Type-safe template parsing and rendering**
- **Variable and wrapper support** for advanced templating
- **Vite plugin** for automatic template handling
- **Zero dependencies**, fast builds with Bun

## Installation

```bash
bun add @eslym/easytemplate
# or
npm install @eslym/easytemplate
```

## Usage

```typescript
import { tokenize, render } from "@eslym/easytemplate";

// Define a template
const template = "Hello, {{name}}!";

// Tokenize and render
const [tokens, params] = tokenize(template);
const output = render(tokens, { name: "World" }); // "Hello, World!"
```

## Template Syntax: Variables and Wrappers

### Variables

Variables are defined using double curly braces, e.g. `{{name}}`. When rendering, you provide a value for each variable:

```typescript
const template = "Hello, {{name}}!";
const [tokens, params] = tokenize(template);
const output = render(tokens, { name: "World" }); // "Hello, World!"
```

### Wrappers

Wrappers allow you to wrap content with custom logic or markup. They are defined using block syntax:

```
{{#bold}}This is bold text{{/bold}}
```

When rendering, you provide a wrapper function for the key:

```typescript
const template = "{{#bold}}This is bold text{{/bold}}";
const [tokens, params] = tokenize(template);
const output = render(tokens, {
	bold: (content) => `<b>${content}</b>`
}); // "<b>This is bold text</b>"
```

Wrappers can be nested and combined with variables for advanced templating.

## Vite Plugin

Integrate with Vite by importing the plugin from `@eslym/easytemplate/vite`.

### Example

```typescript
// vite.config.ts
import { easyTemplate } from "@eslym/easytemplate/vite";

export default {
	plugins: [
		easyTemplate({
			extensions: [".etmpl"] // your template file extensions
			// other options...
		})
	]
};
```

### Using Other File Formats (e.g., YAML)

You can use other file formats like YAML by providing a custom deserializer:

```typescript
import yaml from "js-yaml";
import { easyTemplate } from "@eslym/easytemplate/vite";

export default {
	plugins: [
		easyTemplate({
			extensions: { ".yaml": yaml.load } // use js-yaml to parse YAML files
			// other options...
		})
	]
};
```

#### How Object Keys Are Treated

When a template file (such as YAML or JSON) contains an object instead of a string, each key in the object is treated as a separate template name. For example, given a YAML file:

```yaml
greeting: "Hello, {{name}}!"
farewell: "Goodbye, {{name}}!"
```

This will generate two templates: `greeting` and `farewell`. You can reference and render them individually in your code:

```typescript
const templates = {
	greeting: "Hello, {{name}}!",
	farewell: "Goodbye, {{name}}!"
};
const [tokens, params] = tokenize(templates.greeting);
const output = render(tokens, { name: "World" }); // "Hello, World!"
```

Nested objects will be treated as nested template namespaces, accessible via dot notation (e.g., `messages.greeting`).

## Recommended Usage

Assuming your `*.lang.yaml` files are transformed by the Vite plugin, you can import them directly and use the exported template objects. The plugin automatically parses and exposes the templates for each locale.

```typescript
// Dynamically import all transformed YAML language files
const localeFiles = import.meta.glob("./*.lang.yaml");

const locales = {};
for (const [path, loader] of Object.entries(localeFiles)) {
	loader().then((mod) => {
		// The Vite plugin transforms each YAML file into a template object
		const name = path.match(/([^/]+)\.lang\.yaml$/)[1];
		locales[name] = mod.entries;
	});
}

// Usage: Access a template by locale and key
// e.g., locales["en"].greeting
// The value is ready to use with the template engine's render function
```

This approach lets you organize translations by file and locale, and access templates by key or namespace. The Vite plugin handles parsing and transformation, so you can use the result directly with the template engine's API.

## Development

- Build: `bun run build.ts`
- Type-check: `bunx tsc`

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE) for details.
