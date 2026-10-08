// Measures looksLikeTask (Brainstorm: the dot of a probable task) on a fixed set of sentences:
//   node scripts/eval-task-detection.mjs [repo folder] [sentences.json]
// Defaults: this repository and test/fixtures/task-sentences.json. Prints, per language and in
// total, true and false positives, false negatives, precision, recall and F1, then every miss.
// Nothing is learned: looksLikeTask is called with the sentence alone.
import esbuild from "esbuild";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(process.argv[2] || here);
const fixture = path.resolve(process.argv[3] || path.join(here, "test/fixtures/task-sentences.json"));
const out = path.join(os.tmpdir(), `sk-eval-${process.pid}.cjs`);

await esbuild.build({
	entryPoints: [path.join(repo, "src/modules/sessions/logic.ts")],
	bundle: true,
	platform: "node",
	format: "cjs",
	outfile: out,
	alias: { obsidian: path.join(repo, "test/obsidian-mock.ts") },
	external: ["@codemirror/*", "@lezer/*"],
	logLevel: "error",
});
const { looksLikeTask } = createRequire(import.meta.url)(out);
fs.rmSync(out, { force: true });

const { sentences } = JSON.parse(fs.readFileSync(fixture, "utf8"));
const stats = new Map();
const misses = [];
for (const s of sentences) {
	const got = !!looksLikeTask(s.text);
	for (const key of [s.lang, "total"]) {
		const st = stats.get(key) ?? { n: 0, tp: 0, fp: 0, fn: 0, tn: 0 };
		st.n++;
		if (got && s.task) st.tp++;
		else if (got) st.fp++;
		else if (s.task) st.fn++;
		else st.tn++;
		stats.set(key, st);
	}
	if (got !== s.task) misses.push(`${s.lang} ${got ? "FP" : "FN"}  ${s.text}`);
}

const pct = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1) : "-").padStart(6);
const rows = [];
for (const key of ["fr", "en", "es", "nl", "total"]) {
	const st = stats.get(key);
	if (!st) continue;
	const p = st.tp / (st.tp + st.fp);
	const r = st.tp / (st.tp + st.fn);
	const f1 = (2 * p * r) / (p + r);
	rows.push({ key, ...st, p, r, f1 });
	console.log(`${key.padEnd(6)} n=${String(st.n).padStart(3)}  TP ${String(st.tp).padStart(3)}  FP ${String(st.fp).padStart(3)}  FN ${String(st.fn).padStart(3)}  P ${pct(p)}  R ${pct(r)}  F1 ${pct(f1)}`);
}
console.log(`\nMisses (${misses.length}):\n${misses.join("\n")}`);
if (process.env.EVAL_JSON) fs.writeFileSync(process.env.EVAL_JSON, JSON.stringify(rows, null, "\t"));
