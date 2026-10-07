// The shared tag picker (src/ui/tag-picker): which tags the column offers and why, how a tag is
// shown inside a parent, what part matches the filter, and the colors read from Tag colors.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chipList, highlight, isTagName, shownName } from "../src/ui/tag-picker/logic";
import { tagColorsFrom } from "../src/ui/tag-picker";

test("tag picker: chosen, suggested, near tags, then the families of the vault; filter, sub-tags, create", () => {
	const base = { filter: "", level: null, tag: null, suggested: "home/car", near: ["work/team", "home/car"], all: ["home", "home/car", "home/garden", "work", "work/team", "reading"] };
	assert.deepEqual(chipList(base).map((c) => c.tag), ["home/car", "work/team", "home", "work", "reading"]);
	assert.ok(chipList(base)[0].suggested);
	assert.ok(chipList(base).find((c) => c.tag === "home")?.parent);
	assert.deepEqual(chipList({ ...base, level: "home" }).map((c) => c.tag), ["home", "home/car", "home/garden"]);
	assert.deepEqual(chipList({ ...base, filter: "gar" }).map((c) => c.tag), ["home/garden", "gar"]);
	assert.ok(chipList({ ...base, filter: "gar" })[1].create);
	assert.deepEqual(chipList({ ...base, filter: "home" }).map((c) => c.tag).slice(0, 3), ["home", "home/car", "home/garden"]);
	assert.ok(!chipList({ ...base, filter: "home" }).some((c) => c.create));
	assert.deepEqual(chipList({ ...base, level: "home", filter: "shed" }).map((c) => [c.tag, !!c.create]), [["home/shed", true]]);
	assert.ok(!chipList({ ...base, filter: "bad name!" }).some((c) => c.create));
});

test("tag column: why each tag ranks where it does, its sub-tags in grey, the groups, the recent ones after the near ones", () => {
	const q = {
		filter: "",
		level: null,
		tag: null,
		suggested: "home/car",
		suggestedWord: "insurer",
		near: ["work/team"],
		recent: ["reading", "work/team"],
		all: ["home", "home/car", "home/garden", "home/garden/shed", "work", "work/team", "reading", "music"],
	};
	const rows = chipList(q);
	assert.deepEqual(rows.map((c) => c.tag), ["home/car", "work/team", "reading", "home", "work", "music"]);
	assert.deepEqual(rows.map((c) => c.group), ["top", "near", "recent", "all", "all", "all"]);
	assert.deepEqual(rows[0].why, { kind: "learned", word: "insurer" });
	assert.deepEqual(rows[1].why, { kind: "near" });
	assert.deepEqual(rows[2].why, { kind: "recent" });
	assert.equal(rows[3].why, undefined);
	// Direct sub-tags only, by their last part.
	assert.deepEqual(rows[3].kids, ["car", "garden"]);
	assert.deepEqual(rows[4].kids, ["team"]);
	assert.deepEqual(rows[5].kids, []);
	// The chosen tag comes first and says so; a chosen sub-tag does not hide its family.
	const chosen = chipList({ ...q, tag: "music" });
	assert.deepEqual(chosen.slice(0, 2).map((c) => [c.tag, c.why?.kind]), [["music", "chosen"], ["home/car", "learned"]]);
	// Inside a parent: the parent itself first ("the tag alone"), then its sub-tags, with their reasons.
	const level = chipList({ ...q, level: "home" });
	assert.deepEqual(level.map((c) => [c.tag, c.why?.kind ?? null, c.group]), [["home", "parent", "level"], ["home/car", "learned", "level"], ["home/garden", null, "level"], ["home/garden/shed", null, "level"]]);
	// Filtering keeps the reasons and offers the new name last, in its own group.
	const hits = chipList({ ...q, filter: "car" });
	assert.deepEqual(hits.map((c) => [c.tag, c.group]), [["home/car", "hits"], ["car", "new"]]);
	assert.equal(hits[0].why?.kind, "learned");
	assert.deepEqual(hits[1].kids, []);
	// Without the recent list the picker still works.
	assert.deepEqual(chipList({ ...q, recent: undefined }).map((c) => c.tag), ["home/car", "work/team", "home", "work", "reading", "music"]);
});

