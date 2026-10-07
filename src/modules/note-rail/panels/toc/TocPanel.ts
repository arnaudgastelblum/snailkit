// Contents: the headings of the note, the current section, a reading progress bar, and a hover
// preview that scrolls the note to a heading and glides back to the exact spot when you leave.
import { Platform, type EventRef, type TFile } from "obsidian";
import { asElement } from "../../rail/motion";
import { clamp } from "../../settings";
import type { HideReason, PanelContext, PanelDefinition, PanelInstance } from "../../types";
import { buildToc, currentIndex, type TocEntry } from "./headings";
import { animateScroll, cancelScroll, type ScrollHandle } from "./scroll";
import { surfaceFor, type NoteSurface, type ScrollAnchor } from "./surface";

/** Where a previewed or jumped-to heading lands, from the top of the note pane. */
const HEADING_OFFSET = 64;
/** A heading counts as the current section once its top is this close to the top of the pane. */
const CURRENT_OFFSET = 90;
/** Indent step per level, in px (matches .sk-note-rail-toc rows in styles.css). */
const INDENT = 14;

export const tocPanel: PanelDefinition = {
	id: "toc",
	icon: "list-tree",
	isAvailable: (_env, view) => !!view.file,
	create: (ctx, body) => new TocController(ctx, body),
};

type FooterMode = "idle" | "preview" | "empty";

/** A preview in progress. It owns the surface it marked, so cleanup always hits the right mode. */
interface Preview {
	surface: NoteSurface;
	file: TFile | null;
	/** Where the reader was before the first preview: what leaving restores. */
	origin: ScrollAnchor;
	line: number | null;
	row: HTMLElement | null;
}

/** A glide back to the origin, still running. Re-entering the list reuses its origin. */
interface Restore {
	surface: NoteSurface;
	file: TFile | null;
	origin: ScrollAnchor;
	handle: ScrollHandle;
}

class TocController implements PanelInstance {
	private listEl: HTMLElement;
	private markerEl: HTMLElement;
	private rows: HTMLElement[] = [];
	private entries: TocEntry[] = [];
	private file: TFile | null;
	private current = -1;
	private footerMode: FooterMode | null = null;
	private hoverTimer = 0;
	private syncRaf = 0;
	private pointerInside = false;
	private cleanups: (() => void)[] = [];
	private boundScrollers = new Set<HTMLElement>();
	private preview: Preview | null = null;
	private restoring: Restore | null = null;
	/** Set once the card is closing (commit, hide): its rows must not start previews any more. */
	private closing = false;
	private win: Window;

	constructor(
		private ctx: PanelContext,
		private body: HTMLElement,
	) {
		this.win = body.win ?? window;
		this.file = ctx.view.file;
		this.listEl = body.createDiv({ cls: "sk-note-rail-toc", attr: { role: "list" } });
		this.markerEl = this.listEl.createSpan("sk-note-rail-toc-marker");

		this.on(this.listEl, "pointerover", (e) => this.onPointerOver(e as PointerEvent));
		this.on(this.listEl, "pointerout", (e) => this.onPointerOut(e as PointerEvent));
		this.on(this.listEl, "click", (e) => this.onClick(e as MouseEvent));
		this.on(this.listEl, "keydown", (e) => this.onKeyDown(e as KeyboardEvent));
		this.on(this.listEl, "focusout", (e) => this.onFocusOut(e as FocusEvent));
		this.on(body, "pointerenter", (e) => {
			if ((e as PointerEvent).pointerType !== "touch") this.pointerInside = true;
		});
		this.on(body, "pointerleave", () => (this.pointerInside = false));
		// Mode switches (Live Preview, Source, Reading) do not scroll: watch the layout too.
		const ref: EventRef = ctx.app.workspace.on("layout-change", () => this.checkMode());
		this.cleanups.push(() => ctx.app.workspace.offref(ref));

		this.build();
		this.bindScrollers();
		this.sync(true);
		this.revealCurrentRow(true);
	}

	// ---- PanelInstance -----------------------------------------------------------

	refresh(): void {
		if (this.ctx.view.file !== this.file) {
			this.dropPreview();
			this.stopRestore();
			this.file = this.ctx.view.file;
		}
		this.checkMode();
		this.build();
		this.bindScrollers();
		this.sync(true);
	}

	onHide(reason: HideReason): void {
		this.closing = true;
		this.win.clearTimeout(this.hoverTimer);
		if (reason === "commit") return;
		if (reason === "file-change") {
			this.dropPreview();
			this.stopRestore();
			return;
		}
		this.endPreview(true, reason === "unload");
	}

	onPointerLeave(): void {
		this.pointerInside = false;
		this.win.clearTimeout(this.hoverTimer);
		this.endPreview(true);
	}

