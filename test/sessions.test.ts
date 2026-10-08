import assert from "node:assert/strict";
import { test } from "node:test";
import {
	bodyStart,
	candidateRange,
	cleanTitle,
	closingLine,
	closingMatcher,
	LEGACY_CLOSING,
	dayPart,
	defaultCount,
	fish,
	groupTag,
	isPriority,
	hiddenLines,
	isQuestion,
	keywords,
	learn,
	lineInfo,
	looksLikeTask,
	learnVerb,
	infinitiveShape,
	actionVerb,
	newSessionText,
	poseLines,
	proposedTitle,
	remember,
	safeName,
	sentenceAt,
	sentences,
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

test("likely tasks: an infinitive by its shape, in French and Spanish, with elisions and pronouns", () => {
	for (const s of [
		// French -er, -ir, -re
		"Manger les spaghettis",
		"Manger des pommes.",
		"Améliorer le code source",
		"Finir le rapport avant vendredi",
		"Construire une cabane pour les enfants",
		"Peindre la chambre",
		"Résoudre le bug de connexion",
		"Suivre la formation en ligne",
		"Boire plus d'eau",
		"Connaître les horaires du musée",
		"Rompre le contrat",
		// French elisions and pronouns before the infinitive
		"S'inscrire au cours de yoga",
		"M'occuper du jardin",
		"S’en occuper demain",
		"Lui envoyer le devis",
		"Leur dire merci",
		"En parler à Marc",
		"Le rappeler demain",
		"L'appeler ce soir",
		// Spanish -ar, -er, -ir, with attached pronouns
		"Cocinar para el domingo",
		"Comer más fruta",
		"Llamarle mañana",
		"Inscribirse al gimnasio",
		"Escribirle a Ana",
		"Reunirnos con el equipo",
		// Fillers still go first
		"Penser à manger des légumes",
		"Hay que cocinar para el domingo",
		// One word, no other language to contradict it
		"Ranger.",
	]) assert.ok(looksLikeTask(s), s);
	for (const s of [
		// French false friends
		"Hier soir, réunion avec Paul",
		"Premier jet du plan",
		"Dernier point de la réunion",
		"Super idée pour la fête",
		"Cher journal",
		"Hiver très froid cette année",
		"Lettre de motivation",
		"Livre de Murakami",
		"Ordre du jour chargé",
		"Dossier client complet",
		"Courrier du matin",
		"Avenir de l'équipe",
		"Plaisir de lire",
		"Soir de fête",
		"Notre équipe est solide",
		"Entre nous, ça va",
		"Chaque matin, du café",
		"Pour la suite, on verra",
		"Leur maison est grande",
		"Affaire classée",
		"Commentaire de Paul",
		"Secrétaire absente",
		"Être plus patient",
		"Avoir plus de temps",
		"Maître de conférence",
		"Le dîner était bon",
		"L'atelier de Paul",
		// Subject followed by a finite verb
		"Manger est important",
		"Test is failing",
		// Spanish false friends
		"Ayer fui al cine",
		"Lugar de la reunión",
		"Hogar dulce hogar",
		"Mujer del año",
		"Taller de cerámica",
		"Placer de leer",
		"Suerte con el examen",
		"Cuadernos para el colegio",
		"Carlos viene mañana",
		"Parte del dinero",
		// English and Dutch words with Romance endings
		"Never mind the rest",
		"Later today we see",
		"Cover the costs with the budget",
		"Other ideas for the team",
		"Calendar for the next year",
		"Paper on the desk",
		"Weer naar huis",
		"Verder nog iets",
		"Met de kinderen",
		"Gisteren duurde de vergadering lang",
		"Primer borrador del presupuesto",
		// The date line of a new brainstorm, first names
		"October 8, 2026 · 08:30",
		"December 1, 2026 · 9:15",
		"Olivier passe demain",
		// Questions never, whatever the verb
		"Manger des pommes ?",
		"¿Llamarle mañana?",
		"S'inscrire au yoga ?",
	]) assert.ok(!looksLikeTask(s), s);
});

test("likely tasks: Dutch infinitives last, with separable prefixes and -eren; English list", () => {
	for (const s of [
		"De oma terugbellen",
		"Morgen de offerte doorsturen",
		"Het abonnement annuleren",
		"Annuleren abonnement",
		"Kinderen naar school brengen",
		"Cadeau geven",
		"Bring the chairs",
		"Discuss the budget with Sam",
		"Remind Sam about Friday",
		"Follow-up with the bank",
	]) assert.ok(looksLikeTask(s), s);
	for (const s of [
		"Twee weken",
		"Mijn vrienden",
		"Les gens annuleren",
		"The children",
	]) assert.ok(!looksLikeTask(s), s);
	assert.deepEqual(infinitiveShape("manger"), ["fr", "es"]);
	assert.deepEqual(infinitiveShape("cocinar"), ["es"]);
	assert.deepEqual(infinitiveShape("prendre"), ["fr"]);
	assert.deepEqual(infinitiveShape("llamarle"), ["es"]);
	assert.deepEqual(infinitiveShape("reserveren"), ["nl"]);
	assert.deepEqual(infinitiveShape("miroir"), []);
	assert.deepEqual(infinitiveShape("recevoir"), ["fr"]);
	assert.deepEqual(infinitiveShape("faire"), ["fr"]);
	assert.deepEqual(infinitiveShape("commentaire"), []);
	assert.deepEqual(infinitiveShape("hier"), []);
	assert.deepEqual(infinitiveShape("chair"), []);
	assert.equal(actionVerb("S'inscrire au yoga"), "inscrire");
	assert.equal(actionVerb("Améliorer le code"), "ameliorer");
	assert.equal(actionVerb("De verzekering bellen"), "bellen");
});

test("likely tasks learn from the user's gestures", () => {
	// A sentence made a task teaches its first word.
	assert.ok(!looksLikeTask("Gym with Tom"));
	let verbs = learnVerb([], "Gym with Tom", true);
	assert.deepEqual(verbs, [["gym", 1]]);
	assert.ok(looksLikeTask("Gym on Friday", verbs));
	assert.equal(actionVerb("Gym on Friday", verbs), "gym");
	// Folded, without accents, past the fillers and the elisions.
	assert.deepEqual(learnVerb([], "Penser à Écoper le bateau", true), [["ecoper", 1]]);
	// A word already behind the dot is the one taught (Dutch: the last one).
	assert.deepEqual(learnVerb([], "De verzekering bellen", true), [["bellen", 1]]);
	// Nothing to learn from a question, an article or a number.
	assert.deepEqual(learnVerb([], "Gym on Friday?", true), []);
	assert.deepEqual(learnVerb([], "The gym", true), []);
	assert.deepEqual(learnVerb([], "42 push-ups", true), []);
	assert.deepEqual(learnVerb([], "Le dossier Dupont", true), []);
	// A dotted sentence kept as an idea loses weight: twice for a shaped verb, four times for a known one.
	let m = learnVerb([], "Manger des pommes", false);
	assert.deepEqual(m, [["manger", -1]]);
	assert.ok(looksLikeTask("Manger des pommes", m));
	m = learnVerb(m, "Manger des pommes", false);
	assert.ok(!looksLikeTask("Manger des pommes", m));
	// Without a dot, nothing more is lowered.
	assert.equal(learnVerb(m, "Manger des pommes", false), m);
	let t: ReturnType<typeof learnVerb> = [];
	for (let i = 0; i < 3; i++) t = learnVerb(t, "Trier les vêtements", false);
	assert.ok(looksLikeTask("Trier les vêtements", t));
	t = learnVerb(t, "Trier les vêtements", false);
	assert.ok(!looksLikeTask("Trier les vêtements", t));
	assert.deepEqual(t, [["trier", -4]]);
	// Made a task again: it comes back; a word back to 0 is forgotten.
	m = learnVerb(m, "Manger des pommes", true);
	assert.ok(looksLikeTask("Manger des pommes", m));
	m = learnVerb(m, "Manger des pommes", true);
	assert.deepEqual(m, []);
	// Weights stay within bounds.
	let g: ReturnType<typeof learnVerb> = [];
	for (let i = 0; i < 10; i++) g = learnVerb(g, "Gym with Tom", true);
	assert.deepEqual(g, [["gym", 4]]);
	// The most recent first, and a cap that keeps the surest words.
	let many: ReturnType<typeof learnVerb> = [["sure", 4]];
	for (let i = 0; i < 30; i++) many = learnVerb(many, `Word${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))} now`, true, 10);
	assert.equal(many.length, 10);
	assert.ok(many.some(([w]) => w === "sure"));
	assert.equal(many[0][0], "worddb");
	// Garbage in the settings is ignored.
	assert.ok(!looksLikeTask("Gym on Friday", [["gym"] as unknown as [string, number]]));
	assert.ok(looksLikeTask("Call Sam", null as unknown as []));
	// Forgetting is an empty list, kept on reset like the learned tags.
	assert.deepEqual(DEFAULTS.verbs, []);
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

test("the suggestion names the word that earned it", () => {
	let learned = learn([], "Call the insurer about the car", "home/car");
	learned = learn(learned, "Check the car tires", "home/car");
	assert.deepEqual(suggestion("Ask the insurer about the car", learned, []), { tag: "home/car", word: "car" });
	assert.deepEqual(suggestion("Water the garden", [], ["Home/Garden"]), { tag: "Home/Garden", word: "garden" });
	assert.equal(suggestion("Something unrelated", learned, []), null);
	assert.equal(suggestTag("Ask the insurer about the car", learned, []), "home/car");
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

// ----- the path: Write, Sort, Finish, Archive -----
import { applyEdit, bodyLineCount, countsOf, decide as decideLine, flowOf, holdsFence, leadOf, linesOf, mapLine, nextAction, revertOf, sortItems, sortWord, stepStates, weekRecap } from "../src/modules/sessions/flow";
import { summarize as summarizeNote } from "../src/modules/sessions/logic";

const noClose = (_: string) => false;
const base = { closed: false, archived: false, ideas: 5, tasks: 2, untagged: 0, undecided: 0, lines: 9 };

test("where a brainstorm stands: sort first when something waits, then finish, finished, archived", () => {
	assert.equal(flowOf({ ...base, ideas: 0, tasks: 0, lines: 0 }).kind, "new");
	assert.equal(flowOf({ ...base, tasks: 0 }).kind, "write");
	assert.equal(flowOf({ ...base, untagged: 2, undecided: 1 }).kind, "sort");
	assert.equal(flowOf({ ...base, untagged: 2, undecided: 1 }).toSort, 3);
	assert.equal(flowOf(base).kind, "ready");
	assert.equal(flowOf({ ...base, closed: true, untagged: 3 }).kind, "closed");
	assert.equal(flowOf({ ...base, closed: true, archived: true }).kind, "archived");
	assert.deepEqual(stepStates(flowOf({ ...base, untagged: 1 })), ["done", "current", "todo", "todo"]);
	assert.deepEqual(stepStates(flowOf(base)), ["done", "done", "current", "todo"]);
	assert.deepEqual(stepStates(flowOf({ ...base, archived: true })), ["done", "done", "done", "done"]);
	assert.equal(nextAction(flowOf({ ...base, untagged: 1 })), "sort");
	assert.equal(nextAction(flowOf({ ...base, tasks: 0 })), "finish");
	assert.equal(nextAction(flowOf({ ...base, closed: true })), "archive");
	assert.equal(nextAction(flowOf({ ...base, ideas: 0, tasks: 0 })), null);
	assert.equal(sortWord({ untagged: 2, undecided: 0 }), "tasks");
	assert.equal(sortWord({ untagged: 0, undecided: 2 }), "lines");
	assert.equal(sortWord({ untagged: 1, undecided: 1 }), "lines");
	// A week without change, still open: invited to finish; never once finished.
	const week = 7 * 86_400_000;
	assert.ok(flowOf({ ...base, modified: 0, now: week }).stale);
	assert.ok(!flowOf({ ...base, modified: 1, now: week }).stale);
	assert.ok(!flowOf({ ...base, closed: true, modified: 0, now: week }).stale);
});

const NOTE = ["", "[[Inbox]]", "October 5, 2026 · 07:48", "", "Three zones.", "- [ ] Take the bikes out #home", "\tMeasure the wall.", "- [ ] Sort the boxes", "\tThe big ones.", "- [?] Keep the mower?", "- [x] Done already", "A lamp.", ""];

test("the tally counts what was dropped and launched; the lines to sort, in order", () => {
	const s = summarizeNote(NOTE, noClose);
	assert.deepEqual(countsOf(s, bodyLineCount(NOTE, noClose)), { ideas: 6, tasks: 3, untagged: 1, undecided: 1, loose: 0, lines: 8 });
	assert.deepEqual(sortItems(s, NOTE, noClose).map((x) => [x.line, x.kind, x.text, x.description]), [
		[7, "task", "Sort the boxes", ["The big ones."]],
		[9, "decide", "Keep the mower?", []],
	]);
	assert.equal(bodyLineCount(["", "[[Inbox]]", "Oct 5, 2026", "", "", "*Brainstorm closed at 08:00*"], (l) => l.startsWith("*Brainstorm")), 0);
});

test("each decision rewrites the line found again, and is taken back exactly", () => {
	const items = sortItems(summarizeNote(NOTE, noClose), NOTE, noClose);
	const task = items[0];
	const ask = items[1];
	const tagged = decideLine(NOTE, task, "task", "home/car", "\t", noClose)!;
	assert.deepEqual(tagged.inserted, ["- [ ] Sort the boxes #home/car"]);
	const decided = decideLine(NOTE, task, "decide", null, "\t", noClose)!;
	assert.deepEqual(decided.inserted, ["- [?] Sort the boxes"]);
	const idea = decideLine(NOTE, ask, "idea", null, "\t", noClose)!;
	assert.deepEqual(idea.inserted, ["- Keep the mower?"]);
	const asTask = decideLine(NOTE, ask, "task", "home", "\t", noClose)!;
	assert.match(asTask.inserted[0], /^- \[ \] Keep the mower\?? #home$/);
	// Delete: the task and its description go together.
	const gone = decideLine(NOTE, task, "delete", null, "\t", noClose)!;
	assert.deepEqual(gone.removed, ["- [ ] Sort the boxes", "\tThe big ones."]);
	const after = applyEdit(NOTE, gone);
	assert.ok(!after.includes("\tThe big ones."));
	assert.deepEqual(applyEdit(after, revertOf(after, gone)!), NOTE);
	// Only at the very place it was made: a line added above meanwhile, nothing is undone.
	assert.equal(revertOf(["New first line", ...after], gone), null);
	const t2 = applyEdit(NOTE, tagged);
	assert.deepEqual(applyEdit(t2, revertOf(t2, tagged)!), NOTE);
	// The line changed: no decision, no undo.
	assert.equal(decideLine(NOTE, { line: 7, raw: "- [ ] Something else", block: [] }, "idea", null, "\t", noClose), null);
	assert.equal(revertOf(NOTE, tagged), null);
	// A task needs its tag.
	assert.equal(decideLine(NOTE, task, "task", null, "\t", noClose), null);
});

test("the tab's lead sentence and the recap of the week", () => {
	const flows = [flowOf({ ...base, untagged: 2 }), flowOf(base), flowOf({ ...base, closed: true, untagged: 5 }), flowOf({ ...base, undecided: 1 })];
	assert.deepEqual(leadOf(flows), { live: 3, untagged: 2, undecided: 1, loose: 0, ready: 1 });
	assert.equal(leadOf([flowOf({ ...base, loose: 4 })]).loose, 4);
	const day = 86_400_000;
	assert.deepEqual(weekRecap([{ created: 10 * day, tasks: 3 }, { created: 2 * day, tasks: 9 }, { created: 9.5 * day, tasks: 1 }], 10 * day), { brainstorms: 2, tasks: 4 });
});

const call = ["", "[[Inbox]]", "October 5, 2026", "", "- [ ] Remove the old shelf", "	Carefully.", "- [ ] Call", "- [ ] Call", "A note."];

test("sorting identical lines: each decision moves the lines below, the right one is written and taken back", () => {
	const items = sortItems(summarizeNote(call, noClose), call, noClose);
	assert.deepEqual(items.map((x) => x.line), [4, 6, 7]);
	let lines = [...call];
	const gone = decideLine(lines, items[0], "delete", null, "	", noClose)!;
	lines = applyEdit(lines, gone);
	// The lines still to sort follow the edit.
	const second = { ...items[1], line: mapLine(items[1].line, gone)! };
	const third = { ...items[2], line: mapLine(items[2].line, gone)! };
	assert.deepEqual([second.line, third.line], [4, 5]);
	const tagged = decideLine(lines, second, "task", "work", "	", noClose)!;
	assert.equal(tagged.at, 4);
	lines = applyEdit(lines, tagged);
	assert.deepEqual(lines.slice(4, 6), ["- [ ] Call #work", "- [ ] Call"]);
	// The tagged task edited by hand, an identical one elsewhere: undo refuses, the other keeps its tag.
	const edited = [...lines];
	edited[4] = "- [ ] Call back";
	edited.push("- [ ] Call #work");
	assert.equal(revertOf(edited, tagged), null);
	// Untouched: taken back exactly, then the deletion too.
	lines = applyEdit(lines, revertOf(lines, tagged)!);
	lines = applyEdit(lines, revertOf(lines, gone)!);
	assert.deepEqual(lines, call);
	assert.equal(mapLine(5, gone), null);
});

test("sorting never writes in code, never deletes a block that changed or holds a fence, and an emptied note fills again", () => {
	const fenced = ["", "Ideas", "", "```", "- [ ] Example", "```"];
	assert.equal(decideLine(fenced, { line: 4, raw: "- [ ] Example", block: ["- [ ] Example"] }, "idea", null, "	", noClose), null);
	// A tagged or checked task is no longer to sort.
	assert.equal(decideLine(["- [ ] Call #work"], { line: 0, raw: "- [ ] Call #work", block: [] }, "idea", null, "	", noClose), null);
	// The description changed since it was shown: Delete refuses.
	const shown = { line: 0, raw: "- [ ] Paint", block: ["- [ ] Paint", "	Blue."] };
	assert.equal(decideLine(["- [ ] Paint", "	Blue.", "	And green."], shown, "delete", null, "	", noClose), null);
	assert.ok(decideLine(["- [ ] Paint", "	Blue.", "Next."], shown, "delete", null, "	", noClose));
	// A fence inside the description: never deleted in one go.
	const code = ["- [ ] Script", "	```", "	- [ ] sample", "	```"];
	assert.ok(holdsFence(code));
	assert.equal(decideLine(code, { line: 0, raw: "- [ ] Script", block: code }, "delete", null, "	", noClose), null);
	// A note made of one task, no final line break: deleted, then taken back.
	const single = linesOf("- [ ] Only");
	const gone = decideLine(single, { line: 0, raw: "- [ ] Only", block: ["- [ ] Only"] }, "delete", null, "	", noClose)!;
	const empty = linesOf(applyEdit(single, gone).join("\n"));
	assert.deepEqual(empty, []);
	assert.equal(applyEdit(empty, revertOf(empty, gone)!).join("\n"), "- [ ] Only");
});

// ----- sorting the free sentences (likely tasks, questions) -----
import { keptPrints, leftover, looseItems, prunePrints } from "../src/modules/sessions/flow";
import { fingerprint, markOf } from "../src/modules/sessions/logic";
import { keepKept, keptIn, renameKept, withKept } from "../src/modules/sessions/atelier";

const FREE = ["", "[[Inbox]]", "October 8, 2026", "", "Call the plumber about the leak.", "Buy paint for the hall.", "The garden looks nice in October.", "Should we repaint the hall?", "Send the photos to Sam.", ""];

test("free sentences with a dot enter the sorting, in the order of the note, and count as to sort", () => {
	const s = summarizeNote(FREE, noClose);
	const items = sortItems(s, FREE, noClose);
	assert.deepEqual(items.map((x) => [x.line, x.kind, x.text]), [
		[4, "likely", "Call the plumber about the leak."],
		[5, "likely", "Buy paint for the hall."],
		[7, "question", "Should we repaint the hall?"],
		[8, "likely", "Send the photos to Sam."],
	]);
	const loose = looseItems(FREE, noClose).length;
	const flow = flowOf({ closed: false, archived: false, ...countsOf(s, bodyLineCount(FREE, noClose), loose) });
	assert.equal(flow.kind, "sort");
	assert.equal(flow.toSort, 4);
	assert.equal(sortWord(flow), "lines");
	assert.equal(nextAction(flow), "sort");
	assert.deepEqual(leftover(flow), { sort: 4, decide: 0 });
	// Untagged tasks and dotted sentences: still "lines".
	assert.equal(sortWord({ untagged: 2, undecided: 0, loose: 1 }), "lines");
	// Once every line is sorted (kept as ideas here), Finish.
	const kept = new Set(items.map((x) => fingerprint(x.text)));
	assert.equal(looseItems(FREE, noClose, { kept }).length, 0);
	assert.equal(nextAction(flowOf({ closed: false, archived: false, ...countsOf(s, bodyLineCount(FREE, noClose), 0) })), "finish");
});

test("the dotted sentence is the editor's: a task first, else a question; kept ones are passed over; never in a description", () => {
	assert.equal(markOf("Nice view. Call the plumber.")?.sentence.text, "Call the plumber.");
	assert.equal(markOf("Is it red? Call the plumber.")?.kind, "task");
	assert.equal(markOf("Is it red? Nice.")?.kind, "question");
	assert.equal(markOf("Call the plumber. Is it red?", [], new Set([fingerprint("Call the plumber.")]))?.kind, "question");
	assert.equal(markOf("A calm evening."), null);
	const lines = ["- [ ] Paint the hall #home", "\tBuy paint first.", "", "\tCall Sam about it.", "Buy brushes.", "```", "Call nobody.", "```"];
	assert.deepEqual(looseItems(lines, noClose).map((x) => x.text), ["Buy brushes."]);
});

test("each choice on a free sentence: caught like Ctrl+Enter, to decide, deleted alone, kept untouched; all taken back", () => {
	const lines = ["", "Ideas", "", "Nice view. Call the plumber about the leak. Then rest.", "Buy paint for the hall."];
	const [first, second] = looseItems(lines, noClose);
	const task = decideLine(lines, first, "task", "home", "\t", noClose)!;
	assert.deepEqual(task.inserted, ["Nice view.", "- [ ] Call the plumber about the leak #home", "Then rest."]);
	assert.deepEqual(applyEdit(applyEdit(lines, task), revertOf(applyEdit(lines, task), task)!), lines);
	const ask = decideLine(lines, second, "decide", null, "\t", noClose)!;
	assert.deepEqual(ask.inserted, ["- [?] Buy paint for the hall"]);
	const gone = decideLine(lines, first, "delete", null, "\t", noClose)!;
	assert.deepEqual(gone.inserted, ["Nice view. Then rest."]);
	const alone = decideLine(lines, second, "delete", null, "\t", noClose)!;
	assert.deepEqual(alone.inserted, []);
	const after = applyEdit(lines, alone);
	assert.deepEqual(applyEdit(after, revertOf(after, alone)!), lines);
	// Kept as an idea: nothing is written in the note.
	assert.equal(decideLine(lines, first, "idea", null, "\t", noClose), null);
	// A task needs its tag; a sentence edited meanwhile is left alone.
	assert.equal(decideLine(lines, first, "task", null, "\t", noClose), null);
	const edited = [...lines];
	edited[4] = "Buy paint for the hall today.";
	assert.equal(decideLine(edited, second, "decide", null, "\t", noClose), null);
	// A question caught to decide keeps its question mark.
	const q = looseItems(["Should we repaint the hall?"], noClose)[0];
	assert.deepEqual(decideLine(["Should we repaint the hall?"], q, "decide", null, "\t", noClose)!.inserted, ["- [?] Should we repaint the hall?"]);
});

test("kept as an idea: remembered by print in the settings, never sorted again, even after a restart", () => {
	const items = looseItems(FREE, noClose);
	const call = items[0];
	const prints = keptPrints(call, null);
	assert.deepEqual(prints, [fingerprint("Call the plumber about the leak.")]);
	// The print does not copy the sentence.
	assert.ok(!prints[0].includes("plumber"));
	let kept = withKept([], "Ideas.md", prints, true);
	// Saved in data.json and read back at the next start.
	const merged = mergeSettings(DEFAULTS, JSON.parse(JSON.stringify({ sessions: ["Ideas.md"], kept })));
	const again = sortItems(summarizeNote(FREE, noClose), FREE, noClose, { kept: new Set(keptIn(merged.kept, "Ideas.md")) });
	assert.ok(!again.some((x) => x.text === call.text));
	assert.equal(again.length, 3);
	// Older settings get an empty list.
	assert.deepEqual(mergeSettings(DEFAULTS, { sessions: ["Old.md"] }).kept, []);
	// The prints follow the note, leave with it, and Undo takes them back.
	kept = renameKept(kept, "Ideas.md", "Folder/Ideas.md");
	assert.deepEqual(keptIn(kept, "Folder/Ideas.md"), prints);
	assert.deepEqual(keepKept(kept, ["Other.md"]), []);
	assert.deepEqual(withKept(kept, "Folder/Ideas.md", prints, false), []);
	// Only the sentences still in the note are remembered.
	assert.deepEqual(prunePrints([...prints, "gone1"], FREE), prints);
	// A task kept as an idea becomes "- Text": its sentence is remembered too, else it would come back with a dot.
	const t = { kind: "task" as const, text: "Call Sam" };
	assert.deepEqual(keptPrints(t, { inserted: ["- Call Sam"] }), [fingerprint("Call Sam")]);
	assert.equal(looseItems(["- Call Sam"], noClose, { kept: new Set(keptPrints(t, { inserted: ["- Call Sam"] })) }).length, 0);
});

test("the sorting offers exactly the dotted lines: nested descriptions left out, a short numbered sentence kept in", () => {
	const nested = ["- [ ] Parent #work", "\t- [ ] Child", "\tCall the plumber.", "Call the plumber again."];
	assert.deepEqual(looseItems(nested, noClose).map((x) => x.line), [3]);
	assert.deepEqual(looseItems(["Buy 2 pencils"], noClose).map((x) => x.text), ["Buy 2 pencils"]);
	// The header of a new brainstorm never gets a dot.
	assert.deepEqual(looseItems(["", "[[Inbox]]", "October 8, 2026", "", "Buy 2 pencils"], noClose).map((x) => x.line), [4]);
});
