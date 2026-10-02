// The card every panel lives in: header (title, count, subtitle, pin), optional progress bar,
// scrolling body, quiet footer. The rail creates one per opened panel and drops it once hidden.
import { setIcon } from "obsidian";
import type { PanelDefinition, RailEnv } from "../types";
import { dur, replayClass, stagger } from "./motion";

/** Close transition length (matches .sk-note-rail-panel in styles.css). */
const CLOSE_MS = 320;
let shellCount = 0;

export class PanelShell {
	readonly el: HTMLElement;
	readonly bodyEl: HTMLElement;
	private countEl: HTMLElement;
	private subEl: HTMLElement;
	private pinEl: HTMLElement;
	private progressEl: HTMLElement;
	private barEl: HTMLElement;
	private footEl: HTMLElement;
	private footMsgEl: HTMLElement;
	private removeTimer = 0;
	private pendingDone: (() => void) | null = null;

	constructor(
		parent: HTMLElement,
		readonly def: PanelDefinition,
		private env: RailEnv,
		pinned: boolean,
		onPinToggle: () => void,
	) {
		// Labelled by its title (an aria-label would make Obsidian show a tooltip over the card).
		const titleId = `sk-note-rail-title-${++shellCount}`;
		this.el = parent.createEl("section", { cls: "sk-note-rail-panel", attr: { "data-panel": def.id, role: "dialog", "aria-labelledby": titleId } });

		const head = this.el.createEl("header", { cls: "sk-note-rail-head" });
		const text = head.createDiv("sk-note-rail-head-text");
		const title = text.createDiv({ cls: "sk-note-rail-title", attr: { id: titleId } });
		title.createSpan({ text: env.t(`panel.${def.id}`) });
		this.countEl = title.createSpan({ cls: "sk-note-rail-count" });
		this.subEl = text.createDiv("sk-note-rail-sub");
		this.subEl.hide();

		this.pinEl = head.createEl("button", { cls: "sk-note-rail-icon-btn sk-note-rail-pin" });
		setIcon(this.pinEl, "pin");
		this.pinEl.addEventListener("click", (e) => {
			e.stopPropagation();
			onPinToggle();
		});
		this.setPinned(pinned);

		this.progressEl = this.el.createDiv("sk-note-rail-progress");
		this.barEl = this.progressEl.createEl("i");
		this.progressEl.hide();

		this.bodyEl = this.el.createDiv("sk-note-rail-body");
		this.footEl = this.el.createEl("footer", { cls: "sk-note-rail-foot" });
		this.footMsgEl = this.footEl.createDiv("sk-note-rail-foot-msg");
		this.footEl.hide();
	}

	setPinned(pinned: boolean): void {
		this.pinEl.toggleClass("is-pinned", pinned);
		this.pinEl.setAttribute("aria-label", this.env.t(pinned ? "panel.unpin" : "panel.pin"));
		this.pinEl.setAttribute("aria-pressed", String(pinned));
	}

	setSubtitle(text: string): void {
		this.subEl.setText(text);
		this.subEl.toggle(!!text);
	}

	setCount(count: number | null): void {
		this.countEl.setText(count === null ? "" : String(count));
	}

	setProgress(progress: number | null): void {
		if (progress === null || !isFinite(progress)) {
			this.progressEl.hide();
			return;
		}
		this.progressEl.show();
		this.barEl.style.setProperty("--p", Math.max(0, Math.min(1, progress)).toFixed(3));
	}

	setFooter(content: string | DocumentFragment): void {
		const empty = typeof content === "string" ? !content : !content.childNodes.length;
		this.footEl.toggle(!empty);
		this.footMsgEl.empty();
		if (empty) return;
		if (typeof content === "string") this.footMsgEl.setText(content);
		else this.footMsgEl.appendChild(content);
		if (this.el.hasClass("is-open")) replayClass(this.footMsgEl, "is-swap");
	}

	/** Play the entrance. `swap` = another panel was open (slides in from slightly above). */
	show(swap: boolean): void {
		this.el.toggleClass("is-swap", swap);
		void this.el.offsetWidth;
		this.el.addClass("is-open");
		this.staggerBody();
	}

	/** Re-run the row entrance (content rebuilt for a new note while pinned). */
	staggerBody(): void {
		const items = Array.from(this.bodyEl.querySelectorAll<HTMLElement>(
			".sk-note-rail-row, .sk-note-rail-section, .sk-note-rail-empty, .sk-note-rail-hint",
		));
		stagger(items, this.el.win);
	}

	/** Play the exit, then remove the card and call `done`. Immediate when `instant`. */
	hide(swap: boolean, instant: boolean, done: () => void): void {
		this.pendingDone = done;
		if (instant) {
			this.flush();
			return;
		}
		this.el.toggleClass("is-swap", swap);
		this.el.removeClass("is-open");
		this.removeTimer = window.setTimeout(() => this.flush(), dur(CLOSE_MS, this.el.win));
	}

	/** Finish a pending exit right now (module turned off during the close animation). */
	flush(): void {
		window.clearTimeout(this.removeTimer);
		this.el.remove();
		const done = this.pendingDone;
		this.pendingDone = null;
		done?.();
	}
}
