// Runs every test/*.test.ts with Node's test runner. Each file is bundled by esbuild with
// `obsidian` replaced by test/obsidian-mock.ts, so pure code runs without Obsidian.
// Usage: npm test            (all)   ·   node test/run.mjs move-text   (files containing "move-text")
import esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(dir, ".out");
const filter = process.argv[2] || "";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".test.ts") && f.includes(filter));
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);

await esbuild.build({
	entryPoints: files.map((f) => path.join(dir, f)),
	bundle: true,
	platform: "node",
	format: "cjs",
	target: "node20",
	outdir: out,
	alias: { obsidian: path.join(dir, "obsidian-mock.ts") },
	external: ["@codemirror/*", "@lezer/*"],
	logLevel: "warning",
});

const built = fs.readdirSync(out).map((f) => path.join(out, f));
const result = spawnSync(process.execPath, ["--test", ...built], { stdio: "inherit" });
process.exit(result.status ?? 1);
