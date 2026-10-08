// The sorting mode: one line at a time, in the middle of the screen, and four choices. Task + tag
// (the shared tag picker, then the task is written as the composition writes it), To decide, Keep
// as an idea, Delete. Keys 1 to 4, Backspace takes the last decision back (in the note too),
// Escape leaves. A bar moves on, the card flies to its choice, and a warm screen closes the round.
// Every change is made on the line found again just before (never on a line that changed).
import { moment, Platform, Scope, setIcon } from "obsidian";
import { TagPicker } from "../../ui/tag-picker";
import { compareSessions } from "./atelier";
import { choicesFor, decide, emptyTally, holdsFence, keptPrints, leftover, linesOf, mapLine, prunePrints, revertOf, sortItems, type Choice, type LineEdit, type SortItem, type Tally } from "./flow";
import { suggestion } from "./logic";
import type { Flow } from "./flow";
import type { SessionsRuntime } from "./runtime";

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const ms = (n: number) => (reduced() ? 1 : n);

interface Item extends SortItem {
	path: string;
	title: string;
	created: number;
}

interface Step {
	choice: Choice;
	item: Item;
	/** The change made in the note (null: nothing to write, or the line had changed). */
	edit: LineEdit | null;
	counted: boolean;
	/** Prints of the sentences kept as ideas by this step (taken back by Undo). */
	kept: string[];
	/** What this step taught about verbs (taken back by Undo when nothing was learned since). */
	verbs: { before: SessionsRuntime["settings"]["verbs"]; after: SessionsRuntime["settings"]["verbs"] } | null;
}

const KIND_LABEL: Record<SortItem["kind"], string> = { task: "tri.untagged", decide: "tri.undecided", likely: "tri.likely", question: "tri.question" };

const ICONS: Record<Choice, string> = { task: "tag", decide: "circle-help", done: "check-circle-2", idea: "lightbulb", delete: "trash-2", later: "clock" };

export class Sorter {
	private i = 0;
	private hist: Step[] = [];
	private tally: Tally = emptyTally();
	private phase: "choose" | "tag" | "end" = "choose";
	private busy = false;
	/** A key pressed while the card was flying: played once it has landed. */
	private queued: Array<() => void> = [];
	private picker: TagPicker | null = null;
	private readonly el: HTMLElement;
	private readonly keys: Scope;
	private closed = false;
	/** Where the sorted note stands at the closing screen, read from its text as it is now. */
	private endFlow: Flow | null = null;

	private constructor(private rt: SessionsRuntime, private scopePath: string | null, private queue: Item[], private returnFocus: HTMLElement | null, private only: "decide" | null = null) {
		const doc = activeDocument;
		this.el = doc.body.createDiv({ cls: "sk-sessions-tri" + (Platform.isPhone ? " is-phone" : ""), attr: { role: "dialog", "aria-modal": "true", tabindex: "-1" } });
		this.keys = new Scope(rt.app.scope);
		const key = (k: string, run: () => void) =>
			this.keys.register([], k, () => {
				if (this.phase === "tag") return true;
				run();
				return false;
			});
		// Keys 1 to 4 follow the choices of the line shown (a line to decide gets "Decided" as 2); 5 leaves it for later.
		for (let i = 0; i < 4; i++) key(String(i + 1), () => this.press(i));
		key("5", () => {
			if (this.phase === "choose") void this.decide("later");
		});
		key("Backspace", () => void this.undo());
		this.keys.register([], "Escape", () => {
			if (this.phase === "tag") return true;
			this.close(this.phase === "end" ? "close" : "quit");
			return false;
		});
		rt.app.keymap.pushScope(this.keys);
		rt.sorter = this;
		this.render(true);
		this.el.focus({ preventScroll: true });
	}

