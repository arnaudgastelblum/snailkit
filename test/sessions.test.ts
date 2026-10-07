import assert from "node:assert/strict";
import { test } from "node:test";
import {
	bodyStart,
	candidateRange,
	chipList,
	cleanTitle,
	closingLine,
	closingMatcher,
	LEGACY_CLOSING,
	dayPart,
	defaultCount,
	fish,
	groupTag,
	highlight,
	isPriority,
	isTagName,
	hiddenLines,
	isQuestion,
	keywords,
	learn,
	lineInfo,
	looksLikeTask,
	newSessionText,
	poseLines,
	proposedTitle,
	remember,
	safeName,
	sentenceAt,
	sentences,
	shownName,
	stepAfterTag,
	stripFillers,
	suggestion,
	suggestTag,
	summarize,
	tagsIn,
	withoutTag,
} from "../src/modules/sessions/logic";
import { bubbleRadius, createdAt, dayNumber, dayStart, filterCounts, keepCreated, renameCreated, withCreated, filterSessions, layoutTimeline, searchable, stateOf, tabCount } from "../src/modules/sessions/atelier";
import { DEFAULTS } from "../src/modules/sessions/types";
import { mergeSettings } from "../src/core/settings";
import { en } from "../src/modules/sessions/i18n/en";
import { fr } from "../src/modules/sessions/i18n/fr";
import { nl } from "../src/modules/sessions/i18n/nl";
import { es } from "../src/modules/sessions/i18n/es";

const texts = (line: string) => sentences(line).map((s) => s.text);

test("sentences end on . ! ? … followed by a space, never inside links, code or numbers", () => {
	assert.deepEqual(texts("Clean the garage. Take the bikes out!  Then rest"), ["Clean the garage.", "Take the bikes out!", "Then rest"]);
	assert.deepEqual(texts("Version 3.5 is out. See notes.md for more."), ["Version 3.5 is out.", "See notes.md for more."]);
	assert.deepEqual(texts("Read [[Book. Part 2]] tonight. Done?"), ["Read [[Book. Part 2]] tonight.", "Done?"]);
	assert.deepEqual(texts("Run `a. b` now. Ok"), ["Run `a. b` now.", "Ok"]);
	assert.deepEqual(texts("Wait... what?! Fine."), ["Wait...", "what?!", "Fine."]);
	assert.deepEqual(texts("«Bonjour.» Puis partir."), ["«Bonjour.»", "Puis partir."]);
	assert.deepEqual(texts(""), []);
	const all = sentences("One. Two.");
	assert.deepEqual(all.map((s) => [s.start, s.end]), [[0, 4], [5, 9]]);
	assert.equal(sentenceAt("One. Two.", 6)?.text, "Two.");
	assert.equal(sentenceAt("One. Two.", 4)?.text, "One.");
	assert.equal(sentenceAt("   ", 1), null);
});

test("likely tasks: an action verb first in any of the four languages, or a Dutch infinitive last", () => {
	for (const s of [
		"Call the insurer about the car.",
		"Don't forget to renew the passport",
		"Rappeler l’assurance pour la voiture.",
		"Penser à acheter des ampoules.",
		"Il faut réserver la salle",
		"Bel de verzekering",
		"Niet vergeten: melk kopen",
		"De verzekering bellen",
		"Llamar al seguro mañana.",
		"Hay que comprar pan",
		"- Book the train",
	]) assert.ok(looksLikeTask(s), s);
	for (const s of [
		"The mornings are clearer when I write first.",
		"Call me maybe?",
		"Idée pour les réunions d’équipe : commencer sans ordre du jour.",
		"",
		"Mustard is yellow",
	]) assert.ok(!looksLikeTask(s), s);
	assert.ok(isQuestion("Do we keep the newsletter ?"));
	assert.ok(isQuestion("¿Seguimos con esto"));
	assert.ok(!isQuestion("No question here."));
});

test("fillers go away, titles are clean", () => {
	assert.equal(stripFillers("Penser à acheter des ampoules."), "acheter des ampoules.");
	assert.equal(stripFillers("Niet vergeten: melk kopen"), "melk kopen");
	assert.equal(stripFillers("Don’t forget to call Sam"), "call Sam");
	assert.equal(stripFillers("Mustard first"), "Mustard first");
	assert.equal(cleanTitle("  penser à acheter des ampoules.  "), "Acheter des ampoules");
	assert.equal(cleanTitle("call the bank…"), "Call the bank");
	assert.equal(cleanTitle("Do we keep it?"), "Do we keep it?");
	assert.equal(cleanTitle("ne pas oublier d'appeler Sam"), "Appeler Sam");
	assert.equal(cleanTitle("..."), "...");
});