	destroy(): void {
		this.win.clearTimeout(this.hoverTimer);
		this.win.cancelAnimationFrame(this.syncRaf);
		// Never leave a hold highlight behind (the commit flash clears itself, or on unload).
		this.dropPreview();
		// A glide back keeps running after the card is gone (it is guarded by file and mode).
		for (const c of this.cleanups) c();
		this.cleanups = [];
		this.boundScrollers.clear();
	}

	// ---- content -----------------------------------------------------------------

	private build(): void {
		const { app, view } = this.ctx;
		const file = view.file;
		const cache = file ? app.metadataCache.getFileCache(file) : null;
		const maxLevel = Math.round(clamp(this.ctx.settings.tocMaxLevel, 1, 6, 6));
		this.entries = buildToc(cache?.headings, maxLevel, this.ctx.t("toc.untitled"));

		this.ctx.setSubtitle(file ? file.basename : "");
		this.ctx.setCount(this.entries.length || null);

		const hadFocus = this.listEl.contains(this.listEl.doc.activeElement);
		const focusedIndex = hadFocus ? Number((this.listEl.doc.activeElement as HTMLElement).dataset.index) : -1;
		this.rows = [];
		this.listEl.querySelectorAll(":scope > .sk-note-rail-row, :scope > .sk-note-rail-empty").forEach((el) => el.remove());
		if (!this.entries.length) {
			this.listEl.createDiv({
				cls: "sk-note-rail-empty",
				text: maxLevel < 6 ? this.ctx.t("toc.empty-level", { level: maxLevel }) : this.ctx.t("toc.empty"),
			});
			this.markerEl.removeClass("is-on");
			this.ctx.setProgress(null);
			this.setFooter("empty");
			return;
		}
		this.entries.forEach((entry, i) => {
			const row = this.listEl.createDiv({
				cls: "sk-note-rail-row",
				attr: { "data-index": String(i), "data-depth": String(entry.depth), role: "button", tabindex: "0" },
			});
			row.setCssProps({ "--depth": String(entry.depth) });
			for (let g = 0; g < entry.depth; g++) {
				row.createSpan({ cls: "sk-note-rail-guide" }).style.left = `${INDENT + g * INDENT}px`;
			}
			row.createSpan({ cls: "sk-note-rail-row-title", text: entry.text });
			row.createSpan({ cls: "sk-note-rail-lvl", text: `H${entry.level}`, attr: { "aria-hidden": "true" } });
			this.rows.push(row);
		});
		// Keep the preview state only if the previewed line still holds a heading.
		const p = this.preview;
		if (p && p.line !== null) {
			const i = this.entries.findIndex((e) => e.line === p.line);
			p.row = i >= 0 ? this.rows[i] : null;
			p.row?.addClass("is-preview");
		}
		if (focusedIndex >= 0) this.rows[Math.min(focusedIndex, this.rows.length - 1)]?.focus({ preventScroll: true });
		this.current = -1;
		this.setFooter(p ? "preview" : "idle");
	}

	private setFooter(mode: FooterMode): void {
		if (this.footerMode === mode) return;
		this.footerMode = mode;
		if (mode === "empty") {
			this.ctx.setFooter("");
			return;
		}
		const frag = createFragment();
		if (mode === "preview") {
			frag.createSpan("sk-note-rail-live");
			frag.createSpan({ text: this.ctx.t("toc.foot-preview") });
		} else if (Platform.isMobile) {
			frag.createSpan({ text: this.ctx.t("toc.foot-tap") });
		} else if (!this.ctx.settings.tocHoverPreview) {
			frag.createSpan({ text: this.ctx.t("toc.foot-click") });
		} else {
			frag.createSpan({ text: this.ctx.t("toc.foot-hover") });
		}
		this.ctx.setFooter(frag);
	}

	// ---- scroll tracking -----------------------------------------------------------

	/** Listen to both scrollers (editing and reading) so mode switches need no rebinding. */
	private bindScrollers(): void {
		const els: HTMLElement[] = [];
		const cm = (this.ctx.view.editor as unknown as { cm?: { scrollDOM?: HTMLElement } } | undefined)?.cm;
		if (cm?.scrollDOM) els.push(cm.scrollDOM);
		const reading = this.ctx.view.contentEl.querySelector<HTMLElement>(".markdown-reading-view .markdown-preview-view");
		if (reading) els.push(reading);
		for (const el of els) {
			if (this.boundScrollers.has(el)) continue;
			this.boundScrollers.add(el);
			this.on(el, "scroll", () => {
				this.win.cancelAnimationFrame(this.syncRaf);
				this.syncRaf = this.win.requestAnimationFrame(() => this.sync(false));
			}, { passive: true });
		}
	}

