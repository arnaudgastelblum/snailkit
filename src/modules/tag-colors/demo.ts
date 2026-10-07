// The scene of Tags' card in the settings showcase (docs/showcase.md): plain #tags in a note turn
// into capsules colored by family, then typing # opens the menu, which suggests this note's tags
// first.
import { setIcon } from "obsidian";

/** Families and their hues; a family's tags share its capsule color. */
const HUES: Record<string, number> = { project: 30, home: 175, reading: 330 };
const SUB_HUES: Record<string, number> = { website: 300, party: 210, garden: 235 };
const LINES: [string, string][] = [
	["Fix the footer", "project/website"],
	["Book the venue", "project/party"],
	["Water the garden", "home/garden"],
	["Read chapter 3", "reading"],
	["Buy seeds", "home/garden"],
];
/** The # menu: tag, and where it comes from (this note). */
const MENU: [string, boolean][] = [
	["home/garden", true],
	["project/website", false],
];

export function buildDemo(el: HTMLElement, t: (key: string) => string): void {
	const root = el.createDiv({ cls: "sk-demo-tag-colors" });
	root.createDiv({ cls: "sk-demo-tag-colors-pane" });
	root.createDiv({ cls: "sk-demo-tag-colors-title", text: "Meeting notes" });

	const capsule = (parent: HTMLElement, tag: string) => {
		const [family, ...rest] = tag.split("/");
		const cap = parent.createSpan({ cls: "sk-demo-tag-colors-capsule" + (rest.length ? " is-nested" : "") });
		cap.setCssProps({ "--sk-hue": String(HUES[family]) });
		cap.createSpan({ cls: "sk-demo-tag-colors-cap", text: family });
		if (rest.length) {
			const body = cap.createSpan({ cls: "sk-demo-tag-colors-body", text: rest.join(" › ") });
			body.setCssProps({ "--sk-hue": String(SUB_HUES[rest[rest.length - 1]]) });
		}
		return cap;
	};

	LINES.forEach(([text, tag], i) => {
		const line = root.createDiv({ cls: `sk-demo-tag-colors-line sk-demo-tag-colors-l${i}` });
		line.createSpan({ cls: "sk-demo-tag-colors-box" });
		line.createSpan({ cls: "sk-demo-tag-colors-text", text });
		const slot = line.createSpan({ cls: "sk-demo-tag-colors-slot" });
		slot.createSpan({ cls: "sk-demo-tag-colors-raw", text: i === LINES.length - 1 ? "#" : "#" + tag });
		capsule(slot, tag);
	});

	// The # menu, under the last line.
	const menu = root.createDiv({ cls: "sk-demo-tag-colors-menu" });
	MENU.forEach(([tag, here], i) => {
		const row = menu.createDiv({ cls: "sk-demo-tag-colors-option" + (i === 0 ? " is-on" : "") });
		capsule(row, tag);
		if (here) row.createSpan({ cls: "sk-demo-tag-colors-where", text: t("suggest.note") });
		if (i === 0) setIcon(row.createSpan({ cls: "sk-demo-tag-colors-enter" }), "corner-down-left");
	});
	const keys = menu.createDiv({ cls: "sk-demo-tag-colors-keys" });
	keys.createSpan({ cls: "sk-demo-tag-colors-kbd", text: "Tab" });
	keys.createSpan({ text: t("suggest.tab") });
	keys.createSpan({ cls: "sk-demo-tag-colors-kbd", text: "↵" });
	keys.createSpan({ text: t("suggest.enter") });
}