test("line kinds", () => {
	assert.deepEqual(lineInfo("- [ ] Call #home"), { kind: "task", indent: "", marker: "- ", box: " ", bodyStart: 6, body: "Call #home" });
	assert.equal(lineInfo("\t* [?] Keep it").kind, "decide");
	assert.equal(lineInfo("1. [x] Done").kind, "task");
	assert.equal(lineInfo("- item").marker, "- ");
	assert.equal(lineInfo("- item").body, "item");
	assert.equal(lineInfo("Some text").kind, "free");
	assert.equal(lineInfo("   ").kind, "blank");
	assert.equal(lineInfo("## Title").kind, "heading");
	assert.equal(lineInfo("> quote").kind, "other");
	assert.equal(lineInfo("[[Inbox]]").kind, "other");
	assert.equal(lineInfo("| a | b |").kind, "other");
	assert.deepEqual(hiddenLines(["---", "a: 1", "---", "text", "```", "code", "```", "after"]), [true, true, true, false, true, true, true, false]);
});

test("catching a sentence: before stays, the task gets a clean title, after goes below", () => {
	const line = "The mail came. Call the insurer for the car, renewal in October. Ask about the bonus.";
	const s = sentences(line)[1];
	const f = fish(line, s.start, s.end);
	assert.deepEqual(f.lines, ["The mail came.", "- [ ] Call the insurer for the car, renewal in October", "Ask about the bonus."]);
	assert.equal(f.task, 1);
	assert.equal(f.titleStart, 6);
	// A list item keeps its marker and indentation; the whole line when it is one sentence.
	assert.deepEqual(fish("\t- penser à acheter du pain.", 0, 25).lines, ["\t- [ ] Acheter du pain"]);
	assert.deepEqual(fish("Keep this?", 0, 10, "?").lines, ["- [?] Keep this?"]);
	// A decide line becomes a task.
	const d = lineInfo("- [?] Call Sam");
	assert.deepEqual(fish("- [?] Call Sam", 0, d.body.length).lines, ["- [ ] Call Sam"]);
});

test("placing: title and tag, description indented one unit, trailing blanks never taken", () => {
	const posed = poseLines({ taskLine: "- [ ] Call the insurer", tag: "home/car", candidates: ["Renewal in October.", "Ask about the bonus.", "", "Other idea."], count: 3, wasDescription: 0, unit: "\t" });
	assert.deepEqual(posed, ["- [ ] Call the insurer #home/car", "\tRenewal in October.", "\tAsk about the bonus."]);
	// Spaces as unit, nested task, relative indentation kept.
	assert.deepEqual(
		poseLines({ taskLine: "  - [ ] Plan", tag: null, candidates: ["Step one", "  - detail"], count: 2, wasDescription: 0, unit: "    " }),
		["  - [ ] Plan", "      Step one", "        - detail"],
	);
	// A blank line inside the description is kept (empty).
	assert.deepEqual(poseLines({ taskLine: "- [ ] A", tag: "x", candidates: ["one", "", "two"], count: 3, wasDescription: 0, unit: "\t" }), ["- [ ] A #x", "\tone", "", "\ttwo"]);
	// Editing: the tag is not doubled, description lines that are no longer taken move back out.
	assert.deepEqual(
		poseLines({ taskLine: "- [x] Call #home", tag: "home", candidates: ["\tfirst", "\tsecond"], count: 1, wasDescription: 2, unit: "\t" }),
		["- [x] Call #home", "\tfirst", "second"],
	);
	assert.deepEqual(poseLines({ taskLine: "- [ ] A", tag: null, candidates: ["b"], count: 0, wasDescription: 0, unit: "\t" }), ["- [ ] A"]);
	assert.deepEqual(poseLines({ taskLine: "- [ ] ", tag: "home", candidates: [], count: 0, wasDescription: 0, unit: "\t" }), ["- [ ] #home"]);
});

