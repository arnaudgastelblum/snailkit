// The state of a brainstorm in words, shared by the pill of the note, the cards of the Brainstorms
// tab and its detail: the frieze of the four steps, the tally (what was dropped and launched), a
// soft invitation, and one button for the next step.
import { setIcon } from "obsidian";
import { nextAction, sortWord, stepStates, STEPS, type Flow } from "./flow";

export type CardAction = "sort" | "finish" | "archive" | "unarchive" | "reopen" | "show" | "open";

export interface Words {
	t(key: string, vars?: Record<string, string | number>): string;
	tn(key: string, n: number, vars?: Record<string, string | number>): string;
}

/** "In progress · 2 without tag · 1 to decide", "Ready to finish", "Finished"... */
export function stateLabel(w: Words, flow: Flow): string {
	if (flow.kind !== "sort") return w.t(`flow.${flow.kind}`);
	const parts = [w.t("flow.write")];
	if (flow.untagged) parts.push(w.tn("flow.untagged", flow.untagged));
	if (flow.undecided) parts.push(w.tn("flow.undecided", flow.undecided));
	return parts.join(" · ");
}

/** The label of the next step's button ("Sort 3 lines", "Finish"...), or "". */
export function actionLabel(w: Words, flow: Flow, action: CardAction): string {
	if (action === "sort") return w.tn(sortWord(flow) === "tasks" ? "flow.sort-tasks" : "flow.sort-lines", flow.toSort);
	return w.t(`flow.${action}`);
}

const ICONS: Record<CardAction, string> = { sort: "list-filter", finish: "check", archive: "archive", unarchive: "archive-restore", reopen: "rotate-ccw", show: "eye", open: "file-pen-line" };

/** A text whose number is bold: the key formatted with its count, the number wrapped in <b>. */
export function countText(el: HTMLElement, text: string, n: number): void {
	const at = text.indexOf(String(n));
	if (at < 0) {
		el.appendText(text);
		return;
	}
	if (at) el.appendText(text.slice(0, at));
	el.createEl("b", { text: String(n) });
	el.appendText(text.slice(at + String(n).length));
}

/** The frieze: four dots joined by a line, the current one lit. */
export function frieze(el: HTMLElement, w: Words, flow: Flow, breathe = true): HTMLElement {
	const states = stepStates(flow);
	const ol = el.createEl("ol", { cls: "sk-sessions-frieze" + (flow.kind === "ready" ? " is-ok" : "") });
	// Named by a hidden text, never by aria-label (Obsidian would show it as a tooltip).
	ol.createSpan({ cls: "sk-sessions-sr", text: w.t("flow.steps", { steps: STEPS.map((s) => w.t(`flow.step-${s}`)).join(", ") }) });
	STEPS.forEach((s, i) => {
		const li = ol.createEl("li", { cls: `is-${states[i]}` + (states[i] === "current" && breathe ? " is-breathe" : "") });
		if (states[i] === "current") li.setAttr("aria-current", "step");
		li.createEl("i");
		li.createSpan({ text: w.t(`flow.step-${s}`) });
	});
	return ol;
}

/** The mini frieze of a row: four dots, no words. */
export function miniFrieze(el: HTMLElement, flow: Flow): HTMLElement {
	const states = stepStates(flow);
	const box = el.createSpan({ cls: "sk-sessions-mini" + (flow.kind === "ready" ? " is-ok" : ""), attr: { "aria-hidden": "true" } });
	states.forEach((s, i) => {
		if (i) box.createEl("b", { cls: i <= flow.step ? "is-done" : "" });
		box.createEl("i", { cls: s === "done" ? "is-done" : s === "current" ? "is-current" : "" });
	});
	return box;
}

/** "14 ideas dropped · 4 tasks launched · 1 to decide · 23 lines". */
export function tally(el: HTMLElement, w: Words, flow: Flow): HTMLElement {
	const p = el.createEl("p", { cls: "sk-sessions-tally" });
	const part = (key: string, n: number) => {
		if (p.childElementCount) p.appendText(" · ");
		countText(p.createSpan(), w.tn(key, n), n);
	};
	part("flow.ideas", flow.ideas);
	part("flow.tasks", flow.tasks);
	if (flow.undecided) part("flow.undecided", flow.undecided);
	part("flow.lines", flow.lines);
	return p;
}

export interface CardOptions {
	title: string;
	/** Shown at the right of the title (the date, or the state in the tab). */
	aside: string;
	asideReady?: boolean;
	where: "note" | "list" | "detail";
	/** "Nothing new since {date}" when stale. */
	staleDate?: string;
	onAction(action: CardAction, e: MouseEvent): void;
}

/** Fills `el` with the card: head, frieze, tally, invitation, actions. */
export function fillCard(el: HTMLElement, w: Words, flow: Flow, o: CardOptions): void {
	el.empty();
	if (o.where !== "detail") {
		const head = el.createDiv({ cls: "sk-sessions-card-head" });
		head.createEl("b", { text: o.title });
		head.createSpan({ cls: "sk-sessions-card-aside" + (o.asideReady ? " is-ready" : ""), text: o.aside });
	}
	frieze(el, w, flow);
	tally(el, w, flow);
	let invite = "";
	if (flow.kind === "new") invite = w.t("flow.invite-new");
	else if (flow.stale && o.staleDate) invite = w.t("flow.invite-stale", { date: o.staleDate });
	else if (flow.kind === "ready") invite = w.t("flow.invite-ready");
	if (invite) el.createEl("p", { cls: "sk-sessions-card-invite", text: invite });
	const acts = el.createDiv({ cls: "sk-sessions-card-acts" });
	const button = (action: CardAction, primary: boolean) => {
		const b = acts.createEl("button", { cls: "sk-btn is-s" + (primary ? " is-primary" : " is-ghost"), attr: { type: "button", "data-action": action } });
		setIcon(b.createSpan({ cls: "sk-sessions-card-icon" }), ICONS[action]);
		b.createSpan({ text: actionLabel(w, flow, action) });
		b.addEventListener("click", (e) => o.onAction(action, e));
		return b;
	};
	const next = nextAction(flow);
	if (next) button(next, next !== "unarchive" && o.where !== "detail");
	if (next === "sort" && o.where === "note") button("show", false);
	if (flow.kind === "closed") button("reopen", false);
	if (o.where === "list") {
		acts.createSpan({ cls: "sk-sessions-card-gap" });
		button("open", false);
	}
}
