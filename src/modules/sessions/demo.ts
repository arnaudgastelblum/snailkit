// The scene of Brainstorm's card in the settings showcase (docs/showcase.md): ideas are typed
// freely in a note, then one sentence is caught as a task with a tag, and a question is kept
// "to decide".
import { setIcon } from "obsidian";

const SVG = "http://www.w3.org/2000/svg";
const POINTER = "M0 0v15.2l4-3.7 2.8 6.3 2.6-1.1-2.7-6.2h5.6z";

/** The sentences, and the mark in their margin: an action verb (dot) or a question. */
const LINES: [string, "dot" | "ask"][] = [
	["Clean up the garage before winter.", "dot"],
	["Call the insurer about the car", "dot"],
	["Do we keep the newsletter?", "ask"],
	["Buy paint for the fence.", "dot"],
];
/** The tag column: name, sub-tags, hue. The first one is chosen. */
const TAGS: [string, string, number][] = [
	["home", "car · garden", 200],
	["project", "website · party", 30],
	["client", "acme", 150],
];

export function buildDemo(el: HTMLElement, t: (key: string) => string): void {
	const root = el.createDiv({ cls: "sk-demo-sessions" });
	root.createDiv({ cls: "sk-demo-sessions-pane" });

	const pill = root.createDiv({ cls: "sk-demo-sessions-pill" });
	pill.createSpan({ cls: "sk-demo-sessions-pill-dot" });
	pill.createSpan({ text: t("flow.write") });
	pill.createSpan({ cls: "sk-demo-sessions-after", text: ` · ${t("flow.undecided.one").replace("{count}", "1")}` });

	const title = t("title.template").replace("{date}", t("demo.date")).replace("{part}", t("part.morning"));
	root.createDiv({ cls: "sk-demo-sessions-title", text: title });

	LINES.forEach(([text, mark], i) => {
		const line = root.createDiv({ cls: `sk-demo-sessions-line sk-demo-sessions-l${i}` });
		line.createSpan({ cls: `sk-demo-sessions-mark is-${mark}`, text: mark === "ask" ? "?" : "" });
		const hover = line.createSpan({ cls: "sk-demo-sessions-hover" });
		setIcon(hover.createSpan({ cls: "sk-demo-sessions-btn is-plus" }), "plus");
		hover.createSpan({ cls: "sk-demo-sessions-btn is-ask", text: "?" });
		const body = line.createSpan({ cls: "sk-demo-sessions-body" });
		if (i === 1) setIcon(body.createSpan({ cls: "sk-demo-sessions-box" }), "check");
		if (i === 2) body.createSpan({ cls: "sk-demo-sessions-box is-ask", text: "?" });
		body.createSpan({ cls: "sk-demo-sessions-text", text });
		if (i === 1) {
			const tag = body.createSpan({ cls: "sk-demo-sessions-tag" });
			tag.setCssProps({ "--sk-hue": String(TAGS[0][2]) });
			tag.createSpan({ cls: "sk-demo-sessions-cap", text: TAGS[0][0] });
			tag.createSpan({ cls: "sk-demo-sessions-leaf", text: "car" });
		}
	});

	// The tag column that opens under the caught sentence.
	const picker = root.createDiv({ cls: "sk-demo-sessions-picker" });
	const step = picker.createDiv({ cls: "sk-demo-sessions-step" });
	step.createSpan({ cls: "sk-demo-sessions-num", text: "2" });
	step.createSpan({ text: t("panel.step-tag") });
	TAGS.forEach(([name, subs, hue], i) => {
		const row = picker.createDiv({ cls: "sk-demo-sessions-option" + (i === 0 ? " is-on" : "") });
		row.setCssProps({ "--sk-hue": String(hue) });
		row.createSpan({ cls: "sk-demo-sessions-dot" });
		row.createSpan({ cls: "sk-demo-sessions-name", text: name });
		row.createSpan({ cls: "sk-demo-sessions-subs", text: i === 0 ? t("why.learned").replace("{word}", "car") : subs });
		if (i === 0) setIcon(row.createSpan({ cls: "sk-demo-sessions-enter" }), "corner-down-left");
	});

	const pointer = root.createDiv({ cls: "sk-demo-sessions-pointer" });
	const svg = pointer.appendChild(document.createElementNS(SVG, "svg"));
	svg.setAttribute("viewBox", "-1 -1 15 21");
	svg.appendChild(document.createElementNS(SVG, "path")).setAttribute("d", POINTER);
}