test("cancel and undo give the original text back: the catch is reversible", () => {
	const original = "Before. Call Sam today. After that, rest.";
	const s = sentences(original)[1];
	const f = fish(original, s.start, s.end);
	const doc = [f.lines.join("\n"), "Next line", "", "Far"].join("\n");
	// What the editor does on Escape: the rewritten region replaced by the original line.
	const region = f.lines.join("\n");
	assert.equal(doc.replace(region, original), [original, "Next line", "", "Far"].join("\n"));
	// Placing, then undoing: the posed block replaced by the original line plus the lines it took.
	const lines = doc.split("\n");
	const posed = poseLines({ taskLine: lines[f.task], tag: "people", candidates: lines.slice(f.task + 1, f.task + 3), count: 2, wasDescription: 0, unit: "\t" });
	assert.deepEqual(posed, ["- [ ] Call Sam today #people", "\tAfter that, rest.", "\tNext line"]);
	const placed = [lines[0], ...posed, ...lines.slice(f.task + 3)].join("\n");
	const undoOriginal = original + "\n" + "Next line";
	const posedRegion = [lines[0], ...posed].join("\n");
	assert.equal(placed.replace(posedRegion, undoOriginal), [original, "Next line", "", "Far"].join("\n"));
});

test("description candidates: the current description, then free lines, up to a task or a heading", () => {
	const closing = closingMatcher(["Session closed at"]);
	const lines = ["- [ ] Task", "\tdesc one", "", "\tdesc two", "free a", "free b", "", "free c", "", "- [ ] Next", "free d"];
	assert.deepEqual(candidateRange(lines, 0, closing), { count: 7, description: 3 });
	assert.deepEqual(candidateRange(["- [ ] T", "a", "## H", "b"], 0, closing), { count: 1, description: 0 });
	assert.deepEqual(candidateRange(["- [ ] T", "a", "", "*Session closed at 08:00 · 1 idea*"], 0, closing), { count: 1, description: 0 });
	assert.deepEqual(candidateRange(["- [ ] T", "", ""], 0, closing), { count: 0, description: 0 });
	assert.equal(defaultCount(["a", "b", "", "c"]), 2);
	assert.equal(defaultCount(["", "c"]), 0);
});

test("tags in text", () => {
	assert.deepEqual(tagsIn("Call #home/car and #work, not a#b nor #2024"), ["home/car", "work"]);
	assert.equal(withoutTag("Call #home now", "home"), "Call now");
	assert.equal(withoutTag("Call #home/car", "home"), "Call #home/car");
	assert.equal(withoutTag("Call #Home", "home"), "Call");
	assert.equal(withoutTag("Call #a #b"), "Call #b");
});

test("tag suggestion learns from placed tasks, without built-in words", () => {
	assert.deepEqual(keywords("Call the insurer about the car #home [[Note]]"), ["insurer", "car"]);
	let learned = learn([], "Call the insurer about the car", "home/car");
	learned = learn(learned, "Check the car tires", "home/car");
	learned = learn(learned, "Prepare the website launch", "project/website");
	assert.equal(suggestTag("Ask the insurer about the car", learned, []), "home/car");
	assert.equal(suggestTag("Ask the insurer", learned, []), null);
	assert.equal(suggestTag("Fix the website launch date", learned, []), "project/website");
	assert.equal(suggestTag("Something unrelated", learned, []), null);
	// A tag of the vault whose last part is a word of the sentence.
	assert.equal(suggestTag("Update the website footer", [], ["project/website", "home"]), "project/website");
	assert.equal(suggestTag("Water the garden", [], ["Home/Garden"]), "Home/Garden");
	// Counts grow, and the store stays capped.
	const again = learn(learned, "The car again", "home/car");
	assert.equal(again.find(([w, t]) => w === "car" && t === "home/car")?.[2], 3);
	let big: ReturnType<typeof learn> = [];
	for (let i = 0; i < 50; i++) big = learn(big, `word${i}a word${i}b`, "t");
	assert.equal(learn(big, "fresh words", "t", 20).length, 20);
	assert.ok(learn(big, "fresh words", "t", 20).some(([w]) => w === "fresh"));
	assert.deepEqual(remember(["a", "b", "c"], "B", 3), ["B", "a", "c"]);
});

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

