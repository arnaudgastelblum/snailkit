import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { App, CachedMetadata, TFile } from "obsidian";
import { normalizeTagName, renamedTag, renameTagInText } from "../src/core/tags/rename";

// The shared Obsidian mock has an intentionally empty getAllTags. Load the vault-facing
// exports with a local implementation, leaving the shared mock and other tests untouched.
const nodeRequire = createRequire(resolve("package.json"));
const { buildSync } = nodeRequire("esbuild") as typeof import("esbuild");
const compiled = buildSync({
	entryPoints: [resolve("src/core/tags/rename.ts")], bundle: true, write: false,
	platform: "node", format: "cjs", external: ["obsidian"],
}).outputFiles[0].text;
const loaded = { exports: {} as typeof import("../src/core/tags/rename") };
const readCaches: CachedMetadata[] = [];
new Function("module", "exports", "require", compiled)(loaded, loaded.exports, (name: string) => name === "obsidian" ? {
	getAllTags(cache: CachedMetadata) {
		readCaches.push(cache);
		const front = cache.frontmatter?.tags ?? cache.frontmatter?.tag ?? [];
		const tags = Array.isArray(front) ? front : String(front).split(",");
		return [...(cache.tags ?? []).map((tag) => tag.tag), ...tags.map((tag: string) => "#" + tag.replace(/^#/, "").trim())];
	},
} : nodeRequire(name));
const { planTagRename, applyTagRename } = loaded.exports;

test("normalization preserves spelling and accepts Unicode and tag punctuation", () => {
	for (const tag of ["Project/Web", "école/été", "项目/网站", "проект", "_", "-", "task-2", "123/task", "１２a", "a_b", "𐐀/𐐨"])
		assert.equal(normalizeTagName(` #${tag} \n`), tag);
	for (const tag of ["", "#", "##tag", "a b", "a\tb", "123", "１２３", "/tag", "tag/", "a//b", "a.b", "a:b", "a\\b", "a?b", "a#b", "a@b", "a🙂"])
		assert.equal(normalizeTagName(tag), null, tag);
});

test("renamedTag maps only complete case-insensitive paths and keeps suffix case", () => {
	assert.equal(renamedTag("PROJECT", "project", "Work"), "Work");
	assert.equal(renamedTag("Project/Web/API", "project", "Work"), "Work/Web/API");
	assert.equal(renamedTag("project/Web/API", "PROJECT/web", "Site"), "Site/API");
	assert.equal(renamedTag("#project/Web", "#project", "#Work"), "Work/Web");
	for (const tag of ["projectX", "project-x", "projects/x", "project_x", "other", "project//x"])
		assert.equal(renamedTag(tag, "project", "Work"), null);
	assert.equal(renamedTag("project", "", "Work"), null);
	assert.equal(renamedTag("project", "project", "bad tag"), null);
});

test("inline tags at every boundary, multiple occurrences and nested paths", () => {
	const input = "#project\n(#Project),#project; #project/Web/API! #other\nlast #PROJECT";
	assert.deepEqual(renameTagInText(input, "project", "Work"), {
		text: "#Work\n(#Work),#Work; #Work/Web/API! #other\nlast #Work", count: 5,
	});
	assert.deepEqual(renameTagInText("#project/Web #project/web/API #project/website", "project/web", "Site"), {
		text: "#Site #Site/API #project/website", count: 2,
	});
});

test("case-only renames work, exact spelling and invalid inputs do nothing", () => {
	assert.deepEqual(renameTagInText("#project #Project #PROJECT/Web", "PROJECT", "Project"), { text: "#Project #Project #Project/Web", count: 2 });
	for (const [from, to] of [["project", "project"], ["", "x"], ["project", "bad tag"]])
		assert.deepEqual(renameTagInText("#project", from, to), { text: "#project", count: 0 });
});

test("lookalikes, invalid paths, escaped hashes and embedded hashes stay unchanged", () => {
	const input = "#projectX #project-x #project_x #project2 #project//Web #project/ word#project 𐐀#project /#project \\#project ##project #123";
	assert.deepEqual(renameTagInText(input, "project", "Work"), { text: input, count: 0 });
	assert.deepEqual(renameTagInText("#项目/网站 #école/Été", "项目", "工作"), { text: "#工作/网站 #école/Été", count: 1 });
});

for (const [name, property, expected, count] of [
	["list", "tags:\n  - project\n  - '#Project/Web' # keep #project\n  - other\n  - #project", "tags:\n  - Work\n  - '#Work/Web' # keep #project\n  - other\n  - #Work", 3],
	["array", 'tags: [project, "#PROJECT/Web", other, #project] # keep #project', 'tags: [Work, "#Work/Web", other, #Work] # keep #project', 3],
	["single", "tag: '#Project' # keep #project", "tag: '#Work' # keep #project", 1],
	["comma string", 'tags: "project, #Project/Web, other"', 'tags: "Work, #Work/Web, other"', 2],
	["plain comma string", "tag: project, #project/Web, other", "tag: Work, #Work/Web, other", 2],
	["multiline array", 'tags: [\n  project,\n  "#project/Web",\n  other\n]', 'tags: [\n  Work,\n  "#Work/Web",\n  other\n]', 2],
	["unindented list", "tags:\n- project\n- other", "tags:\n- Work\n- other", 1],
] as const) {
	test(`frontmatter ${name} preserves all formatting and other properties`, () => {
		const wrap = (value: string) => `---\ntitle: '#project'\n${value}\naliases: [project, '#project']\n---\n#project`;
		assert.deepEqual(renameTagInText(wrap(property), "project", "Work"), { text: wrap(expected).replace(/#project$/, "#Work"), count: count + 1 });
	});
}

test("frontmatter without tags, nested properties and block strings are preserved", () => {
	for (const header of ["title: '#project'", "parent:\n  tags: [project]", "tags: |\n  #project", "description: |\n  tags: project", "tags: [projectX, project-x, other]"])
		assert.deepEqual(renameTagInText(`---\n${header}\n---\n#project`, "project", "Work"), { text: `---\n${header}\n---\n#Work`, count: 1 });
});

test("flow array comments and bracket characters in trailing comments stay unchanged", () => {
	const input = "---\ntags: [\n # explanation\n project,\n other\n] # [#project]\n---";
	assert.deepEqual(renameTagInText(input, "project", "Work"), { text: input.replace(" project,", " Work,"), count: 1 });
	const single = "---\ntags: [project] # [#project]\n---";
	assert.deepEqual(renameTagInText(single, "project", "Work"), { text: single.replace("[project]", "[Work]"), count: 1 });
});

test("CRLF, BOM, whitespace, quotes and missing final newline are kept byte for byte", () => {
	const input = '\uFEFF---\r\n"tags" :  [ "#project", other ]\r\n...\r\n(#project)\r\n#project/Web';
	assert.deepEqual(renameTagInText(input, "project", "Work"), { text: input.replaceAll("#project", "#Work"), count: 3 });
});

test("backtick and tilde fences respect marker type, length and closing suffix", () => {
	for (const marker of ["```", "~~~~"]) {
		const input = `${marker}ts\n#project\n${marker.slice(1)}\n#project\n${marker} not closed\n#project\n${marker}\n#project`;
		assert.deepEqual(renameTagInText(input, "project", "Work"), { text: input.replace(/#project$/, "#Work"), count: 1 });
	}
	assert.deepEqual(renameTagInText("```\n#project", "project", "Work"), { text: "```\n#project", count: 0 });
});

test("inline code and both multiline comment forms are protected", () => {
	const input = "`#project` ``a ` #project`` `multi\n#project` <!-- #project\n#project --> %% #project\n#project %% #project";
	assert.deepEqual(renameTagInText(input, "project", "Work"), { text: input.replace(/#project$/, "#Work"), count: 1 });
	for (const input of ["<!-- #project", "%% #project"])
		assert.deepEqual(renameTagInText(input, "project", "Work"), { text: input, count: 0 });
});

test("fences inside comments do not hide later tags and comments inside fences stay inert", () => {
	for (const input of ["<!--\n```\n-->\n#project", "%%\n~~~\n%%\n#project", "```\n<!--\n```\n#project"])
		assert.deepEqual(renameTagInText(input, "project", "Work"), { text: input.replace(/#project$/, "#Work"), count: 1 });
	assert.deepEqual(renameTagInText("[plain #project]", "project", "Work"), { text: "[plain #Work]", count: 1 });
});

test("wiki links, Markdown links, images, reference links and URLs are protected", () => {
	const input = "[[Note#project|#project]] ![[#project]] [#project](url#project) ![#project](a(b)#project) [#project][ref]\n[ref]: https://example.test/#project \"#project\"\nhttps://example.test/#project https://example.test/?q=#project <https://example.test/#project> www.example.test/#project obsidian://open#project #project";
	assert.deepEqual(renameTagInText(input, "project", "Work"), { text: input.replace(/#project$/, "#Work"), count: 1 });
	const bare = "example.test?q=#project example.test/#project example.test#project #project";
	assert.deepEqual(renameTagInText(bare, "project", "Work"), { text: bare.replace(/#project$/, "#Work"), count: 1 });
});

function fakeVault(contents: Record<string, string>, metadata: Record<string, string[] | null>) {
	const files = Object.keys(contents).map((path) => ({ path }) as TFile);
	const reads: string[] = [];
	const processes: string[] = [];
	let beforeProcess: ((file: TFile) => void) | undefined;
	const app = {
		metadataCache: { getFileCache: (file: TFile) => metadata[file.path] === null ? null : { tags: (metadata[file.path] ?? []).map((tag) => ({ tag })) } },
		vault: {
			getMarkdownFiles: () => files,
			cachedRead: async (file: TFile) => { reads.push(file.path); return contents[file.path]; },
			process: async (file: TFile, update: (text: string) => string) => {
				processes.push(file.path);
				beforeProcess?.(file);
				if (!(file.path in contents)) throw new Error("File removed");
				contents[file.path] = update(contents[file.path]);
				return contents[file.path];
			},
		},
	} as unknown as App;
	return { app, contents, reads, processes, beforeProcess: (callback?: (file: TFile) => void) => { beforeProcess = callback; } };
}

test("plan filters with getAllTags and counts actual content without writing", async () => {
	const vault = fakeVault({ "A.md": "#project #Project/Web", "B.md": "`#project`", "C.md": "#projectX", "D.md": "#project", "E.md": "#work" }, {
		"A.md": ["#PROJECT"], "B.md": ["#project"], "C.md": ["#projectX"], "D.md": null, "E.md": ["#work"],
	});
	const before = { ...vault.contents };
	const initial = readCaches.length;
	assert.deepEqual(await planTagRename(vault.app, "project", "Work"), { files: [{ path: "A.md", count: 2 }], total: 2, merges: true });
	assert.equal(readCaches.length - initial, 4);
	assert.deepEqual(vault.reads, ["A.md", "B.md"]);
	assert.deepEqual(vault.processes, []);
	assert.deepEqual(vault.contents, before);
});

test("merge detection checks descendant targets case-insensitively, not unrelated descendants", async () => {
	for (const [existing, merges] of [["#WORK/Web", true], ["#work/Other", false], ["#work", true]] as const) {
		const { app } = fakeVault({ "A.md": "#project/Web", "B.md": existing }, { "A.md": ["#project/Web"], "B.md": [existing] });
		assert.equal((await planTagRename(app, "project", "Work")).merges, merges);
	}
	const { app } = fakeVault({ "A.md": "#project #Project/Web" }, { "A.md": ["#project", "#Project/Web"] });
	assert.equal((await planTagRename(app, "project", "Project")).merges, false);
	const stale = fakeVault({ "A.md": "#project/Web", "B.md": "#work/Web" }, { "A.md": ["#project"], "B.md": ["#work/Web"] });
	assert.equal((await planTagRename(stale.app, "project", "Work")).merges, true);
});

test("frontmatter tags from getAllTags are candidates, even without inline cache entries", async () => {
	const vault = fakeVault({ "A.md": "---\ntags: [project]\n---" }, {});
	vault.app.metadataCache.getFileCache = () => ({ frontmatter: { tags: ["project"] } });
	assert.deepEqual(await planTagRename(vault.app, "project", "Work"), { files: [{ path: "A.md", count: 1 }], total: 1, merges: false });
	assert.equal((await applyTagRename(vault.app, "project", "Work")).total, 1);
});

test("apply recomputes atomically, skips stale matches and undoes only unchanged writes", async () => {
	const vault = fakeVault({ "A.md": "#project", "B.md": "#project", "C.md": "#project" }, { "A.md": ["#project"], "B.md": ["#project"], "C.md": ["#project"] });
	vault.beforeProcess((file) => {
		if (file.path === "A.md") vault.contents[file.path] = "new #project #project/Web";
		if (file.path === "B.md") vault.contents[file.path] = "removed tag";
	});
	const result = await applyTagRename(vault.app, "project", "Work");
	assert.deepEqual([result.files, result.total], [2, 3]);
	assert.deepEqual(vault.reads, []);
	assert.equal(vault.contents["A.md"], "new #Work #Work/Web");
	vault.beforeProcess((file) => { if (file.path === "C.md") vault.contents[file.path] = "edited #Work"; });
	assert.equal(await result.undo(), 1);
	assert.equal(vault.contents["A.md"], "new #project #project/Web");
	assert.equal(vault.contents["C.md"], "edited #Work");
	assert.equal(await result.undo(), 0);
});

test("undo continues past deleted files and supports a case-only rename", async () => {
	const vault = fakeVault({ "A.md": "#project", "B.md": "#PROJECT/Web" }, { "A.md": ["#project"], "B.md": ["#PROJECT/Web"] });
	const result = await applyTagRename(vault.app, "project", "Project");
	assert.deepEqual([result.files, result.total], [2, 2]);
	delete vault.contents["A.md"];
	assert.equal(await result.undo(), 1);
	assert.equal(vault.contents["B.md"], "#PROJECT/Web");
});

test("empty vault and invalid names produce empty plans and undoable no-ops", async () => {
	const vault = fakeVault({}, {});
	assert.deepEqual(await planTagRename(vault.app, "project", "Work"), { files: [], total: 0, merges: false });
	const result = await applyTagRename(vault.app, "project", "bad name");
	assert.deepEqual([result.files, result.total, await result.undo()], [0, 0, 0]);
});
