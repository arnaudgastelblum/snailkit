// The scene of Note menu's card in the settings showcase (docs/showcase.md): the quiet rail on a
// note wakes up, Contents slides out and previews a heading (the note scrolls to it, then back),
// then the panel turns into the calendar of daily notes.
import { setIcon } from "obsidian";

const SVG = "http://www.w3.org/2000/svg";
const POINTER = "M0 0v15.2l4-3.7 2.8 6.3 2.6-1.1-2.7-6.2h5.6z";

const RAIL = ["search", "area", "sun", "zap", "list-tree", "bookmark", "list-checks", "calendar"];
/** Headings of the sample note: level, text. */
const HEADINGS: [number, string][] = [
	[2, "Goals"],
	[2, "Redesign idea"],
	[2, "Meeting notes"],
	[3, "Kickoff"],
	[3, "Review"],
];
/** Days of October 2026 with a daily note, and with open tasks. */
const NOTES = new Set([1, 2, 5, 6, 7, 9, 12, 13, 14, 15, 16, 19, 20]);
const TASKS = new Set([6, 13, 15]);
const TODAY = 20;

export function buildDemo(el: HTMLElement, t: (key: string) => string): void {
	const root = el.createDiv({ cls: "sk-demo-note-rail" });
	root.createDiv({ cls: "sk-demo-note-rail-pane" });

	// The note, which makes room while a panel is open.
	const view = root.createDiv({ cls: "sk-demo-note-rail-view" });
	const note = view.createDiv({ cls: "sk-demo-note-rail-note" });
	const scroll = note.createDiv({ cls: "sk-demo-note-rail-scroll" });
	scroll.createDiv({ cls: "sk-demo-note-rail-h1", text: "Project X" });
	const bars = (widths: number[]) => widths.forEach((w) => (scroll.createDiv({ cls: "sk-demo-note-rail-bar" }).style.width = `${w}%`));
	bars([92, 64]);
	HEADINGS.forEach(([level, text], i) => {
		scroll.createDiv({ cls: `sk-demo-note-rail-h${level}` + (i === HEADINGS.length - 1 ? " is-target" : ""), text });
		bars(i === HEADINGS.length - 1 ? [90, 76, 84, 58, 92, 40] : i % 2 ? [88, 70, 40] : [95, 52]);
	});

	// The rail.
	const rail = root.createDiv({ cls: "sk-demo-note-rail-rail" });
	RAIL.forEach((icon) => {
		const cell = rail.createDiv({ cls: "sk-demo-note-rail-cell" });
		if (icon === "area") cell.createSpan({ cls: "sk-demo-note-rail-area", text: "P" });
		else setIcon(cell, icon);
		if (icon === "list-tree") cell.addClass("is-toc");
		if (icon === "calendar") cell.addClass("is-cal");
	});

	// Contents.
	const toc = root.createDiv({ cls: "sk-demo-note-rail-panel is-toc" });
	const head = (panel: HTMLElement, title: string, sub: string) => {
		const box = panel.createDiv({ cls: "sk-demo-note-rail-head" });
		box.createDiv({ cls: "sk-demo-note-rail-title", text: title });
		box.createDiv({ cls: "sk-demo-note-rail-sub", text: sub });
	};
	head(toc, t("panel.toc"), "Project X");
	toc.createDiv({ cls: "sk-demo-note-rail-progress" });
	HEADINGS.forEach(([level, text], i) => {
		const row = toc.createDiv({ cls: `sk-demo-note-rail-row is-l${level}` + (i === 0 ? " is-current" : "") + (i === HEADINGS.length - 1 ? " is-target" : "") });
		row.createSpan({ text });
	});

	// Calendar.
	const cal = root.createDiv({ cls: "sk-demo-note-rail-panel is-cal" });
	head(cal, t("panel.calendar"), t("demo.month"));
	const grid = cal.createDiv({ cls: "sk-demo-note-rail-grid" });
	for (let i = 0; i < 3; i++) grid.createSpan();
	for (let day = 1; day <= 31; day++) {
		const cell = grid.createSpan({ cls: "sk-demo-note-rail-day" + (day === TODAY ? " is-today" : "") });
		cell.createSpan({ text: String(day) });
		const dots = cell.createSpan({ cls: "sk-demo-note-rail-dots" });
		if (NOTES.has(day)) dots.createSpan({ cls: "is-note" });
		if (TASKS.has(day)) dots.createSpan({ cls: "is-task" });
	}

	const pointer = root.createDiv({ cls: "sk-demo-note-rail-pointer" });
	const svg = pointer.appendChild(document.createElementNS(SVG, "svg"));
	svg.setAttribute("viewBox", "-1 -1 15 21");
	svg.appendChild(document.createElementNS(SVG, "path")).setAttribute("d", POINTER);
}