	/**
	 * Gathers the lines to sort (one session, or every session in progress) and opens the mode.
	 * `only: "decide"`: the lines to decide of every brainstorm, finished ones too (the To decide queue).
	 */
	static async open(rt: SessionsRuntime, scopePath: string | null, returnFocus: HTMLElement | null, only: "decide" | null = null): Promise<void> {
		// One opening at a time: a second request while the notes are read wins, the first gives up.
		const generation = ++rt.sortGeneration;
		const infos = rt.sessionInfos();
		const list = scopePath
			? infos.filter((s) => s.path === scopePath)
			: only === "decide"
				? infos.filter((s) => rt.settings.decideArchived || !s.archived).sort((a, b) => b.created - a.created || a.title.localeCompare(b.title))
				: infos.filter((s) => !s.closed && !s.archived).sort(compareSessions);
		const queue: Item[] = [];
		for (const s of list) {
			const text = await rt.textOf(s.path);
			if (text === null) continue;
			const lines = linesOf(text);
			// Sentences kept as ideas that the note no longer holds are forgotten.
			rt.pruneKept(s.path, prunePrints([...rt.keptOf(s.path)], lines));
			for (const item of sortItems(rt.summaryOf(text), lines, rt.isClosing, rt.sortOptions(s.path))) {
				if (only === "decide" && item.kind !== "decide") continue;
				queue.push({ ...item, path: s.path, title: s.title, created: s.created });
			}
		}
		if (rt.stopped || generation !== rt.sortGeneration) return;
		rt.sorter?.close("quit", true);
		if (!queue.length) {
			rt.ctx.toast(rt.ctx.t(only === "decide" ? "tri.nothing-decide" : "tri.nothing"));
			return;
		}
		new Sorter(rt, scopePath, queue, returnFocus, only);
	}

	private t(key: string, vars?: Record<string, string | number>): string {
		return this.rt.ctx.t(key, vars);
	}

	private tn(key: string, n: number): string {
		return this.rt.ctx.tn(key, n);
	}

	// ----- drawing -----