test("the filter is marked in a tag name, accents and case ignored, in place", () => {
	assert.deepEqual(highlight("réunion", "reu"), [{ text: "réu", hit: true }, { text: "nion", hit: false }]);
	assert.deepEqual(highlight("Maison", "SON"), [{ text: "Mai", hit: false }, { text: "son", hit: true }]);
	assert.deepEqual(highlight("home", "#ho"), [{ text: "ho", hit: true }, { text: "me", hit: false }]);
	assert.deepEqual(highlight("home", ""), [{ text: "home", hit: false }]);
	assert.deepEqual(highlight("home", "xyz"), [{ text: "home", hit: false }]);
});

test("a new tag needs a letter, like Obsidian wants; the filter ignores accents and case but keeps the spelling", () => {
	assert.ok(isTagName("2026/plan") && isTagName("a1") && isTagName("x-2") && isTagName("_"));
	assert.ok(!isTagName("2026") && !isTagName("12/34") && !isTagName("bad name") && !isTagName(""));
	const q = { filter: "2026", level: null, tag: null, suggested: null, near: [], all: ["home"] };
	assert.ok(!chipList(q).some((c) => c.create));
	assert.deepEqual(chipList({ ...q, filter: "y2026" }).map((c) => [c.tag, !!c.create]), [["y2026", true]]);
	// "reu" finds "Réunion" and keeps its spelling; "RÉU" too; a new name is still offered (lowercased as typed).
	const accents = { filter: "reu", level: null, tag: null, suggested: null, near: [], all: ["travail/Réunion", "travail", "lecture"] };
	assert.deepEqual(chipList(accents).map((c) => [c.tag, !!c.create]), [["travail/Réunion", false], ["reu", true]]);
	assert.deepEqual(chipList({ ...accents, filter: "RÉU" }).map((c) => [c.tag, !!c.create]), [["travail/Réunion", false], ["réu", true]]);
	// Inside travail, "reunion" is the existing sub-tag: no second one is offered.
	assert.deepEqual(chipList({ ...accents, level: "travail", filter: "reunion" }).map((c) => [c.tag, !!c.create]), [["travail/Réunion", false]]);
	// Exact matches rank first whatever the accents, and an existing tag is never offered again.
	assert.deepEqual(chipList({ filter: "ete", level: null, tag: null, suggested: null, near: [], all: ["etendue", "été"] }).map((c) => [c.tag, !!c.create]), [["été", false], ["etendue", false]]);
	// The new name keeps what was typed, lowercased.
	assert.deepEqual(chipList({ ...accents, filter: "Été" }).map((c) => [c.tag, !!c.create]), [["été", true]]);
});

test("inside a parent, only its own sub-tags lose the prefix; other hits keep their path", () => {
	assert.equal(shownName("home/car", "home"), "car");
	assert.equal(shownName("home/garden/shed", "home"), "garden/shed");
	assert.equal(shownName("Home/car", "home"), "car");
	assert.equal(shownName("work/car", "home"), "work/car");
	assert.equal(shownName("home", "home"), "home");
	assert.equal(shownName("home/car", null), "home/car");
	// Filtering "car" inside home lists home/car first, then work/car from the rest of the vault.
	const hits = chipList({ filter: "car", level: "home", tag: null, suggested: null, near: [], all: ["home", "home/car", "work", "work/car"] });
	assert.deepEqual(hits.map((c) => c.tag), ["home/car", "work/car"]);
	assert.deepEqual(hits.map((c) => shownName(c.tag, "home")), ["car", "work/car"]);
});

test("the colors come from Tag colors when it runs, and stay neutral otherwise", () => {
	const services: Record<string, unknown> = {};
	const ctx = { service: <T>(name: string) => services[name] as T | undefined };
	const colors = tagColorsFrom(ctx);
	assert.equal(colors("home"), "");
	services["tag-colors"] = { version: 1, classes: (tag: string) => `sk-tag-${tag}` };
	assert.equal(colors("home"), "sk-tag-home");
	services["tag-colors"] = { version: 2, classes: () => "x" };
	assert.equal(colors("home"), "");
	services["tag-colors"] = { version: 1, classes: () => { throw new Error("broken"); } };
	assert.equal(colors("home"), "");
});