	private surface(): NoteSurface | null {
		try {
			return surfaceFor(this.ctx.view);
		} catch {
			return null;
		}
	}

	private currentMode(): NoteSurface["mode"] {
		return this.ctx.view.getMode() === "preview" ? "reading" : "editor";
	}

	/** The view switched modes: a preview made in the other mode cannot be restored there. */
	private checkMode(): void {
		const mode = this.currentMode();
		if (this.preview && this.preview.surface.mode !== mode) this.dropPreview();
		if (this.restoring && this.restoring.surface.mode !== mode) this.stopRestore();
	}

	/** Animations started here stop as soon as the note or the mode changes under them. */
	private guardFor(surface: NoteSurface, file: TFile | null): () => boolean {
		return () => this.ctx.view.file === file && this.currentMode() === surface.mode && surface.scrollEl.isConnected;
	}

	/** Progress bar + current section marker. */
	private sync(instant: boolean): void {
		this.checkMode();
		const s = this.surface();
		if (!s || !this.entries.length) return;
		const el = s.scrollEl;
		const max = el.scrollHeight - el.clientHeight;
		this.ctx.setProgress(max > 0 ? el.scrollTop / max : 0);

		const tops = this.entries.map((e) => s.lineTop(e.line));
		const idx = currentIndex(tops, el.scrollTop, el.clientHeight, max, CURRENT_OFFSET);
		if (idx === this.current && !instant) return;
		this.rows[this.current]?.removeClass("is-current");
		this.current = idx;
		const row = this.rows[idx];
		if (!row) {
			this.markerEl.removeClass("is-on");
			return;
		}
		row.addClass("is-current");
		if (instant) this.markerEl.addClass("is-instant");
		this.markerEl.setCssProps({ "--y": `${row.offsetTop}px` });
		this.markerEl.setCssProps({ "--h": `${row.offsetHeight}px` });
		this.markerEl.addClass("is-on");
		if (instant) {
			void this.markerEl.offsetWidth;
			this.markerEl.removeClass("is-instant");
		}
		// Follow along in the list, but never move rows under the pointer or the keyboard focus.
		if (!this.pointerInside && !this.listEl.contains(this.listEl.doc.activeElement)) this.revealCurrentRow(instant);
	}

	private revealCurrentRow(center: boolean): void {
		const row = this.rows[this.current];
		if (!row) return;
		const body = this.body;
		const top = row.offsetTop + this.listEl.offsetTop;
		const bottom = top + row.offsetHeight;
		if (center) {
			if (bottom > body.scrollTop + body.clientHeight || top < body.scrollTop) body.scrollTop = top - body.clientHeight / 2 + row.offsetHeight / 2;
			return;
		}
		if (top < body.scrollTop + 8) body.scrollTop = top - 8;
		else if (bottom > body.scrollTop + body.clientHeight - 8) body.scrollTop = bottom - body.clientHeight + 8;
	}

	// ---- hover and keyboard preview --------------------------------------------------

	private rowOf(target: EventTarget | null): HTMLElement | null {
		const el = asElement(target)?.closest<HTMLElement>(".sk-note-rail-row") ?? null;
		return el && this.listEl.contains(el) ? el : null;
	}

	private schedulePreview(row: HTMLElement): void {
		this.win.clearTimeout(this.hoverTimer);
		if (this.closing || !this.ctx.settings.tocHoverPreview || row === this.preview?.row) return;
		this.hoverTimer = this.win.setTimeout(() => this.startPreview(row), clamp(this.ctx.settings.tocHoverDelay, 0, 1000, 100));
	}

	private onPointerOver(e: PointerEvent): void {
		if (e.pointerType === "touch") return;
		const row = this.rowOf(e.target);
		if (row) this.schedulePreview(row);
	}

	private onPointerOut(e: PointerEvent): void {
		if (!this.rowOf(e.relatedTarget)) this.win.clearTimeout(this.hoverTimer);
	}

	/** Focus left the list for something else than a row: go back like a pointer leave. */
	private onFocusOut(e: FocusEvent): void {
		const to = e.relatedTarget as Node | null;
		if (to && this.listEl.contains(to)) return;
		this.win.clearTimeout(this.hoverTimer);
		// Commit already moved focus to the editor and cleared the preview: nothing to undo then.
		if (this.preview && !this.pointerInside) this.endPreview(true);
	}

