import { test } from "node:test";
import assert from "node:assert/strict";
import {
	FORBIDDEN_CHARS,
	nameProblem,
	sameName,
	folderOf,
	defaultParent,
	fillTemplate,
	appendLine,
	nameFromSelection,
	linkAlias,
	type ParentWorld,
} from "../src/modules/home/logic/new-note";

test("name problems: forbidden characters are unique, ordered and checked before dots", () => {
	assert.deepEqual(FORBIDDEN_CHARS, ["\\", "/", ":", "*", "?", "\"", "<", ">", "|", "#", "^", "[", "]"]);
	assert.deepEqual(nameProblem("a/b/c#d"), { kind: "chars", chars: ["/", "#"] });
	assert.deepEqual(nameProblem(" .#a/a#. "), { kind: "chars", chars: ["#", "/"] });
	assert.deepEqual(nameProblem(FORBIDDEN_CHARS.join("")), { kind: "chars", chars: [...FORBIDDEN_CHARS] });
	assert.deepEqual(nameProblem(" .hidden "), { kind: "dot-start" });
	assert.deepEqual(nameProblem("."), { kind: "dot-start" });
	assert.deepEqual(nameProblem(" name. "), { kind: "dot-end" });
	for (const name of ["", " \t\n ", " Pilot ", "a.b"]) assert.equal(nameProblem(name), null);
});

test("same names: trim and ignore case, sort paths without changing the input", () => {
	const notes = Object.freeze([
		{ path: "Long/Pilot.md", basename: "PILOT" },
		{ path: "B/Pilot.md", basename: "Pilot" },
		{ path: "Pilot.md", basename: "Pilot" },
		{ path: "A/Pilot.md", basename: " Pilot " },
		{ path: "Other.md", basename: "Other" },
		{ path: "Pilot.png", basename: "Pilot" },
	]);
	assert.deepEqual(sameName(" pilot ", notes), ["Pilot.md", "A/Pilot.md", "B/Pilot.md", "Long/Pilot.md"]);
	assert.deepEqual(sameName(" \t ", notes), []);
	assert.deepEqual(sameName("Missing", notes), []);
	assert.deepEqual(sameName("Pilot", []), []);
});

test("folder messages: nested paths and root notes", () => {
	assert.equal(folderOf("A/B/C.md"), "A/B");
	assert.equal(folderOf("C.md"), "");
	assert.equal(folderOf("A/C.md"), "A");
	assert.equal(folderOf(""), "");
});

const world: ParentWorld = {
	exists: (path) => ["Given.md", "Place.md", "Home.md", "Domain.md", "Child.md", "Orphan.md", "Last.md"].includes(path),
	hasChildren: (path) => path === "Place.md",
	parent: (path) => path === "Child.md" ? "Place.md" : null,
	isDomain: (path) => path === "Domain.md",
};

test("default parent: an existing given parent wins; a missing one falls through", () => {
	assert.equal(defaultParent(world, { given: "Given.md", active: "Place.md", last: "Last.md", home: "Home.md" }), "Given.md");
	assert.equal(defaultParent(world, { given: "Gone.md", active: "Place.md" }), "Place.md");
});

test("default parent: active places, home and domains win over the last parent", () => {
	for (const active of ["Place.md", "Home.md", "Domain.md"]) {
		assert.equal(defaultParent(world, { active, last: "Last.md", home: "Home.md" }), active);
	}
	assert.equal(defaultParent(world, { active: "Child.md", last: "Last.md" }), "Place.md");
});

test("default parent: orphans and missing active notes fall back to last, then existing home", () => {
	assert.equal(defaultParent(world, { active: "Orphan.md", last: "Last.md", home: "Home.md" }), "Last.md");
	assert.equal(defaultParent(world, { active: "Gone.md", last: "Last.md" }), "Last.md");
	assert.equal(defaultParent(world, { last: "Gone.md", home: "Home.md" }), "Home.md");
	assert.equal(defaultParent(world, { given: "", active: "", last: "", home: "Home.md" }), "Home.md");
	assert.equal(defaultParent(world, { active: "Gone.md", home: "Gone.md" }), null);
	for (const home of [null, "", "Gone.md"]) assert.equal(defaultParent(world, { home }), null);
	assert.equal(defaultParent(world, {}), null);
});