test("the suggestion names the word that earned it", () => {
	let learned = learn([], "Call the insurer about the car", "home/car");
	learned = learn(learned, "Check the car tires", "home/car");
	assert.deepEqual(suggestion("Ask the insurer about the car", learned, []), { tag: "home/car", word: "car" });
	assert.deepEqual(suggestion("Water the garden", [], ["Home/Garden"]), { tag: "Home/Garden", word: "garden" });
	assert.equal(suggestion("Something unrelated", learned, []), null);
	assert.equal(suggestTag("Ask the insurer about the car", learned, []), "home/car");
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

test("after the tag: the description only when lines follow the task", () => {
	assert.equal(stepAfterTag(0), "place");
	assert.equal(stepAfterTag(1), "desc");
	assert.equal(stepAfterTag(3), "desc");
});

test("summary: ideas, tasks with description, questions and lines kept to decide", () => {
	const closing = closingMatcher(["Session closed at", "Session close à"]);
	const note = [
		"",
		"[[Inbox]]",
		"5 October 2026 · 07:48",
		"",
		"Clean up the garage before winter.",
		"- [ ] Take the bikes out #home",
		"\tPut the shelves at the back.",
		"",
		"An idea for team meetings: start with five free minutes.",
		"Try it for three weeks.",
		"",
		"Do we keep the newsletter? Few replies.",
		"- [?] A pottery class for the birthday",
		"- [ ] Call Sam",
		"",
		"*Session closed at 08:12 · 6 ideas · 2 tasks · 2 to decide*",
	];
	assert.equal(bodyStart(note), 4);
	const s = summarize(note, closing);
	assert.deepEqual(s.items.map((i) => i.kind), ["free", "task", "free", "question", "question", "task"]);
	assert.equal(s.ideas, 6);
	assert.equal(s.free, 2);
	assert.deepEqual(s.tasks.map((t) => [t.title, t.tag, t.description]), [["Take the bikes out", "home", ["Put the shelves at the back."]], ["Call Sam", "", []]]);
	assert.deepEqual(s.questions.map((q) => [q.explicit, q.start, q.end]), [[false, 0, 26], [true, 0, 32]]);
	assert.equal(s.pending, 2);
	assert.equal(summarize(["Just one thought."], closing).ideas, 1);
	assert.equal(summarize([], closing).ideas, 0);
	// Without a header, the body starts at the top.
	assert.equal(bodyStart(["Call Sam.", "More."]), 0);
	assert.equal(bodyStart(["---", "tags: x", "---", "[[Parent]]", "Text."]), 4);
});

test("closing line: written in italics, recognized in every language", () => {
	const prefixes = [en, fr, nl, es].map((t) => t["closing.prefix"]);
	const isClosing = closingMatcher(prefixes);
	for (const t of [en, fr, nl, es]) {
		const line = closingLine(t["closing.line"].replace("{time}", "08:12").replace("{ideas}", "7").replace("{tasks}", "3").replace("{decide}", "1"));
		assert.ok(line.startsWith("*") && line.endsWith("*"));
		assert.ok(isClosing(line), line);
		assert.ok(t["closing.line"].startsWith(t["closing.prefix"]));
	}
	assert.ok(isClosing("_Brainstorm closed at 9:00_"));
	assert.ok(!isClosing("Brainstorm closed at 08:12"));
	// Notes closed before the rename keep their closing line.
	const withLegacy = closingMatcher([...prefixes, ...LEGACY_CLOSING]);
	assert.ok(withLegacy("*Session closed at 08:12 · 7 ideas*"));
	assert.ok(withLegacy("*Session close à 08:12 · 7 idées*"));
	assert.ok(!isClosing("*Something else*"));
});

test("a new session: proposed title, safe file name, first lines", () => {
	assert.equal(proposedTitle(fr["title.template"], "5 oct.", fr["part.morning"]), "Brainstorm du 5 oct, matin");
	assert.equal(proposedTitle(en["title.template"], "Oct 5", en["part.evening"]), "Brainstorm of Oct 5, evening");
	assert.equal(proposedTitle(nl["title.template"], "5 okt", nl["part.afternoon"]), "Brainstorm van 5 okt, middag");
	assert.equal(proposedTitle(es["title.template"], "5 oct", es["part.morning"]), "Lluvia de ideas del 5 oct, mañana");
	assert.equal(dayPart(new Date(2026, 9, 5, 7, 48)), "morning");
	assert.equal(dayPart(new Date(2026, 9, 5, 12, 0)), "afternoon");
	assert.equal(dayPart(new Date(2026, 9, 5, 18, 30)), "evening");
	assert.equal(safeName("Session: 5/10 #idea?"), "Session 5 10 idea");
	assert.equal(safeName("..."), "Session");
	assert.equal(newSessionText("Inbox", "5 October 2026 · 07:48"), "\n[[Inbox]]\n5 October 2026 · 07:48\n\n");
	assert.equal(newSessionText("[[Inbox.md]]", "d"), "\n[[Inbox]]\nd\n\n");
	assert.equal(newSessionText("", "d"), "\nd\n\n");
	// The header of a new session is never counted as an idea.
	assert.equal(summarize(newSessionText("Inbox", "5 October 2026 · 07:48").split("\n"), () => false).ideas, 0);
});

test("task titles leave out hidden comments and dates added by other tools", () => {
	const s = summarize(["- [ ] Call Sam #home %%tt:abc123%% 📅 2026-10-09"], () => false);
	assert.equal(s.tasks[0].title, "Call Sam");
	assert.deepEqual(keywords("Call Sam %%tt:abc123%%"), ["sam"]);
});

test("lengthening an existing description with plain prose keeps one indentation unit", () => {
	assert.deepEqual(
		poseLines({ taskLine: "- [ ] Fix #home", tag: "home", candidates: ["\told description", "new description"], count: 2, wasDescription: 1, unit: "\t" }),
		["- [ ] Fix #home", "\told description", "\tnew description"],
	);
	// Nested lines of the existing description keep their depth.
	assert.deepEqual(
		poseLines({ taskLine: "- [ ] Fix", tag: null, candidates: ["\tfirst", "\t\tdeeper", "added"], count: 3, wasDescription: 2, unit: "\t" }),
		["- [ ] Fix", "\tfirst", "\t\tdeeper", "\tadded"],
	);
});

test("the group tag of a task is its first tag that is not a priority", () => {
	assert.equal(groupTag("Fix #high #home"), "home");
	assert.equal(groupTag("Fix #high"), null);
	assert.ok(isPriority("Medium") && !isPriority("home"));
	// Editing keeps the priority where it is and changes only the group tag.
	const text = withoutTag("Fix #high #home", groupTag("Fix #high #home")!);
	assert.equal(text, "Fix #high");
	assert.deepEqual(poseLines({ taskLine: "- [ ] " + text, tag: "work", candidates: [], count: 0, wasDescription: 0, unit: "\t" }), ["- [ ] Fix #high #work"]);
	const s = summarize(["- [ ] Fix #high #home"], () => false);
	assert.deepEqual([s.tasks[0].title, s.tasks[0].tag], ["Fix #high", "home"]);
});

// ----- the Sessions tab of the Workbench -----

const DAYMS = 86_400_000;
const at = (y: number, m: number, d: number, h = 8) => new Date(y, m - 1, d, h).getTime();
const info = (path: string, created: number, o: Partial<import("../src/modules/sessions/atelier").SessionInfo> = {}) => ({
	path, title: path.replace(/\.md$/, ""), created, ideas: 3, tasks: 1, decide: 0, pending: 0, closed: false, text: "", ...o,
});

test("sessions tab: states, filters with counts, search in title and text, newest first", () => {
	const list = [
		info("Old.md", at(2026, 9, 1), { closed: true, text: searchable("Garage, étagères") }),
		info("Middle.md", at(2026, 9, 20), { pending: 2, text: searchable("Call the insurer") }),
		info("New.md", at(2026, 10, 5), { text: searchable("Team meeting") }),
	];
	assert.equal(stateOf(list[0]), "closed");
	assert.equal(stateOf(list[1]), "triage");
	assert.equal(stateOf(list[2]), "open");
	assert.deepEqual(filterCounts(list), { all: 3, open: 2, triage: 1, closed: 1, archived: 0 });
	assert.deepEqual(filterSessions(list, "all", "").map((s) => s.path), ["New.md", "Middle.md", "Old.md"]);
	assert.deepEqual(filterSessions(list, "open", "").map((s) => s.path), ["New.md", "Middle.md"]);
	assert.deepEqual(filterSessions(list, "triage", "").map((s) => s.path), ["Middle.md"]);
	assert.deepEqual(filterSessions(list, "closed", "").map((s) => s.path), ["Old.md"]);
	// Every word, in the title or the text, without accents or case.
	assert.deepEqual(filterSessions(list, "all", "etageres").map((s) => s.path), ["Old.md"]);
	assert.deepEqual(filterSessions(list, "all", "INSURER call").map((s) => s.path), ["Middle.md"]);
	assert.deepEqual(filterSessions(list, "all", "new").map((s) => s.path), ["New.md"]);
	assert.deepEqual(filterSessions(list, "closed", "insurer"), []);
	assert.equal(tabCount(list), 1);
	assert.equal(tabCount([list[0], list[2]]), null);
});

test("sessions tab: the timeline runs from the first session (three weeks at least) to tomorrow", () => {
	const now = at(2026, 10, 5, 9);
	const empty = layoutTimeline([], now, 20);
	assert.equal(empty.days.length, 22);
	assert.ok(empty.days[20].today);
	assert.equal(empty.days[21].date - empty.days[20].date, DAYMS);
	assert.ok(empty.now > empty.days[20].x && empty.now < empty.days[21].x);
	const tl = layoutTimeline([info("A.md", at(2026, 8, 1)), info("B.md", at(2026, 10, 5, 7), { tasks: 9 }), info("C.md", at(2026, 10, 5, 18))], now, 20);
	assert.equal(tl.days.length, 67);
	assert.equal(tl.width, 18 * 2 + 66 * 20);
	const [a, b, c] = ["A.md", "B.md", "C.md"].map((p) => tl.bubbles.find((x) => x.path === p)!);
	assert.ok(a.x < b.x && b.x < c.x, "later is further right");
	// Same day: the second session stacks above the first.
	assert.ok(c.y > b.y);
	assert.ok(tl.height >= c.y + c.r);
	assert.ok(b.r > a.r, "more tasks, bigger bubble");
	assert.equal(bubbleRadius(0), 5);
	assert.equal(bubbleRadius(1000), 16);
	// Labels on Mondays, the first day and today; month starts marked.
	assert.ok(tl.days[0].label && tl.days.filter((d) => d.label).every((d) => d.today || d === tl.days[0] || new Date(d.date).getDay() === 1 || d.month));
	// Given room, the days widen to fill it.
	assert.equal(layoutTimeline([], now, 20, 21, 1000).width, 1000);
	assert.equal(layoutTimeline([], now, 20, 21, 100).width, empty.width);
	assert.ok(tl.days.some((d) => d.month && new Date(d.date).getDate() === 1));
	assert.equal(dayStart(at(2026, 10, 5, 17)), at(2026, 10, 5, 0));
});

test("sessions tab: the timeline counts calendar days across daylight saving changes", () => {
	const tz = process.env.TZ;
	process.env.TZ = "Europe/Brussels";
	try {
		for (const [now, session] of [
			[new Date(2026, 3, 5, 9), new Date(2026, 2, 16, 10)], // spring: clocks go forward on March 29
			[new Date(2026, 10, 2, 9), new Date(2026, 9, 20, 22)], // autumn: clocks go back on October 25
		]) {
			const tl = layoutTimeline([info("S.md", session.getTime())], now.getTime(), 20);
			// Every tick is a local midnight, one calendar day after the other.
			for (const [i, d] of tl.days.entries()) {
				assert.equal(new Date(d.date).getHours(), 0, `tick ${i} at midnight`);
				if (i) assert.equal(dayNumber(d.date) - dayNumber(tl.days[i - 1].date), 1);
			}
			assert.equal(tl.days.filter((d) => d.today).length, 1);
			assert.equal(dayNumber(tl.days.find((d) => d.today)!.date), dayNumber(now.getTime()));
			// The bubble sits in the column of its own day.
			const col = tl.days.findIndex((d) => dayNumber(d.date) === dayNumber(session.getTime()));
			const b = tl.bubbles[0];
			assert.ok(b.x >= tl.days[col].x && b.x < tl.days[col].x + 20, "bubble in its day");
			assert.ok(tl.now >= tl.days.find((d) => d.today)!.x);
		}
	} finally {
		if (tz === undefined) delete process.env.TZ;
		else process.env.TZ = tz;
	}
});

test("sessions: the start of each session is kept by path, follows renames, migrates older lists", () => {
	let list = withCreated([], "A.md", 100);
	list = withCreated(list, "B.md", 200);
	list = withCreated(list, "A.md", 150);
	assert.deepEqual(list, [["B.md", 200], ["A.md", 150]]);
	assert.equal(createdAt(list, "A.md"), 150);
	assert.equal(createdAt(list, "C.md"), null);
	assert.deepEqual(renameCreated(list, "A.md", "Folder/A.md"), [["B.md", 200], ["Folder/A.md", 150]]);
	assert.deepEqual(keepCreated(list, ["B.md"]), [["B.md", 200]]);
	// Hand-edited or broken entries are ignored.
	assert.equal(createdAt([["X.md", Number.NaN]], "X.md"), null);
	// Settings saved before this list existed keep their sessions and get an empty list.
	const merged = mergeSettings(DEFAULTS, { sessions: ["Old.md"] });
	assert.deepEqual([merged.sessions, merged.created], [["Old.md"], []]);
});

// ---- the service's list (read by the rail) ------------------------------------------

import { serviceList, tabTone } from "../src/modules/sessions/atelier";

test("service list: newest first, state named for other modules, counts kept", () => {
	const info = (path: string, created: number, closed: boolean, pending: number, tasks: number, decide: number) =>
		({ path, title: path.replace(/\.md$/, ""), created, ideas: 0, tasks, decide, pending, closed, text: "" });
	const list = [info("Old.md", 1, true, 0, 2, 0), info("New.md", 3, false, 2, 3, 1), info("Mid.md", 2, false, 0, 0, 0)];
	assert.deepEqual(serviceList(list), [
		{ path: "New.md", title: "New", created: 3, state: "to-sort", tasks: 3, undecided: 1 },
		{ path: "Mid.md", title: "Mid", created: 2, state: "open", tasks: 0, undecided: 0 },
		{ path: "Old.md", title: "Old", created: 1, state: "closed", tasks: 2, undecided: 0 },
	]);
	assert.equal(tabTone(list), "warn");
	assert.equal(tabTone([list[0], list[2]]), null);
});

// ---- the sorting desk: pins, archive, contexts, how far a session is sorted ------------

import { ago, contextOf, locateRaw, contextsOf, keepIn, renameIn, toggleIn, triageOf, withContext } from "../src/modules/sessions/atelier";
import { isTagLine } from "../src/modules/sessions/logic";

test("desk: pinned first (the last pinned on top), then newest first; archived only under their filter", () => {
	const list = [
		info("Old.md", 1, { pin: 1 }),
		info("Mid.md", 2),
		info("New.md", 3),
		info("Pin.md", 0, { pin: 0 }),
		info("Gone.md", 4, { archived: true, pending: 2 }),
	];
	assert.deepEqual(filterSessions(list, "all", "").map((s) => s.path), ["Pin.md", "Old.md", "New.md", "Mid.md"]);
	assert.deepEqual(filterSessions(list, "archived", "").map((s) => s.path), ["Gone.md"]);
	assert.deepEqual(filterCounts(list), { all: 4, open: 4, triage: 0, closed: 0, archived: 1 });
	// An archived session waiting to be sorted no longer counts on the tab nor for the rail.
	assert.equal(tabCount(list), null);
	assert.ok(!serviceList(list).some((s) => s.path === "Gone.md"));
});

test("desk: context chips, filter by context (case ignored)", () => {
	const list = [info("A.md", 1, { context: "work" }), info("B.md", 2, { context: "Work" }), info("C.md", 3, { context: "home" }), info("D.md", 4)];
	assert.deepEqual(contextsOf(list), ["work", "home"]);
	assert.deepEqual(filterSessions(list, "all", "", "WORK").map((s) => s.path), ["B.md", "A.md"]);
	assert.deepEqual(filterSessions(list, "all", "", null).length, 4);
});

test("desk: sorted at N %, ideas without follow-up", () => {
	const closing = closingMatcher(["Brainstorm closed at"]);
	const note = [
		"",
		"[[Inbox]] #work",
		"5 October 2026 · 07:48",
		"",
		"A free thought about the garage.",
		"- [ ] Take the bikes out #home",
		"- [x] Call Sam",
		"- [ ] Book the room",
		"- [?] Keep the newsletter",
		"Do we change the supplier?",
	];
	const s = summarize(note, closing);
	const t = triageOf(s);
	assert.deepEqual([t.tasks, t.done, t.untagged, t.undecided], [3, 1, 1, 1]);
	// Choices: 3 tasks + 1 line to decide; made: the tagged one and the checked one.
	assert.equal(t.sorted, 50);
	assert.deepEqual(t.orphans.map((o) => o.line), [4, 9]);
	// Rounded down: 100 only when nothing waits.
	assert.equal(triageOf(summarize(["- [ ] A #x", "- [ ] B #x", "- [ ] C #x", "- [ ] D #x", "- [ ] E #x", "- [ ] F #x", "- [ ] G"], closing)).sorted, 85);
	assert.equal(triageOf(summarize(["- [ ] A #x"], closing)).sorted, 100);
	assert.equal(triageOf(summarize(["Only prose."], closing)).sorted, null);
	// The context line is never an idea.
	assert.equal(s.ideas, 6);
	assert.equal(summarize(["", "#work", "Text."], closing).ideas, 1);
});

test("desk: the context is read from the top of the note and written there", () => {
	const made = ["", "[[Inbox]]", "5 October 2026 · 07:48", "", "Idea."];
	assert.equal(contextOf(made), null);
	const set = withContext(made, "work");
	assert.deepEqual(set, ["", "[[Inbox]] #work", "5 October 2026 · 07:48", "", "Idea."]);
	assert.equal(contextOf(set), "work");
	assert.deepEqual(withContext(set, "home"), ["", "[[Inbox]] #home", "5 October 2026 · 07:48", "", "Idea."]);
	assert.deepEqual(withContext(set, null), made);
	assert.equal(bodyStart(set), 4);
	// No parent line: a tag line at the top (after the properties and blank lines).
	const plain = ["", "5 October 2026 · 07:48", "", "Idea."];
	const tagged = withContext(plain, "#home");
	assert.deepEqual(tagged, ["", "#home", "5 October 2026 · 07:48", "", "Idea."]);
	assert.equal(contextOf(tagged), "home");
	assert.equal(bodyStart(tagged), 4);
	assert.deepEqual(withContext(tagged, null), plain);
	assert.deepEqual(withContext(["---", "a: 1", "---", "Idea."], "x"), ["---", "a: 1", "---", "#x", "Idea."]);
	// Under a heading.
	assert.deepEqual(withContext(["# Plans", "Idea."], "work"), ["# Plans", "#work", "Idea."]);
	// Tags in ideas or tasks are not a context.
	assert.equal(contextOf(["Call about #work.", "#home"]), null);
	assert.equal(contextOf(["- [ ] Task #work"]), null);
	assert.ok(isTagLine("#a #b/c") && !isTagLine("#2026") && !isTagLine("# Heading"));
});

test("desk: pins and archive follow renames and forget deleted notes", () => {
	assert.deepEqual(toggleIn(["A.md"], "B.md"), ["B.md", "A.md"]);
	assert.deepEqual(toggleIn(["B.md", "A.md"], "B.md"), ["A.md"]);
	assert.deepEqual(renameIn(["A.md", "B.md"], "A.md", "Folder/A.md"), ["Folder/A.md", "B.md"]);
	assert.deepEqual(keepIn(["A.md", "B.md", "A.md", "C.md"], ["A.md", "C.md"]), ["A.md", "C.md"]);
	const merged = mergeSettings(DEFAULTS, { sessions: ["Old.md"] });
	assert.deepEqual([merged.pinned, merged.archived], [[], []]);
	assert.deepEqual(ago(0, 3 * 86_400_000), [-3, "day"]);
	assert.deepEqual(ago(0, 90_000), [-2, "minute"]);
});

test("desk: the context never comes from code or a link alias; under a heading, the tag line is not an idea", () => {
	const closing = closingMatcher(["Brainstorm closed at"]);
	// A code block under the heading: no context read in it, none written in it.
	const code = ["# Plans", "```python3", "# comment", "#work", "```", "Idea."];
	assert.equal(contextOf(code), null);
	assert.deepEqual(withContext(code, "home"), ["# Plans", "#home", "```python3", "# comment", "#work", "```", "Idea."]);
	assert.deepEqual(withContext(["```js", "#x", "```"], "home"), ["#home", "```js", "#x", "```"]);
	// A tag in the alias of a link is not the context; changing it leaves the link alone.
	const alias = ["", "[[Inbox| #old label]] #work", "Idea."];
	assert.equal(contextOf(alias), "work");
	assert.deepEqual(withContext(alias, "home"), ["", "[[Inbox| #old label]] #home", "Idea."]);
	assert.deepEqual(withContext(alias, null), ["", "[[Inbox| #old label]]", "Idea."]);
	// An adopted note with a heading: the tag line under it is not an idea.
	const adopted = withContext(["# Plans", "Call the garage.", "", "Free thought."], "home");
	assert.deepEqual(adopted, ["# Plans", "#home", "Call the garage.", "", "Free thought."]);
	const s = summarize(adopted, closing);
	assert.equal(s.ideas, 2);
	assert.deepEqual(triageOf(s).orphans.map((o) => o.text), ["Call the garage.", "Free thought."]);
});

test("desk: a line to decide is found again before it is caught, never another one", () => {
	assert.equal(locateRaw(["a", "- [?] Keep it", "b"], 1, "- [?] Keep it"), 1);
	assert.equal(locateRaw(["new", "a", "- [?] Keep it"], 1, "- [?] Keep it"), 2);
	assert.equal(locateRaw(["a", "- [ ] Keep it"], 1, "- [?] Keep it"), null);
	assert.equal(locateRaw(["- [?] Twice", "x", "- [?] Twice"], 1, "- [?] Twice"), null);
});