	private onKeyDown(e: KeyboardEvent): void {
		const row = this.rowOf(e.target);
		if (!row) return;
		const i = this.rows.indexOf(row);
		let next = -1;
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			this.commit(row);
			return;
		}
		if (e.key === "ArrowDown") next = Math.min(this.rows.length - 1, i + 1);
		else if (e.key === "ArrowUp") next = Math.max(0, i - 1);
		else if (e.key === "Home") next = 0;
		else if (e.key === "End") next = this.rows.length - 1;
		if (next < 0) return;
		e.preventDefault();
		this.rows[next].focus();
		this.rows[next].scrollIntoView({ block: "nearest" });
		// Arrowing through the list previews like hovering does.
		this.schedulePreview(this.rows[next]);
	}

	private startPreview(row: HTMLElement): void {
		if (this.closing || !row.isConnected) return;
		const entry = this.entries[Number(row.dataset.index)];
		const s = this.surface();
		if (!entry || !s) return;
		const file = this.ctx.view.file;
		if (this.preview && (this.preview.surface.mode !== s.mode || this.preview.file !== file)) this.dropPreview();
		if (!this.preview) {
			// Re-entering while gliding back: keep the original spot, not the midway one.
			const r = this.restoring;
			const origin = r && r.surface.mode === s.mode && r.file === file ? r.origin : s.anchor();
			this.stopRestore();
			this.preview = { surface: s, file, origin, line: null, row: null };
		}
		const p = this.preview;
		p.row?.removeClass("is-preview");
		row.addClass("is-preview");
		p.row = row;
		p.line = entry.line;
		p.surface.mark("hold", entry.line);
		this.scrollToLine(p.surface, entry.line, file);
		this.setFooter("preview");
	}

	/** Stop previewing; optionally glide back to exactly where the reader was. */
	private endPreview(restore: boolean, sync = false): void {
		this.win.clearTimeout(this.hoverTimer);
		const p = this.preview;
		this.clearPreviewMarks();
		if (p && restore && this.currentMode() === p.surface.mode && this.ctx.view.file === p.file) {
			const handle = animateScroll(p.surface.scrollEl, () => p.surface.anchorTop(p.origin), {
				duration: 520,
				sync,
				finishOnUnload: true,
				guard: this.guardFor(p.surface, p.file),
				onEnd: () => {
					if (this.restoring?.handle.done) this.restoring = null;
				},
			});
			this.restoring = handle.done ? null : { surface: p.surface, file: p.file, origin: p.origin, handle };
		}
		if (this.entries.length) this.setFooter("idle");
	}

	/** Forget the preview without scrolling (new note, mode switch, teardown). */
	private dropPreview(): void {
		const p = this.preview;
		this.clearPreviewMarks();
		// Stop a preview scroll still travelling for this preview.
		if (p && !this.restoring) cancelScroll(p.surface.scrollEl);
	}

	private clearPreviewMarks(): void {
		const p = this.preview;
		this.preview = null;
		if (!p) return;
		if (p.line !== null) {
			try {
				p.surface.mark("hold", null);
			} catch {
				// Surface gone (view closed).
			}
		}
		p.row?.removeClass("is-preview");
	}

	private stopRestore(): void {
		const r = this.restoring;
		this.restoring = null;
		r?.handle.stop();
	}

	private scrollToLine(s: NoteSurface, line: number, file: TFile | null): void {
		if (s.lineTop(line) === null) {
			// No geometry available (unknown renderer): fall back to Obsidian's own line scroll.
			const mode = (this.ctx.view).currentMode as unknown as { applyScroll?(n: number): void };
			mode.applyScroll?.(line);
			return;
		}
		animateScroll(
			s.scrollEl,
			() => {
				const t = s.lineTop(line);
				return t === null ? null : t - HEADING_OFFSET;
			},
			{ guard: this.guardFor(s, file) },
		);
	}

	// ---- commit --------------------------------------------------------------------

	private onClick(e: MouseEvent): void {
		const row = this.rowOf(e.target);
		if (row) this.commit(row);
	}

	private commit(row: HTMLElement): void {
		const entry = this.entries[Number(row.dataset.index)];
		const s = this.surface();
		if (!entry || !s) return;
		this.win.clearTimeout(this.hoverTimer);
		// A pinned card stays open and keeps previewing; otherwise it is on its way out.
		this.closing = !this.ctx.isPinned();
		// Commit: the previewed position becomes the real one, nothing to restore.
		this.clearPreviewMarks();
		this.stopRestore();
		this.setFooter("idle");
		this.scrollToLine(s, entry.line, this.ctx.view.file);
		s.mark("flash", entry.line);
		s.placeCursor(entry.line);
		this.ctx.close("commit");
	}

	// ---- helpers -------------------------------------------------------------------

	private on(el: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions): void {
		el.addEventListener(type, fn, opts);
		this.cleanups.push(() => el.removeEventListener(type, fn, opts));
	}
}