test("templates: title, date and time accept case and spaces and pass the correct patterns", () => {
	const patterns: string[] = [];
	const result = fillTemplate("{{title}} {{ TITLE }} {{ date }} {{TIME}} {{DaTe:YYYY}} {{ time: HH:mm:ss }}", {
		title: "Pilot $&",
		dateFormat: "DD/MM/YYYY",
		timeFormat: "h:mm A",
		format: (pattern) => { patterns.push(pattern); return `[${pattern}]`; },
	});
	assert.equal(result, "Pilot $& Pilot $& [DD/MM/YYYY] [h:mm A] [YYYY] [HH:mm:ss]");
	assert.deepEqual(patterns, ["DD/MM/YYYY", "h:mm A", "YYYY", "HH:mm:ss"]);
});

test("templates: default formats and unknown variables or Templater remain intact", () => {
	for (const formats of [{}, { dateFormat: "", timeFormat: "" }]) {
		assert.equal(fillTemplate("{{date}} {{time}}", { title: "", ...formats, format: (pattern) => pattern }), "YYYY-MM-DD HH:mm");
	}
	const text = "{{unknown}} {{title:FORMAT}} <% tp.file.title %> {{dates}}";
	assert.equal(fillTemplate(text, { title: "Pilot", format: () => assert.fail("Unknown variables must not format dates") }), text);
});

test("append a line: remove trailing whitespace and finish with one matching newline", () => {
	assert.equal(appendLine("# MOC\n\n- [[A]]\n\n\n", "- [[B]]"), "# MOC\n\n- [[A]]\n- [[B]]\n");
	assert.equal(appendLine("", "- [[B]]"), "- [[B]]\n");
	assert.equal(appendLine("x", "y"), "x\ny\n");
	assert.equal(appendLine(" \t\n ", "y"), "y\n");
	assert.equal(appendLine("x \t\n\n", "y\n\n"), "x\ny\n");
	assert.equal(appendLine("# MOC\r\n\r\n- [[A]]\r\n \r\n", "- [[B]]"), "# MOC\r\n\r\n- [[A]]\r\n- [[B]]\r\n");
	assert.equal(appendLine(" \r\n ", "y"), "y\r\n");
});

test("selection names: unwrap emphasis repeatedly and clean file and link characters", () => {
	assert.equal(nameFromSelection("  **Pilot checklist** "), "Pilot checklist");
	assert.equal(nameFromSelection("Q3: budget"), "Q3 budget");
	assert.equal(nameFromSelection("`code`"), "code");
	for (const marker of ["**", "__", "*", "_", "==", "~~", "`", "``"]) {
		assert.equal(nameFromSelection(`${marker}Pilot${marker}`), "Pilot");
	}
	assert.equal(nameFromSelection("**__==~~`Pilot`~~==__**"), "Pilot");
	assert.equal(nameFromSelection("\n Pilot \r\n"), "Pilot");
	assert.equal(nameFromSelection("..Pilot / checklist"), "Pilot checklist");
	assert.equal(nameFromSelection("a".repeat(120)), "a".repeat(120));
	assert.equal(nameFromSelection("  " + "a".repeat(120) + "  "), "a".repeat(120));
	assert.equal(nameFromSelection("See [[Pilot]]"), "See Pilot");
});

test("selection names: reject blank, multiline, long and already linked selections", () => {
	for (const text of ["", " \t ", "a\nb", "a\r\nb", "a\rb", "a".repeat(121), "**" + "a".repeat(117) + "**", "[[Foo]]", " [[Foo|Alias]] ", "[Foo](https://x.y)", "[Foo](https://x.y/a(b))", "** **", "...", "/:#"]) {
		assert.equal(nameFromSelection(text), null, JSON.stringify(text));
	}
});

test("link aliases: preserve trimmed selection only when the trimmed name differs", () => {
	assert.equal(linkAlias("Q3: budget", "Q3 budget"), "Q3: budget");
	assert.equal(linkAlias(" Pilot ", "Pilot"), null);
	assert.equal(linkAlias("**Pilot**", "Pilot"), "**Pilot**");
	assert.equal(linkAlias(" pilot ", "Pilot"), "pilot");
	assert.equal(linkAlias("Pilot", " Pilot "), null);
	assert.equal(linkAlias("", ""), null);
});
