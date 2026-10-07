// The scene of Search's card in the settings showcase (docs/showcase.md): three letters typed,
// and notes, tasks, tags and note text that match appear at once, grouped, with a preview.
import { setIcon } from "obsidian";

const QUERY = "gar";

export function buildDemo(el: HTMLElement, t: (key: string) => string): void {
	const root = el.createDiv({ cls: "sk-demo-search" });
	root.createDiv({ cls: "sk-demo-search-window" });

	// The field, typed letter by letter.
	const field = root.createDiv({ cls: "sk-demo-search-field" });
	setIcon(field.createSpan({ cls: "sk-demo-search-ico" }), "search");
	const typed = field.createSpan({ cls: "sk-demo-search-typed" });
	[...QUERY].forEach((letter, i) => typed.createSpan({ cls: `sk-demo-search-k${i}`, text: letter }));
	field.createSpan({ cls: "sk-demo-search-caret" });

	const filters = root.createDiv({ cls: "sk-demo-search-filters" });
	["filter.all", "filter.notes", "filter.tasks", "filter.brainstorms"].forEach((key, i) => filters.createSpan({ cls: i === 0 ? "is-on" : "", text: t(key) }));

	// Matched letters are marked, as in the real results.
	const marked = (parent: HTMLElement, text: string) => {
		const at = text.toLowerCase().indexOf(QUERY);
		parent.appendText(text.slice(0, at));
		parent.createSpan({ cls: "sk-demo-search-hit", text: text.slice(at, at + QUERY.length) });
		parent.appendText(text.slice(at + QUERY.length));
	};

	root.createDiv({ cls: "sk-demo-search-cursor" });
	const group = (i: number, label: string, icon: string) => {
		root.createDiv({ cls: `sk-demo-search-label sk-demo-search-g${i}`, text: label });
		const row = root.createDiv({ cls: `sk-demo-search-row sk-demo-search-r${i}` });
		const ico = row.createSpan({ cls: "sk-demo-search-ico" });
		if (icon === "#") ico.setText("#");
		else setIcon(ico, icon);
		return row.createSpan({ cls: "sk-demo-search-main" });
	};
	const note = group(0, t("group.note"), "file");
	marked(note, "Garden");
	note.createSpan({ cls: "sk-demo-search-sub", text: "Home" });
	marked(group(1, t("group.task"), "square-check"), "Water the garden");
	const tag = group(2, t("group.tag"), "#").createSpan({ cls: "sk-demo-search-tag" });
	marked(tag, "home/garden");
	const content = group(3, t("group.content"), "align-left");
	content.createSpan({ cls: "sk-demo-search-from", text: "Meeting notes" });
	marked(content.createSpan({ cls: "sk-demo-search-snippet" }), "…then water the garden");

	// The preview of the selected result: the note, then the task's note.
	const preview = (cls: string, title: string, line: string) => {
		const pane = root.createDiv({ cls: "sk-demo-search-preview " + cls });
		pane.createDiv({ cls: "sk-demo-search-ptitle", text: title });
		pane.createDiv({ cls: "sk-demo-search-bar is-long" });
		pane.createDiv({ cls: "sk-demo-search-bar" });
		const task = pane.createDiv({ cls: "sk-demo-search-pline" });
		task.createSpan({ cls: "sk-demo-search-box" });
		marked(task.createSpan(), line);
		pane.createDiv({ cls: "sk-demo-search-bar is-long" });
		pane.createDiv({ cls: "sk-demo-search-bar is-short" });
	};
	preview("is-note", "Garden", "Buy seeds for the garden");
	preview("is-task", "Meeting notes", "Water the garden");
}
