// Checks one module on its own, even while other modules are half written:
//   node scripts/check-module.mjs <module-id>
// 1. Type-checks src/modules/<id> (and what it imports) plus test/<id>.test.ts.
// 2. Checks the module definition: id matches the folder, name and description, strings
//    complete in every language, defaults present.
// 3. Runs test/<id>.test.ts if it exists.
// 4. Scans the module's files for em dashes and the private words listed in .forbidden-words.
import esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const id = process.argv[2];
if (!id || !fs.existsSync(path.join(root, "src/modules", id, "index.ts"))) {
	console.error("Usage: node scripts/check-module.mjs <module-id> (src/modules/<id>/index.ts must exist)");
	process.exit(2);
}
const work = path.join(root, "test", ".out", `check-${id}`);
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
let failed = false;
const step = (name) => console.log(`\n== ${name}`);
const fail = (message) => {
	console.error(`FAIL: ${message}`);
	failed = true;
};

// 1. Types
step("Type check");
const testFile = path.join(root, "test", `${id}.test.ts`);
const tsconfig = {
	extends: path.join(root, "tsconfig.json").split(path.sep).join("/"),
	compilerOptions: { noEmit: true, skipLibCheck: true },
	include: [path.join(root, "src/modules", id).split(path.sep).join("/") + "/**/*.ts", ...(fs.existsSync(testFile) ? [testFile.split(path.sep).join("/")] : [])],
};
fs.writeFileSync(path.join(work, "tsconfig.json"), JSON.stringify(tsconfig, null, "\t"));
const tsc = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-p", path.join(work, "tsconfig.json")], { stdio: "inherit" });
if (tsc.status !== 0) fail("type errors");
else console.log("ok");

// 2 + 3. Definition, strings, tests
step("Definition, strings and tests");
const entry = path.join(work, "definition.test.ts");
fs.writeFileSync(
	entry,
	`import assert from "node:assert/strict";
import { test } from "node:test";
import * as exported from ${JSON.stringify(path.join(root, "src/modules", id, "index.ts").split(path.sep).join("/"))};
import { checkTable } from ${JSON.stringify(path.join(root, "test/i18n-check.ts").split(path.sep).join("/"))};
import { CATEGORY_ORDER } from ${JSON.stringify(path.join(root, "src/core/module.ts").split(path.sep).join("/"))};

test("module definition of ${id}", () => {
	const def = Object.values(exported).find((value) => value && typeof value === "object" && (value as { id?: string }).id === ${JSON.stringify(id)}) as any;
	assert.ok(def, "index.ts exports a defineModule({...}) whose id is the folder name");
	assert.ok(CATEGORY_ORDER.includes(def.category), "known category");
	assert.equal(typeof def.icon, "string");
	assert.equal(typeof def.activate, "function");
	assert.ok(def.defaults && typeof def.defaults === "object");
	assert.ok(def.strings.en["module.name"] && def.strings.en["module.description"]);
	checkTable(${JSON.stringify(id)}, def.strings);
});
`,
);
const entries = [entry, ...(fs.existsSync(testFile) ? [testFile] : [])];
try {
	const built = [];
	for (const file of entries) {
		const outfile = path.join(work, "js", path.basename(file).replace(/.ts$/, ".js"));
		await esbuild.build({
			entryPoints: [file],
			bundle: true,
			platform: "node",
			format: "cjs",
			target: "node20",
			outfile,
			alias: { obsidian: path.join(root, "test/obsidian-mock.ts") },
			external: ["@codemirror/*", "@lezer/*", "electron"],
			logLevel: "warning",
		});
		built.push(outfile);
	}
	const run = spawnSync(process.execPath, ["--test", ...built], { stdio: "inherit" });
	if (run.status !== 0) fail("tests");
} catch (error) {
	fail(`bundle: ${error.message}`);
}

// 4. Text scan
step("Text scan");
// Personal words that must never appear in the public code, one regular expression per line,
// in .forbidden-words at the repository root. That file is not versioned (the list itself is private).
const forbiddenFile = path.join(root, ".forbidden-words");
const forbiddenWords = fs.existsSync(forbiddenFile)
	? fs.readFileSync(forbiddenFile, "utf8").split(/\r?\n/).map((w) => w.trim()).filter(Boolean)
	: [];
if (!forbiddenWords.length) console.warn("No .forbidden-words file: the personal words scan is skipped.");
const FORBIDDEN = forbiddenWords.length ? new RegExp(forbiddenWords.join("|"), "i") : /(?!)/;
const files = [];
const walk = (dir) => {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(full);
		else files.push(full);
	}
};
walk(path.join(root, "src/modules", id));
for (const extra of [testFile, path.join(root, "docs", `${id}.md`)]) if (fs.existsSync(extra)) files.push(extra);
let hits = 0;
for (const file of files) {
	fs.readFileSync(file, "utf8")
		.split("\n")
		.forEach((line, index) => {
			const where = `${path.relative(root, file)}:${index + 1}`;
			if (line.includes("\u2014")) {
				console.error(`${where}: em dash`);
				hits++;
			}
			// A class field with the name of an Obsidian View/Modal internal silently replaces it
			// (a `titleEl = null` field once kept a view from ever opening).
			const shadow = line.match(/^\s*(?:private|protected|public|declare)(?:\s+readonly)?\s+(titleEl|headerEl|contentEl|containerEl|modalEl|navigation|scope|leaf|icon|actionsEl|titleContainerEl)\s*[:=?!]/);
			if (shadow && /\.ts$/.test(file)) {
				console.error(`${where}: class field "${shadow[1]}" shadows an Obsidian internal, rename it`);
				hits++;
			}
			const match = line.match(FORBIDDEN);
			if (match) {
				console.error(`${where}: forbidden word "${match[0]}"`);
				hits++;
			}
		});
}
if (hits) fail(`${hits} text problem(s)`);
else console.log("ok");
if (!fs.existsSync(path.join(root, "docs", `${id}.md`))) fail(`docs/${id}.md is missing`);

console.log(failed ? `\n${id}: FAILED` : `\n${id}: all checks passed`);
process.exit(failed ? 1 : 0);