	private render(enter = false, back: { dx: number; dy: number } | null = null): void {
		if (this.closed) return;
		const el = this.el;
		this.picker?.destroy();
		this.picker = null;
		el.empty();
		const n = this.queue.length;
		const done = Math.min(this.i, n);
		const top = el.createDiv({ cls: "sk-sessions-tri-top" });
		const prog = top.createDiv({ cls: "sk-sessions-tri-prog", attr: { role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(n), "aria-valuenow": String(done) } });
		prog.createEl("i").style.width = `${(done / n) * 100}%`;
		top.createSpan({ cls: "sk-sessions-tri-n", text: this.t("tri.of", { n: this.phase === "end" ? n : done + 1, total: n }) });
		const quit = top.createEl("button", { cls: "sk-btn is-ghost is-s", attr: { type: "button" } });
		quit.createSpan({ text: this.t("tri.quit") });
		if (!Platform.isPhone) quit.createEl("kbd", { text: this.t("key.esc") });
		quit.addEventListener("click", () => this.close(this.phase === "end" ? "close" : "quit"));
		const mid = el.createDiv({ cls: "sk-sessions-tri-mid" });
		if (this.phase === "end") {
			this.renderEnd(mid);
			return;
		}
		const item = this.queue[this.i];
		if (!item) {
			this.phase = "end";
			this.render();
			return;
		}
		const card = mid.createDiv({ cls: "sk-sessions-tri-card" });
		const origin = card.createDiv({ cls: "sk-sessions-tri-origin" });
		setIcon(origin.createSpan({ cls: "sk-sessions-tri-origin-icon" }), "zap");
		origin.createSpan({ text: `${item.title} · ${new Intl.DateTimeFormat(this.rt.ctx.lang, { day: "numeric", month: "short" }).format(item.created)}` });
		const kind = card.createDiv({ cls: `sk-sessions-tri-kind is-${item.kind}` });
		kind.createEl("i");
		kind.createSpan({ text: this.t(KIND_LABEL[item.kind]) });
		card.createEl("p", { cls: "sk-sessions-tri-text", text: item.text });
		if (item.description.length) card.createEl("p", { cls: "sk-sessions-tri-desc", text: item.description.join("\n") });
		if (enter && !reduced()) card.animate([{ transform: "translateY(22px) scale(0.97)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 420, easing: "cubic-bezier(0.22, 1.25, 0.36, 1)" });
		if (back && !reduced()) card.animate([{ transform: `translate(${back.dx}px, ${back.dy}px) scale(0.2)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 440, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });

		if (this.phase === "tag") this.renderTag(mid, item);
		else {
			const chs = mid.createDiv({ cls: "sk-sessions-tri-choices", attr: { role: "group" } });
			chs.createSpan({ cls: "sk-sessions-sr", text: this.t("tri.choices") });
			choicesFor(item.kind).forEach((c, k) => {
				const b = chs.createEl("button", { cls: `sk-sessions-tri-choice is-${c}`, attr: { type: "button", "data-choice": c } });
				setIcon(b.createSpan({ cls: "sk-sessions-tri-ic" }), ICONS[c]);
				b.createSpan({ cls: "sk-sessions-tri-label", text: this.t(`tri.choice-${c}`) });
				if (!Platform.isPhone) b.createEl("kbd", { text: String(k + 1) });
				b.createSpan({ cls: "sk-sessions-tri-count", text: this.tally[c] ? String(this.tally[c]) : "" });
				b.addEventListener("click", () => void this.decide(c));
			});
			// Not now: the line stays as it is, for another time.
			const later = mid.createEl("button", { cls: "sk-btn is-ghost is-s sk-sessions-tri-later", attr: { type: "button", "data-choice": "later" } });
			setIcon(later.createSpan({ cls: "sk-sessions-card-icon" }), ICONS.later);
			later.createSpan({ text: this.t("tri.choice-later") });
			if (!Platform.isPhone) later.createEl("kbd", { text: "5" });
			later.addEventListener("click", () => void this.decide("later"));
		}
		const foot = el.createDiv({ cls: "sk-sessions-tri-foot" });
		if (this.hist.length) {
			const u = foot.createEl("button", { cls: "sk-btn is-ghost is-s", attr: { type: "button" } });
			setIcon(u.createSpan({ cls: "sk-sessions-card-icon" }), "undo-2");
			u.createSpan({ text: this.t("tri.undo") });
			if (!Platform.isPhone) u.createEl("kbd", { text: "⌫" });
			u.addEventListener("click", () => void this.undo());
		} else foot.createSpan({ text: this.t("tri.calm") });
		if (!Platform.isPhone && this.phase === "choose") {
			const keys = foot.createSpan({ cls: "sk-sessions-tri-keys" });
			keys.appendText("· ");
			keys.createEl("kbd", { text: "1" });
			keys.appendText("–");
			keys.createEl("kbd", { text: "4" });
			keys.appendText(" " + this.t("tri.keys"));
		}
	}

	private renderTag(mid: HTMLElement, item: Item): void {
		const box = mid.createDiv({ cls: "sk-sessions-tri-tag" });
		const host = box.createDiv();
		const rt = this.rt;
		const file = rt.file(item.path);
		const sug = suggestion(item.text, rt.settings.learned, rt.allTags());
		this.picker = new TagPicker(host, {
			t: (k, v) => this.t(k, v),
			sources: {
				all: () => rt.allTags(),
				near: () => rt.nearTags(file),
				recent: () => rt.recentTags(),
				suggestion: () => (sug ? { tag: sug.tag, reason: sug.word ? this.t("why.learned", { word: sug.word }) : this.t("why.suggested") } : null),
			},
			colors: (tag) => rt.tagClasses(tag),
			onChoose: (tag) => void this.decide("task", tag),
			onCancel: () => {
				this.phase = "choose";
				this.render();
				this.el.focus({ preventScroll: true });
			},
			onBack: () => {
				this.phase = "choose";
				this.render();
				this.el.focus({ preventScroll: true });
			},
		});
		this.picker.open(sug?.tag ?? null);
		if (!Platform.isPhone) {
			const hint = box.createDiv({ cls: "sk-sessions-tri-hint" });
			const k = (t: string) => hint.createEl("kbd", { text: t });
			k("↑");
			k("↓");
			hint.appendText(" " + this.t("tri.tag-move") + " · ");
			k("↵");
			hint.appendText(" " + this.t("tri.tag-place") + " · ");
			k(this.t("key.esc"));
			hint.appendText(" " + this.t("tri.tag-back"));
		}
		this.picker.focus();
	}

	private renderEnd(mid: HTMLElement): void {
		const end = mid.createDiv({ cls: "sk-sessions-tri-end" });
		const svg = end.createSvg("svg");
		svg.setAttribute("viewBox", "0 0 76 76");
		svg.setAttribute("class", "sk-sessions-tri-ok");
		svg.setAttribute("aria-hidden", "true");
		svg.createSvg("circle", { attr: { cx: "38", cy: "38", r: "34", transform: "rotate(-90 38 38)" } });
		svg.createSvg("path", { attr: { d: "M25 39l9 9 17-19" } });
		end.createEl("h2", { text: this.t("tri.end-title") });
		const t = this.tally;
		const n = t.task + t.decide + t.done + t.idea + t.delete;
		const parts: string[] = [];
		if (t.task) parts.push(this.tn("flow.tasks", t.task));
		if (t.done) parts.push(this.tn("tri.end-done", t.done));
		if (t.decide) parts.push(this.tn("tri.end-decide", t.decide));
		if (t.idea) parts.push(this.tn("tri.end-ideas", t.idea));
		if (t.delete) parts.push(this.tn("tri.end-deleted", t.delete));
		end.createEl("p", { text: parts.length ? this.t("tri.end-line", { sorted: this.tn("tri.end-sorted", n), parts: parts.join(", ") }) : `${this.tn("tri.end-sorted", n)}.` });
		const single = this.scopePath ? this.rt.infoOf(this.scopePath) : null;
		const flow = this.endFlow ?? (single ? this.rt.flowOf(single) : null);
		const ready = this.rt.sessionInfos().filter((s) => !s.closed && !s.archived && this.rt.flowOf(s).kind === "ready").length;
		let sub = "";
		// Said only when true: ready, or what still waits (lines to sort, else lines to decide).
		if (flow) {
			const left = leftover(flow);
			sub = flow.kind === "ready" ? this.t("tri.end-ready") : flow.kind !== "sort" ? "" : left.sort ? this.tn("tri.end-left", left.sort) : this.t("tri.end-waiting");
		}
		else if (this.only === "decide") sub = t.later ? this.tn("tri.end-later", t.later) : "";
		else if (ready) sub = this.tn("tri.end-ready-many", ready);
		if (sub) end.createEl("p", { cls: "sk-sessions-tri-sub", text: sub });
		const acts = end.createDiv({ cls: "sk-sessions-tri-acts" });
		const button = (label: string, primary: boolean, run: () => void) => {
			const b = acts.createEl("button", { cls: "sk-btn" + (primary ? " is-primary" : " is-ghost"), attr: { type: "button" } });
			b.setText(label);
			b.addEventListener("click", run);
			return b;
		};
		let first: HTMLElement;
		if (flow && (flow.kind === "ready" || flow.kind === "write" || flow.kind === "sort")) {
			first = button(this.t("tri.finish"), true, () => this.close("finish"));
			button(this.t("tri.back-note"), false, () => this.close("close"));
		} else first = button(this.t(this.scopePath ? "tri.back-note" : "tri.back-list"), true, () => this.close("close"));
		first.focus({ preventScroll: true });
	}

	// ----- deciding -----

	/**
	 * Key 1 to 4: the choice is read on the line shown when the key is played, not when it was
	 * pressed (a key pressed while the card flies goes to the next line, whose choices may differ).
	 */
	private press(i: number): void {
		if (this.busy) {
			this.queued.push(() => this.press(i));
			return;
		}
		const item = this.queue[this.i];
		if (this.phase === "choose" && item) void this.decide(choicesFor(item.kind)[i]);
	}

	private async decide(choice: Choice, tag: string | null = null): Promise<void> {
		if (this.busy) {
			this.queued.push(() => void this.decide(choice, tag));
			return;
		}
		if (this.closed || this.phase === "end") return;
		const item = this.queue[this.i];
		if (!item) return;
		if (choice === "task" && !tag) {
			this.phase = "tag";
			this.render();
			return;
		}
		const rt = this.rt;
		if (choice === "delete" && holdsFence(item.block)) {
			rt.ctx.toast(this.t("tri.keep-code"));
			return;
		}
		this.busy = true;
		let edit: LineEdit | null = null;
		let counted = true;
		const free = item.kind === "likely" || item.kind === "question";
		// Nothing to write: a line to decide kept to decide, a free sentence kept as an idea, a line left for later.
		if (!(choice === "decide" && item.kind === "decide") && !(choice === "idea" && free) && choice !== "later") {
			const today = moment().format("YYYY-MM-DD");
			try {
				edit = await rt.editNote(item.path, (lines) => decide(lines, item, choice, tag, "\t", rt.isClosing, today));
			} catch (error) {
				console.error("[Snailkit] sessions: could not sort the line", error);
			}
			if (!edit) {
				// Still there but changed (its description, for example): the card shows it as it is now, nothing decided.
				if (await this.refresh(item)) {
					this.busy = false;
					this.phase = "choose";
					rt.ctx.toast(this.t("tri.refreshed"));
					this.render();
					this.el.focus({ preventScroll: true });
					this.queued = [];
					return;
				}
				counted = false;
				rt.ctx.toast(this.t("tri.changed"));
			} else this.shift(item, edit);
		}
		// Kept as an idea: never offered again (the note itself is not touched for a free sentence).
		// Only the prints this step adds: Undo must not take back an identical sentence kept before.
		const already = rt.keptOf(item.path);
		const kept = choice === "idea" && counted ? keptPrints(item, edit).filter((p) => !already.has(p)) : [];
		const verbs = rt.settings.verbs;
		if (kept.length) rt.keepIdeas(item.path, kept, true);
		if (edit && choice === "task" && tag) rt.learnTag(item.text, tag);
		if (edit && choice === "task") rt.learnVerb(item.text, true);
		else if ((edit || (choice === "idea" && counted && (item.kind === "likely" || item.kind === "question"))) && (choice === "idea" || choice === "delete")) rt.learnVerb(item.text, false);
		if (counted) this.tally[choice]++;
		this.hist.push({ choice, item, edit, counted, kept, verbs: rt.settings.verbs === verbs ? null : { before: verbs, after: rt.settings.verbs } });
		if (this.phase === "tag") {
			this.phase = "choose";
			this.render();
		}
		await this.fly(choice);
		this.i++;
		if (this.i >= this.queue.length) {
			this.phase = "end";
			// What the closing screen says must be true now, not as last read from the vault.
			const text = this.scopePath ? await rt.textOf(this.scopePath) : null;
			this.endFlow = this.scopePath && text !== null ? rt.flowOfText(this.scopePath, text) : null;
		}
		this.busy = false;
		this.render(true);
		if (this.phase !== "end") this.el.focus({ preventScroll: true });
		this.flush();
	}

	private flush(): void {
		this.queued.shift()?.();
	}

	/** An edit moved the lines below it: the lines still to sort in that note follow (or are lost when it removed them). */
	private shift(done: Item, edit: LineEdit): void {
		for (const other of this.queue) {
			if (other === done || other.path !== done.path) continue;
			other.line = mapLine(other.line, edit) ?? -1;
		}
	}

	/** Reads the item again where it is: true when it is still to sort but no longer as shown (the card is updated). */
	private async refresh(item: Item): Promise<boolean> {
		const text = await this.rt.textOf(item.path);
		if (text === null) return false;
		const lines = linesOf(text);
		const fresh = sortItems(this.rt.summaryOf(text), lines, this.rt.isClosing, this.rt.sortOptions(item.path)).find((x) => x.line === item.line && x.raw === item.raw);
		if (!fresh || (fresh.block.length === item.block.length && fresh.block.every((l, i) => l === item.block[i]))) return false;
		Object.assign(item, fresh);
		return true;
	}

	/** The card flies to the chosen button, which counts one more. */
	private async fly(choice: Choice): Promise<void> {
		const card = this.el.querySelector<HTMLElement>(".sk-sessions-tri-card");
		const btn = this.el.querySelector<HTMLElement>(`[data-choice="${choice}"]`);
		if (!card || !btn) return;
		btn.addClass("is-press");
		window.setTimeout(() => btn.removeClass("is-press"), 160);
		const count = btn.querySelector(".sk-sessions-tri-count");
		if (count) count.setText(String(this.tally[choice] || ""));
		if (reduced()) return;
		const cr = card.getBoundingClientRect();
		const br = btn.getBoundingClientRect();
		const dx = br.left + br.width / 2 - (cr.left + cr.width / 2);
		const dy = br.top + br.height / 2 - (cr.top + cr.height / 2);
		const a = card.animate(
			[
				{ transform: "none", opacity: 1 },
				{ transform: `translate(${dx * 0.55}px, ${dy * 0.55}px) scale(0.6) rotate(${dx > 0 ? 2 : -2}deg)`, opacity: 0.8, offset: 0.55 },
				{ transform: `translate(${dx}px, ${dy}px) scale(0.12)`, opacity: 0 },
			],
			{ duration: ms(440), easing: "cubic-bezier(0.5, 0, 0.6, 1)", fill: "forwards" },
		);
		await new Promise<void>((resolve) => {
			a.onfinish = () => resolve();
			a.oncancel = () => resolve();
			window.setTimeout(resolve, 700);
		});
		count?.removeClass("is-bump");
		void (count as HTMLElement | null)?.offsetWidth;
		count?.addClass("is-bump");
	}

	/** Takes the last decision back, in the note too (when the line is still as it was left). */
	private async undo(): Promise<void> {
		if (this.busy) {
			this.queued.push(() => void this.undo());
			return;
		}
		if (this.closed || !this.hist.length) return;
		const step = this.hist[this.hist.length - 1];
		this.busy = true;
		if (step.edit) {
			const edit = step.edit;
			let back: LineEdit | null = null;
			try {
				back = await this.rt.editNote(step.item.path, (lines) => revertOf(lines, edit));
			} catch (error) {
				console.error("[Snailkit] sessions: could not undo", error);
			}
			if (!back) {
				this.busy = false;
				this.rt.ctx.toast(this.t("tri.undo-failed"));
				this.queued = [];
				return;
			}
			this.shift(step.item, back);
			step.item.line = edit.at;
		}
		if (step.verbs) this.rt.restoreVerbs(step.verbs.after, step.verbs.before);
		if (step.kept.length) this.rt.keepIdeas(step.item.path, step.kept, false);
		this.hist.pop();
		if (step.counted) this.tally[step.choice]--;
		this.i = Math.max(0, this.i - 1);
		this.phase = "choose";
		this.busy = false;
		this.render();
		const card = this.el.querySelector<HTMLElement>(".sk-sessions-tri-card");
		const btn = this.el.querySelector<HTMLElement>(`[data-choice="${step.choice}"]`);
		if (card && btn && !reduced()) {
			const cr = card.getBoundingClientRect();
			const br = btn.getBoundingClientRect();
			card.animate([{ transform: `translate(${br.left + br.width / 2 - cr.left - cr.width / 2}px, ${br.top + br.height / 2 - cr.top - cr.height / 2}px) scale(0.15)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 440, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
		}
		this.el.focus({ preventScroll: true });
		this.flush();
	}

	// ----- leaving -----

	/** Leaves the mode: "quit" midway, "close" from the closing screen, "finish" finishes the session. */
	close(how: "quit" | "close" | "finish", silent = false): void {
		if (this.closed) return;
		this.closed = true;
		this.picker?.destroy();
		this.rt.app.keymap.popScope(this.keys);
		if (this.rt.sorter === this) this.rt.sorter = null;
		const el = this.el;
		if (silent || reduced()) el.remove();
		else {
			el.addClass("is-out");
			window.setTimeout(() => el.remove(), 200);
		}
		if (silent) return;
		const n = this.tally.task + this.tally.decide + this.tally.done + this.tally.idea + this.tally.delete;
		if (how === "quit" && n && this.i < this.queue.length) this.rt.ctx.toast(this.tn("tri.quit-toast", n));
		if (how === "finish" && this.scopePath) void this.rt.finish(this.scopePath);
		if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
	}
}
