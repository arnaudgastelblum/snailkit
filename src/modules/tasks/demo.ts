// The scene of Tasks' card in the settings showcase (docs/showcase.md): tasks written in three
// notes slide into one list grouped by tag, then one is checked, in the list and in its note.
import { setIcon } from "obsidian";

interface Task {
	text: string;
	tag: string;
	/** Note (index in NOTES) and line in that note. */
	note: number;
	line: number;
	/** Group (index in GROUPS) and row in that group. */
	group: number;
	row: number;
}

const NOTES = ["Meeting notes", "Acme", "Project X"];
const GROUPS: [string, number][] = [
	["website", 30],
	["client", 165],
];
/** In the order they are gathered. */
const TASKS: Task[] = [
	{ text: "Fix the footer", tag: "website", note: 0, line: 0, group: 0, row: 0 },
	{ text: "Call Paul", tag: "client", note: 0, line: 1, group: 1, row: 0 },
	{ text: "Send the quote", tag: "client", note: 1, line: 0, group: 1, row: 1 },
	{ text: "New logo", tag: "website", note: 2, line: 0, group: 0, row: 1 },
];
/** The task that gets checked. */
const CHECKED = 2;

// Layout in scene units (1 u = 1/32 of the width; the scene is 32 x 20 u).
const NOTE_TOP = [1.4, 8.1, 13.6];
const NOTE_LEFT = 1.3;
const LINE_TOP = 2.75;
const LINE_STEP = 1.75;
const LIST_LEFT = 14.6;
const GROUP_TOP = [4.9, 11.1];
const ROW_TOP = 1.9;
const ROW_STEP = 1.95;

const SVG = "http://www.w3.org/2000/svg";
const POINTER = "M0 0v15.2l4-3.7 2.8 6.3 2.6-1.1-2.7-6.2h5.6z";

export function buildDemo(el: HTMLElement, t: (key: string) => string): void {
	const root = el.createDiv({ cls: "sk-demo-tasks" });
	const box = (parent: HTMLElement, cls: string, left: number, top: number) => {
		const item = parent.createDiv({ cls });
		item.style.left = `calc(${left} * var(--skd-u))`;
		item.style.top = `calc(${top} * var(--skd-u))`;
		return item;
	};
	const checkbox = (parent: HTMLElement) => {
		const check = parent.createSpan({ cls: "sk-demo-tasks-check" });
		setIcon(check, "check");
		return check;
	};

	// The notes, where the tasks are written.
	NOTES.forEach((name, n) => {
		const note = box(root, `sk-demo-tasks-note sk-demo-tasks-note${n}`, NOTE_LEFT, NOTE_TOP[n]);
		const title = note.createDiv({ cls: "sk-demo-tasks-note-title" });
		setIcon(title.createSpan({ cls: "sk-demo-tasks-ico" }), "file-text");
		title.createSpan({ text: name });
		note.createDiv({ cls: "sk-demo-tasks-bar" });
		const lines = TASKS.filter((task) => task.note === n).length;
		note.style.height = `calc(${LINE_TOP + LINE_STEP * lines - 0.35} * var(--skd-u))`;
	});
	TASKS.forEach((task, i) => {
		const line = box(root, `sk-demo-tasks-line sk-demo-tasks-t${i}` + (i === CHECKED ? " is-checked" : ""), NOTE_LEFT + 0.7, NOTE_TOP[task.note] + LINE_TOP + LINE_STEP * task.line);
		checkbox(line);
		line.createSpan({ cls: "sk-demo-tasks-text", text: task.text });
		line.createSpan({ cls: "sk-demo-tasks-hashtag", text: "#" + task.tag });
	});

	// The list, in the Workbench's Tasks tab.
	const list = root.createDiv({ cls: "sk-demo-tasks-list" });
	list.style.left = `calc(${LIST_LEFT - 0.9} * var(--skd-u))`;
	const head = box(root, "sk-demo-tasks-head", LIST_LEFT, 1.9);
	head.createSpan({ cls: "sk-demo-tasks-title", text: t("title.all") });
	const count = head.createSpan({ cls: "sk-demo-tasks-count" });
	count.createSpan({ cls: "sk-demo-tasks-before", text: t("head.open.other").replace("{count}", "4") });
	count.createSpan({ cls: "sk-demo-tasks-after", text: t("head.open.other").replace("{count}", "3") });

	GROUPS.forEach(([tag, hue], g) => {
		const group = box(root, `sk-demo-tasks-group sk-demo-tasks-g${g}`, LIST_LEFT, GROUP_TOP[g]);
		group.setCssProps({ "--sk-hue": String(hue) });
		group.createSpan({ cls: "sk-demo-tasks-pill", text: tag });
		group.createSpan({ cls: "sk-demo-tasks-n", text: "2" });
		group.createSpan({ cls: "sk-demo-tasks-rule" });
	});
	TASKS.forEach((task, i) => {
		const left = LIST_LEFT + 0.3;
		const top = GROUP_TOP[task.group] + ROW_TOP + ROW_STEP * task.row;
		const row = box(root, `sk-demo-tasks-row sk-demo-tasks-r${i}` + (i === CHECKED ? " is-checked" : ""), left, top);
		// Where the row comes from: its line in the note.
		row.setCssProps({ "--dx": `calc(${NOTE_LEFT + 0.7 - left} * var(--skd-u))` });
		row.setCssProps({ "--dy": `calc(${NOTE_TOP[task.note] + LINE_TOP + LINE_STEP * task.line - top} * var(--skd-u))` });
		checkbox(row);
		row.createSpan({ cls: "sk-demo-tasks-text", text: task.text });
		const from = row.createSpan({ cls: "sk-demo-tasks-from" });
		setIcon(from.createSpan({ cls: "sk-demo-tasks-ico" }), "file-text");
		from.createSpan({ text: NOTES[task.note] });
	});

	// The pointer that checks a task.
	const pointer = box(root, "sk-demo-tasks-pointer", LIST_LEFT + 1.1, GROUP_TOP[1] + ROW_TOP + ROW_STEP + 0.6);
	const svg = pointer.appendChild(document.createElementNS(SVG, "svg"));
	svg.setAttribute("viewBox", "-1 -1 15 21");
	svg.appendChild(document.createElementNS(SVG, "path")).setAttribute("d", POINTER);
}
