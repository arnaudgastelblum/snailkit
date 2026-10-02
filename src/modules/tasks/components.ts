// Small DOM pieces of the task list: icons, the checkbox, tag capsules, titles, the tag picker.
import { SuggestModal, setIcon } from "obsidian";
import { fallbackHue } from "./group";
import { inlineParts } from "./parse";
import type { TasksHub } from "./hub";

const TAG_NAME_RE = /^[\p{L}\p{N}_][\p{L}\p{N}_/-]*$/u;

export function icon(parent: HTMLElement, name: string, cls?: string): HTMLElement {
	const el = parent.createSpan({ cls: "sk-tasks-ic" + (cls ? " " + cls : "") });
	setIcon(el, name);
	return el;
}

/** A round-cornered box whose check mark draws itself when the task is completed. */
export function checkbox(parent: HTMLElement, cls?: string): HTMLElement {
	const box = parent.createDiv({ cls: "sk-tasks-cb" + (cls ? " " + cls : ""), attr: { role: "checkbox", "aria-checked": "false" } });
	const svg = box.createSvg("svg", { attr: { viewBox: "0 0 24 24", "aria-hidden": "true" } });
	svg.createSvg("path", { attr: { pathLength: "1", d: "M5 12.5l4.5 4.5L19 7.5" } });
	return box;
}

export function kbd(parent: HTMLElement, text: string): HTMLElement {
	return parent.createEl("kbd", { cls: "sk-tasks-kbd", text });
}

/** Draws the inline Markdown of a title (code, bold, italic, highlight, strike, link names). */
export function renderInline(parent: HTMLElement, text: string): HTMLElement {
	for (const part of inlineParts(text)) {
		if (part.kind === "text") parent.appendText(part.text);
		else if (part.kind === "code") parent.createEl("code", { cls: "sk-tasks-code", text: part.text });
		else if (part.kind === "mark") parent.createEl("mark", { cls: "sk-tasks-mark", text: part.text });
		else if (part.kind === "link") parent.createSpan({ cls: "sk-tasks-link", text: part.text });
		else parent.createEl(part.kind, { text: part.text });
	}
	return parent;
}

/**
 * Colors an element for a tag: the classes of the Tag colors module when it runs, else a
 * stable hue of our own. Without classes the shared variables are reset, so a colored parent
 * never leaks its color into this element.
 */
export function colorFor(el: HTMLElement, tag: string, hub: TasksHub): void {
	const classes = hub.tagClasses(tag);
	if (classes) {
		el.addClasses(classes.split(/\s+/).filter(Boolean));
		return;
	}
	for (const name of ["--sk-tag-r-bg", "--sk-tag-r-fg", "--sk-tag-l-bg", "--sk-tag-l-fg"]) el.style.setProperty(name, "initial");
	el.style.setProperty("--sk-tasks-hr", String(fallbackHue(tag.split("/")[0])));
	el.style.setProperty("--sk-tasks-hl", String(fallbackHue(tag)));
}

/** Tag capsule: [ PROJECT ][ website › footer ]. */
export function capsule(parent: HTMLElement, tag: string, hub: TasksHub, cls?: string): HTMLElement {
	const parts = tag.split("/");
	const el = parent.createSpan({ cls: "sk-tasks-cap" + (parts.length > 1 ? " is-joined" : "") + (cls ? " " + cls : "") });
	colorFor(el, tag, hub);
	el.createSpan({ cls: "sk-tasks-cap-root", text: parts[0] });
	if (parts.length > 1) {
		const body = el.createSpan({ cls: "sk-tasks-cap-body" });
		parts.slice(1).forEach((part, i) => {
			if (i) body.createSpan({ cls: "sk-tasks-chev", text: "›" });
			body.createSpan({ text: part, cls: i === parts.length - 2 ? "sk-tasks-leaf" : "sk-tasks-mid" });
		});
	}
	return el;
}

export function tagDot(parent: HTMLElement, tag: string, hub: TasksHub): HTMLElement {
	const el = parent.createSpan({ cls: "sk-tasks-dot" });
	colorFor(el, tag, hub);
	return el;
}

/** Pick a tag (or type a new one) to move a task to, or to focus on. */
export class TagSuggestModal extends SuggestModal<string> {
	constructor(
		private readonly hub: TasksHub,
		private readonly current: string | null,
		placeholder: string,
		private readonly onPick: (tag: string) => void,
	) {
		super(hub.ctx.app);
		hub.ctx.register(() => this.close());
		this.limit = 200;
		this.setPlaceholder(placeholder);
	}

	getSuggestions(query: string): string[] {
		const q = query.trim().replace(/^#/, "").toLowerCase();
		const flags = this.hub.index.flags();
		const tags = this.hub.index.allTags().filter((tag) => tag !== this.current && tag.includes(q));
		if (q && TAG_NAME_RE.test(q) && !flags.has(q) && !tags.includes(q) && q !== this.current) tags.unshift(q);
		return tags;
	}

	renderSuggestion(tag: string, el: HTMLElement): void {
		el.addClass("sk-tasks-suggest");
		capsule(el, tag, this.hub);
		const count = this.hub.index.open().filter((t) => t.primary === tag).length;
		el.createSpan({ cls: "sk-tasks-suggest-n", text: count ? String(count) : this.hub.ctx.t("tag.new") });
	}

	onChooseSuggestion(tag: string): void {
		this.onPick(tag);
	}
}
