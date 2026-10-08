// The brainstorm note itself: a discreet pill at the top right says where it stands, in words
// ("In progress · 2 without tag", "Ready to finish ✓", "Finished"). Hovering it (a tap on a phone:
// a sheet) shows the card: the frieze of the four steps, the tally, one button for the next step
// and "Show me", which lights the lines that wait one by one. Once finished, the note is sealed: a
// discreet stamp, a tinted page, one warm sentence and Reopen.
import { Platform, setIcon } from "obsidian";
import { fillCard, stateLabel, type CardAction, type Words } from "./card";
import { sortItems, type Flow, type SortItem } from "./flow";
import { summarize } from "./logic";
import type { SessionView } from "./editor";

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export class Saisie {
	private flow: Flow | null = null;
	private lastKind: Flow["kind"] | null = null;
	private lastLabel = "";
	private readonly pill: HTMLButtonElement;
	private card: HTMLElement | null = null;
	private sheet: { el: HTMLElement; back: HTMLElement } | null = null;
	private nav: HTMLElement | null = null;
	private band: HTMLElement | null = null;
	private stamp: HTMLElement | null = null;
	private timer = 0;
	private hoverTimer = 0;
	private pinned = false;
	private show: { i: number } | null = null;
	private destroyed = false;
	private cleanups: Array<() => void> = [];
	/** A landing to play once the note shows sealed (Finish was just pressed). */
	private landing = false;
	/** Finish was asked while lines still wait: the card asks first. */
	private asking = false;

	constructor(private sv: SessionView) {
		const doc = sv.view.dom.ownerDocument;
		this.pill = doc.createElement("button");
		this.pill.type = "button";
		this.pill.className = "sk-sessions-pill is-hidden";
		this.pill.setAttr("aria-haspopup", "dialog");
		this.pill.setAttr("aria-expanded", "false");
		sv.view.dom.appendChild(this.pill);
		this.on(this.pill, "click", () => this.onPillClick());
		if (!Platform.isMobile) {
			this.on(this.pill, "mouseenter", () => {
				window.clearTimeout(this.hoverTimer);
				this.hoverTimer = window.setTimeout(() => this.openCard(), 110);
			});
			this.on(this.pill, "mouseleave", () => this.closeSoon());
		}
		this.on(this.pill, "keydown", (e) => {
			const k = (e as KeyboardEvent).key;
			if (k === "Escape" && this.card) {
				e.preventDefault();
				this.closeCard();
			}
		});
		this.on(doc, "pointerdown", (e) => {
			const t = e.target as Node;
			if (this.card && !this.card.contains(t) && !this.pill.contains(t)) this.closeCard();
		});
	}

	private on(target: EventTarget, type: string, fn: (e: Event) => void): void {
		target.addEventListener(type, fn);
		this.cleanups.push(() => target.removeEventListener(type, fn));
	}

	private get words(): Words {
		const ctx = this.sv.rt.ctx;
		return { t: (k, v) => ctx.t(k, v), tn: (k, n, v) => ctx.tn(k, n, v) };
	}

	/** The text changed (or the note, or the settings): the pill follows, a moment later. */
	update(): void {
		if (this.destroyed) return;
		window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => this.compute(), 140);
	}

	/** Finish was just pressed in this note: the stamp lands when the sealed note shows. */
	sealed(): void {
		this.landing = true;
		this.update();
	}

	private compute(): void {
		if (this.destroyed) return;
		const sv = this.sv;
		const file = sv.file;
		if (!sv.active || !file || !sv.rt.isSession(file)) {
			this.flow = null;
			this.pill.addClass("is-hidden");
			this.closeCard();
			this.endShow();
			this.unseal();
			return;
		}
		const flow = sv.rt.flowOfText(file.path, sv.view.state.doc.toString());
		if (flow.toSort === 0) this.asking = false;
		const prev = this.lastKind;
		this.flow = flow;
		this.lastKind = flow.kind;
		this.renderPill(prev);
		if (this.card) this.renderCard();
		if (this.sheet) this.renderSheet();
		if (this.show) this.showGo(this.show.i, false);
		if (flow.kind === "closed" || (flow.kind === "archived" && flow.closed)) this.seal();
		else this.unseal();
	}

	private label(flow: Flow): string {
		if (Platform.isPhone && flow.kind === "sort") return this.words.tn("flow.to-sort", flow.toSort);
		return stateLabel(this.words, flow);
	}

	private renderPill(prev: Flow["kind"] | null): void {
		const flow = this.flow!;
		const pill = this.pill;
		const text = this.label(flow);
		pill.removeClass("is-hidden");
		pill.dataset.kind = flow.kind;
		pill.empty();
		pill.createSpan({ cls: "sk-sessions-pill-dot" });
		setIcon(pill.createSpan({ cls: "sk-sessions-pill-check" }), "check");
		pill.createSpan({ cls: "sk-sessions-pill-label", text: flow.kind === "ready" ? `${text} ✓` : text });
		pill.createSpan({ cls: "sk-sessions-sr", text: this.words.t("flow.pill-label") });
		if (this.lastLabel && this.lastLabel !== text && !reduced()) {
			pill.removeClass("is-tick");
			void pill.offsetWidth;
			pill.addClass("is-tick");
		}
		this.lastLabel = text;
		// The last tag placed: a small ripple.
		if (prev === "sort" && flow.kind === "ready" && !reduced()) {
			pill.removeClass("is-reward");
			void pill.offsetWidth;
			pill.addClass("is-reward");
			window.setTimeout(() => pill.removeClass("is-reward"), 1300);
		}
	}

	/** Closes the card and the sheet (another note became active). */
	closeFloating(): void {
		this.closeCard();
		this.closeSheet();
	}

	// ----- the card -----

	private onPillClick(): void {
		if (!this.flow) return;
		if (Platform.isMobile) {
			this.openSheet();
			return;
		}
		if (this.card && this.pinned) {
			this.closeCard();
			return;
		}
		this.openCard();
		this.pinned = true;
		this.card?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
	}

	private openCard(): void {
		window.clearTimeout(this.hoverTimer);
		if (!this.flow || this.card) return;
		const card = (this.card = this.sv.view.dom.createDiv({ cls: "sk-sessions-card is-note", attr: { role: "dialog" } }));
		card.addEventListener("mouseenter", () => window.clearTimeout(this.hoverTimer));
		card.addEventListener("mouseleave", () => this.closeSoon());
		card.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				this.closeCard();
				this.pill.focus();
			}
		});
		this.pill.addClass("is-open");
		this.pill.setAttr("aria-expanded", "true");
		this.renderCard();
	}

	private closeSoon(): void {
		if (this.pinned) return;
		window.clearTimeout(this.hoverTimer);
		this.hoverTimer = window.setTimeout(() => this.closeCard(), 260);
	}

	private closeCard(): void {
		window.clearTimeout(this.hoverTimer);
		this.pinned = false;
		if (!this.sheet) this.asking = false;
		if (!this.card) return;
		this.card.remove();
		this.card = null;
		this.pill.removeClass("is-open");
		this.pill.setAttr("aria-expanded", "false");
	}

	private renderCard(): void {
		if (!this.card || !this.flow) return;
		this.fill(this.card);
	}

	private fill(el: HTMLElement): void {
		const flow = this.flow!;
		const file = this.sv.file;
		const info = file ? this.sv.rt.infoOf(file.path) : null;
		const date = new Intl.DateTimeFormat(this.sv.rt.ctx.lang, { weekday: "short", day: "numeric", month: "short" });
		fillCard(el, this.words, flow, {
			title: file?.basename ?? "",
			aside: info ? date.format(info.created) : "",
			where: "note",
			staleDate: info?.modified ? date.format(info.modified) : undefined,
			confirmFinish: this.asking,
			onAction: (a) => this.act(a),
		});
	}

	private act(action: CardAction): void {
		const file = this.sv.file;
		if (!file) return;
		const rt = this.sv.rt;
		if (action === "finish" && this.flow && this.flow.toSort > 0) {
			// Lines still wait: the card says so and offers to sort them first (it stays open).
			this.asking = true;
			this.pinned = !!this.card;
			this.renderCard();
			this.renderSheet();
			(this.card ?? this.sheet?.el)?.querySelector<HTMLElement>("button[data-action]")?.focus({ preventScroll: true });
			return;
		}
		this.asking = false;
		this.closeCard();
		this.closeSheet();
		if (action === "sort") rt.startSort(file.path, this.pill);
		else if (action === "finish" || action === "finish-anyway") void rt.finish(file.path);
		else if (action === "reopen") rt.reopen(file);
		else if (action === "archive") rt.archiveWithUndo(file.path, true);
		else if (action === "unarchive") rt.archiveWithUndo(file.path, false);
		else if (action === "show") this.startShow();
	}

	// ----- on a phone: the card as a sheet -----

	private openSheet(): void {
		if (this.sheet || !this.flow) return;
		const doc = this.sv.view.dom.ownerDocument;
		const back = doc.body.createDiv({ cls: "sk-sessions-sheet-back" });
		const el = doc.body.createDiv({ cls: "sk-sessions-sheet", attr: { role: "dialog" } });
		el.createDiv({ cls: "sk-sessions-sheet-grabber" });
		el.createDiv({ cls: "sk-sessions-card is-sheet" });
		back.addEventListener("click", () => this.closeSheet());
		this.sheet = { el, back };
		this.renderSheet();
	}

	private renderSheet(): void {
		const box = this.sheet?.el.querySelector<HTMLElement>(".sk-sessions-card");
		if (box && this.flow) this.fill(box);
	}

	private closeSheet(): void {
		if (!this.sheet) return;
		this.asking = false;
		this.sheet.el.remove();
		this.sheet.back.remove();
		this.sheet = null;
	}

	// ----- Show me: the lines that wait, one by one -----

	private waiting(): Array<{ line: number; kind: SortItem["kind"] }> {
		const state = this.sv.view.state;
		const lines: string[] = [];
		for (let i = 1; i <= state.doc.lines; i++) lines.push(state.doc.line(i).text);
		const rt = this.sv.rt;
		const opts = { verbs: rt.settings.verbs, kept: rt.keptOf(this.sv.file?.path ?? "") };
		return sortItems(summarize(lines, rt.isClosing), lines, rt.isClosing, opts).map((x) => ({ line: x.line + 1, kind: x.kind }));
	}

	startShow(): void {
		if (!this.waiting().length) return;
		this.show = { i: 0 };
		this.showGo(0, true);
	}

	private showGo(i: number, scroll: boolean): void {
		if (!this.show) return;
		const items = this.waiting();
		if (!items.length) {
			this.endShow();
			return;
		}
		const n = items.length;
		this.show.i = ((i % n) + n) % n;
		const item = items[this.show.i];
		const state = this.sv.view.state;
		const line = state.doc.line(item.line);
		const kind = { task: "untagged", decide: "undecided", likely: "likely", question: "question" }[item.kind];
		this.sv.spotLine(line.from, scroll);
		const doc = this.sv.view.dom.ownerDocument;
		if (!this.nav) {
			this.nav = this.sv.view.dom.createDiv({ cls: "sk-sessions-shownav", attr: { role: "group" } });
			this.nav.addEventListener("keydown", (e) => {
				if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
					e.preventDefault();
					e.stopPropagation();
					this.showGo((this.show?.i ?? 0) + (e.key === "ArrowRight" ? 1 : -1), true);
				} else if (e.key === "Escape") {
					e.preventDefault();
					e.stopPropagation();
					this.endShow();
					this.sv.view.focus();
				}
			});
		}
		const had = this.nav.contains(doc.activeElement) ? (doc.activeElement as HTMLElement).dataset.nav ?? null : null;
		const nav = this.nav;
		nav.empty();
		nav.createSpan({ cls: "sk-sessions-shownav-what", text: this.words.t(`show.${kind}`) });
		const button = (key: string, icon: string, label: string, run: () => void) => {
			const b = nav.createEl("button", { cls: "sk-btn is-ghost is-icon is-s", attr: { type: "button", "data-nav": key } });
			setIcon(b, icon);
			b.createSpan({ cls: "sk-sessions-sr", text: label });
			b.addEventListener("click", run);
			return b;
		};
		button("prev", "chevron-left", this.words.t("show.prev"), () => this.showGo((this.show?.i ?? 0) - 1, true));
		const pos = nav.createSpan({ cls: "sk-sessions-shownav-pos" });
		pos.createEl("b", { text: String(this.show.i + 1) });
		pos.appendText(" " + this.words.t("show.of", { total: n }));
		button("next", "chevron-right", this.words.t("show.next"), () => this.showGo((this.show?.i ?? 0) + 1, true));
		button("close", "x", this.words.t("show.close"), () => {
			this.endShow();
			this.sv.view.focus();
		});
		const focus = nav.querySelector<HTMLElement>(`[data-nav="${had ?? (scroll ? "next" : "")}"]`);
		if (focus && (scroll || had)) focus.focus({ preventScroll: true });
	}

	endShow(dispatch = true): void {
		const had = !!this.show;
		this.show = null;
		this.nav?.remove();
		this.nav = null;
		if (had && dispatch) this.sv.spotLine(null, false);
	}

	// ----- sealed -----

	private seal(): void {
		const sv = this.sv;
		const doc = sv.view.dom.ownerDocument;
		sv.view.scrollDOM.addClass("sk-sessions-sealed");
		const bg = sv.rt.settings.sealedBackground;
		sv.view.scrollDOM.toggleClass("is-bg-accent", bg === "accent");
		sv.view.scrollDOM.toggleClass("is-bg-none", bg === "none");
		const flow = this.flow!;
		const w = this.words;
		if (!this.band) {
			this.band = sv.layer.createDiv({ cls: "sk-sessions-band" });
			this.stamp = sv.layer.createDiv({ cls: "sk-sessions-stamp", attr: { "aria-hidden": "true" } });
		}
		const band = this.band;
		band.empty();
		const p = band.createSpan({ cls: "sk-sessions-band-text" });
		const strong = p.createEl("b");
		strong.setText(w.t("seal.line-short", { ideas: w.tn("seal.ideas", flow.ideas), tasks: w.tn("seal.tasks", flow.tasks) }));
		p.appendText(" " + w.t("seal.light"));
		const re = band.createEl("button", { cls: "sk-btn is-ghost is-s", attr: { type: "button" } });
		setIcon(re.createSpan({ cls: "sk-sessions-card-icon" }), "rotate-ccw");
		re.createSpan({ text: w.t("flow.reopen") });
		re.addEventListener("click", () => {
			const file = sv.file;
			if (file) sv.rt.reopen(file);
		});
		const stamp = this.stamp!;
		stamp.empty();
		stamp.createSpan({ text: w.t("seal.stamp") });
		const file = sv.file;
		const when = file ? new Intl.DateTimeFormat(sv.rt.ctx.lang, { day: "numeric", month: "short" }).format(file.stat.mtime) : "";
		stamp.createEl("small", { text: when });
		if (this.landing && !reduced()) {
			this.landing = false;
			stamp.removeClass("is-land");
			void stamp.offsetWidth;
			stamp.addClass("is-land");
			const sweep = sv.view.dom.createDiv({ cls: "sk-sessions-sweep" });
			window.setTimeout(() => sweep.remove(), 1000);
			sv.view.scrollDOM.scrollTo({ top: 0, behavior: "smooth" });
		}
		this.landing = false;
		void doc;
		sv.measure();
	}

	private unseal(): void {
		this.sv.view.scrollDOM.removeClass("sk-sessions-sealed", "is-bg-accent", "is-bg-none");
		this.band?.remove();
		this.stamp?.remove();
		this.band = null;
		this.stamp = null;
	}

	/** Places the band at the top of the text and the stamp at its right (called from the editor's measure). */
	place(contentTop: number, left: number, right: number): void {
		if (!this.band || !this.stamp) return;
		this.band.style.top = `${contentTop + 6}px`;
		this.band.style.left = `${left}px`;
		this.band.style.width = `${Math.max(200, right - left)}px`;
		this.stamp.style.top = `${contentTop - 74}px`;
		this.stamp.style.left = `${right - 92}px`;
	}

	get isSealed(): boolean {
		return !!this.band;
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		window.clearTimeout(this.timer);
		window.clearTimeout(this.hoverTimer);
		// Called while the editor is being destroyed or reset: nothing here may dispatch to it.
		this.pill.remove();
		for (const c of this.cleanups.splice(0)) c();
		this.closeCard();
		this.closeSheet();
		this.endShow(false);
		this.unseal();
	}
}

