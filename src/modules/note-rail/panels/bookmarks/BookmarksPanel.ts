// Bookmarks: notes pinned to this note (in its frontmatter) and vault-wide pins (in the settings).
import { Keymap, Notice, Platform, setIcon, TFile } from "obsidian";
import type { HoverParent, HoverPopover } from "obsidian";
import type { NoteRailService } from "../../../../core/services";
import { mountPinManager } from "../../pin-manager";
import { addNotePin, getNotePins, getVaultPins, pinsReorder, pinWritesSettled, removeNotePin, reorderNotePins } from "../../pins";
import { asElement, asNode, dur, reducedMotion, SPRING } from "../../rail/motion";
import { hueOf, placeFinder } from "../../parents";
import { cleanVaultPins, pinsKey } from "../../settings";
import type { PanelContext, PanelDefinition, PanelInstance } from "../../types";
import { pinCandidates, rankCandidates, renderHighlighted } from "./candidates";

type ListKind = "note" | "vault";

/** Pointer travel before a press becomes a drag (mouse and pen). */
const DRAG_SLOP = 4;
/** Touch: hold this long without moving to pick a row up. */
const LONG_PRESS_MS = 380;
/** Touch: moving more than this before the long press means scrolling. */
const TOUCH_SLOP = 8;
/** After a frontmatter write, how long the panel trusts its own order over a stale metadata cache. */
const PENDING_GRACE_MS = 1500;
const SUGGEST_LIMIT = 8;
/** The tip card shows on the first openings of the panel, until "Got it". */
const TIP_OPENINGS = 3;
/** Panel bodies whose opening was already counted for the tip card. */
const tipCounted = new WeakSet<HTMLElement>();

interface PinList {
	kind: ListKind;
	itemsEl: HTMLElement;
	countEl: HTMLElement;
	/** What the rows show, in order. Ahead of the metadata cache while a write is in flight. */
	files: TFile[];
}

interface DragState {
	list: PinList;
	row: HTMLElement;
	rows: HTMLElement[];
	from: number;
	to: number;
	startX: number;
	startY: number;
	step: number;
	pointerId: number;
	touch: boolean;
	active: boolean;
	timer: number;
}

const sig = (files: TFile[]): string => files.map((f) => f.path).join("\n");
const ROW = ".sk-note-rail-bm-row:not(.is-leaving)";
/** Everything that may move when a row appears or disappears above it. */
const FOLLOWERS = ".sk-note-rail-bm-row, .sk-note-rail-section, .sk-note-rail-add, .sk-note-rail-empty, .sk-note-rail-suggest";

/**
 * Bookmarks: notes pinned to this note (frontmatter, written through src/pins) and vault-wide pins
 * (settings.vaultPins). Rows open on click, preview with Ctrl/Cmd hover, reorder by drag or
 * Alt+Up/Down, and are removed with their x button or Delete.
 */
class BookmarksPanel implements PanelInstance {
	private win: Window;
	private rootEl: HTMLElement;
	private note: PinList;
	private vault: PinList;
	private vaultManager: ReturnType<typeof mountPinManager> | null = null;
	private noteAddEl: HTMLElement;
	private vaultAddEl: HTMLElement;
	private vaultAddLabel: HTMLElement;
	private suggestSlot: HTMLElement;
	private suggestEl: HTMLElement | null = null;
	private suggestInput: HTMLInputElement | null = null;
	private suggestList: HTMLElement | null = null;
	private suggestItems: TFile[] = [];
	private suggestSel = 0;
	private drag: DragState | null = null;
	private suppressClick = false;
	private refreshQueued = false;
	/** Order last written to the frontmatter, until the metadata cache shows it. */
	private pendingNote: string | null = null;
	private pendingTimer = 0;
	/** Incremented on every note write: only the latest one arms the grace timer. */
	private writeSeq = 0;
	/** Rows to their file (TFile objects survive renames, their path changes). */
	private rowFiles = new WeakMap<HTMLElement, TFile>();
	/** Esc ended a drag while the button is still down: swallow the click of the coming pointerup. */
	private swallowUntilUp: (() => void) | null = null;
	private hoverParent: HoverParent = { hoverPopover: null };
	private cleanups: (() => void)[] = [];
	private vaultFrame = 0;
	private destroyed = false;

	constructor(
		private ctx: PanelContext,
		private body: HTMLElement,
	) {
		this.win = body.win ?? window;
		this.rootEl = body.createDiv("sk-note-rail-bm");

		this.renderTip();

		this.note = this.createList("note", ctx.t("bookmarks.this-note"));
		this.suggestSlot = this.rootEl.createDiv("sk-note-rail-bm-suggest-slot");
		this.noteAddEl = this.createAdd("plus", ctx.t("bookmarks.add-here"));
		this.noteAddEl.addEventListener("click", () => this.openSuggest());

		this.vault = this.createList("vault", ctx.t("bookmarks.vault"));
		const rail = ctx.service<NoteRailService>("note-rail");
		if (rail) this.vaultManager = mountPinManager(this.vault.itemsEl, rail, {
			t: ctx.t,
			openNote: (path, event) => {
				const file = ctx.app.vault.getAbstractFileByPath(path);
				if (file instanceof TFile && event) void this.open(file, event);
			},
			dot: (path) => {
				const file = ctx.app.vault.getAbstractFileByPath(path);
				const area = file instanceof TFile ? placeFinder(ctx.app).placeOf(file).area : null;
				return area ? `hsl(${hueOf(area.path)} var(--sk-dot-s) var(--sk-dot-l))` : null;
			},
		}, false);
		this.vaultAddEl = this.createAdd("pin", ctx.t("bookmarks.pin-current"));
		this.vaultAddLabel = this.vaultAddEl.querySelector("span:last-child") as HTMLElement;
		this.vaultAddEl.addEventListener("click", () => this.toggleCurrentInVault());

		this.listen(this.rootEl, "click", (e) => this.onClick(e as MouseEvent));
		this.listen(this.rootEl, "auxclick", (e) => this.onAuxClick(e as MouseEvent));
		this.listen(this.rootEl, "pointerdown", (e) => this.onPointerDown(e as PointerEvent));
		this.listen(this.rootEl, "keydown", (e) => this.onKeyDown(e as KeyboardEvent));
		this.listen(this.rootEl, "mouseover", (e) => this.onMouseOver(e as MouseEvent));
		// Window capture runs before the rail's document listener: Esc closes the search or cancels a drag first.
		this.listen(this.win, "keydown", (e) => this.onWindowKeyDown(e as KeyboardEvent), true);
		// Touch: once a row is held, stop the panel from scrolling under the finger.
		this.listen(this.rootEl, "touchmove", (e) => {
			if (this.drag?.active) e.preventDefault();
		}, { passive: false });

		// Renames, moves and deletes: a folder event comes before its children are updated, so re-read
		// once the vault settles instead of trusting the rail's sync.
		const vault = this.ctx.app.vault;
		for (const ref of [vault.on("rename", this.queueRefresh), vault.on("delete", this.queueRefresh), vault.on("create", this.queueRefresh)]) {
			this.cleanups.push(() => vault.offref(ref));
		}

		this.refresh();
	}

	// ---- building ------------------------------------------------------------

	/** What used to be written all over the panel, said once: on the first openings, until "Got it". */
	private renderTip(): void {
		const seen = this.ctx.settings.bookmarksTips ?? 0;
		if (seen >= TIP_OPENINGS) return;
		// A pinned panel builds a new instance in the same body for each note: that is not an opening.
		if (!tipCounted.has(this.body)) {
			tipCounted.add(this.body);
			void this.ctx.updateSettings((s) => {
				s.bookmarksTips = Math.min(TIP_OPENINGS, (s.bookmarksTips ?? 0) + 1);
			});
		}
		const t = this.ctx.t;
		const tip = this.rootEl.createDiv("sk-note-rail-tip");
		const text = tip.createDiv("sk-note-rail-tip-text");
		// The property name as code wherever the language puts it.
		const [before, after] = t("bookmarks.tip-lists").split("{key}");
		const lists = text.createDiv();
		lists.appendText(before ?? "");
		lists.createEl("code", { text: pinsKey(this.ctx.settings) });
		lists.appendText(after ?? "");
		text.createDiv({ text: Platform.isMobile ? t("bookmarks.tip-move-touch") : t("bookmarks.tip-move", { mod: Platform.isMacOS ? "Cmd" : "Ctrl" }) });
		const ok = tip.createEl("button", { cls: "sk-btn is-ghost is-s sk-note-rail-tip-ok", text: t("bookmarks.tip-ok"), attr: { type: "button" } });
		ok.addEventListener("click", () => {
			void this.ctx.updateSettings((s) => {
				s.bookmarksTips = TIP_OPENINGS;
			});
			tip.remove();
		});
	}

	private createList(kind: ListKind, title: string): PinList {
		const head = this.rootEl.createDiv("sk-note-rail-section");
		head.createSpan({ text: title });
		head.createSpan("sk-note-rail-bm-grow");
		const countEl = head.createSpan("sk-note-rail-count");
		const itemsEl = this.rootEl.createDiv({ cls: "sk-note-rail-bm-items", attr: { "data-list": kind, role: "list" } });
		return { kind, itemsEl, countEl, files: [] };
	}

	private createAdd(icon: string, label: string): HTMLElement {
		const el = this.rootEl.createEl("button", { cls: "sk-btn is-s sk-note-rail-add", attr: { type: "button" } });
		setIcon(el.createSpan("sk-note-rail-add-icon"), icon);
		el.createSpan({ text: label });
		return el;
	}

	private createRow(list: PinList, file: TFile): HTMLElement {
		const row = list.itemsEl.createDiv({ cls: "sk-note-rail-row sk-note-rail-bm-row", attr: { tabindex: "0", role: "listitem", "data-path": file.path } });
		const lead = row.createSpan("sk-note-rail-bm-lead");
		setIcon(lead.createSpan("sk-note-rail-bm-file"), "file-text");
		setIcon(lead.createSpan("sk-note-rail-bm-grip"), "grip-vertical");
		row.createSpan({ cls: "sk-note-rail-row-title", attr: { "data-self": this.ctx.t("bookmarks.self") } });
		row.createSpan("sk-note-rail-row-meta");
		this.fillRow(row, file);
		const remove = row.createEl("button", {
			cls: "sk-btn is-ghost is-icon is-s sk-note-rail-row-action",
			attr: { type: "button", "aria-label": this.ctx.t(list.kind === "note" ? "bookmarks.unpin-note" : "bookmarks.unpin-vault") },
		});
		setIcon(remove, "x");
		return row;
	}

	/** Path, name and folder of a row (new row, or a pinned note renamed or moved). */
	private fillRow(row: HTMLElement, file: TFile): void {
		this.rowFiles.set(row, file);
		row.dataset.path = file.path;
		row.querySelector(".sk-note-rail-row-title")?.setText(file.basename);
		// Under the name: the area the note belongs to (in its color), else its folder.
		const meta = row.querySelector<HTMLElement>(".sk-note-rail-row-meta");
		const area = placeFinder(this.ctx.app).placeOf(file).area;
		const label = area && area !== file ? area.basename : file.parent && !file.parent.isRoot() ? file.parent.path : "";
		meta?.setText(label);
		meta?.toggle(!!label);
		row.toggleClass("has-area", !!area);
		if (area) row.style.setProperty("--sk-bm-hue", String(hueOf(area.path)));
		else row.style.removeProperty("--sk-bm-hue");
	}

	// ---- refresh -------------------------------------------------------------

	private queueRefresh = (): void => {
		if (this.destroyed || this.vaultFrame) return;
		this.vaultFrame = this.win.requestAnimationFrame(() => {
			this.vaultFrame = 0;
			this.refresh();
		});
	};

	refresh(): void {
		if (this.destroyed) return;
		if (this.drag) {
			this.refreshQueued = true;
			return;
		}
		const { app, settings } = this.ctx;
		const file = this.ctx.view.file;
		this.ctx.setSubtitle(file?.basename ?? "");

		const notePins = file ? getNotePins(app, file, settings) : [];
		if (this.pendingNote !== null && sig(notePins) === this.pendingNote) this.clearPending();
		// While our own write is on its way, the cache still shows the old order: keep ours.
		if (this.pendingNote === null) this.renderList(this.note, notePins);
		if (this.vaultManager) {
			this.vault.files = getVaultPins(app, settings);
			this.vaultManager.update();
		} else this.renderList(this.vault, getVaultPins(app, settings));
		this.updateMeta();
	}

	/**
	 * Keyed update against what the DOM shows (data-path), rows reused by file identity: focus and
	 * hover survive a refresh, and a renamed note keeps its row with a new path and label.
	 */
	private renderList(list: PinList, files: TFile[]): void {
		const current = this.ctx.view.file;
		list.files = files.slice();
		const shown = this.rows(list);
		const upToDate = shown.length === files.length
			&& shown.every((row, i) => row.dataset.path === files[i].path && this.rowFiles.get(row) === files[i])
			&& (files.length > 0 || !!list.itemsEl.querySelector(".sk-note-rail-empty"));
		for (const row of shown) row.toggleClass("is-self", row.dataset.path === current?.path);
		if (upToDate) {
			for (const row of shown) {
				const f = this.rowFiles.get(row);
				if (f) this.fillRow(row, f);
			}
			return;
		}

		const doc = list.itemsEl.doc;
		const hadFocus = list.itemsEl.contains(doc.activeElement) ? (doc.activeElement as HTMLElement) : null;
		const existing = new Map<TFile, HTMLElement>();
		for (const row of shown) {
			const f = this.rowFiles.get(row);
			if (f && !existing.has(f)) existing.set(f, row);
			else row.remove();
		}
		list.itemsEl.querySelector(".sk-note-rail-empty")?.remove();

		const ordered = files.map((f) => {
			let row = existing.get(f);
			if (row) {
				existing.delete(f);
				if (row.dataset.path !== f.path) this.fillRow(row, f);
			} else row = this.createRow(list, f);
			row.toggleClass("is-self", f.path === current?.path);
			return row;
		});
		for (const row of existing.values()) row.remove();
		const now = this.rows(list);
		if (ordered.some((row, i) => now[i] !== row)) for (const row of ordered) list.itemsEl.appendChild(row);
		if (!files.length) this.showEmpty(list);
		if (hadFocus?.isConnected && doc.activeElement !== hadFocus) hadFocus.focus({ preventScroll: true });
	}

	/** An empty list says nothing: the add button below it is enough. */
	private showEmpty(list: PinList): HTMLElement {
		return list.itemsEl.createDiv({ cls: "sk-note-rail-empty is-silent" });
	}

	private updateMeta(): void {
		this.note.countEl.setText(String(this.note.files.length));
		this.vault.countEl.setText(String(this.vault.files.length));
		this.ctx.setCount(this.note.files.length + this.vault.files.length);
		const file = this.ctx.view.file;
		const pinned = !!file && this.vault.files.some((f) => f.path === file.path);
		this.vaultAddLabel.setText(this.ctx.t(pinned ? "bookmarks.unpin-current" : "bookmarks.pin-current"));
		const icon = this.vaultAddEl.querySelector<HTMLElement>(".sk-note-rail-add-icon");
		if (icon && icon.dataset.icon !== (pinned ? "pin-off" : "pin")) {
			icon.dataset.icon = pinned ? "pin-off" : "pin";
			setIcon(icon, icon.dataset.icon);
		}
		this.vaultAddEl.toggleClass("is-on", pinned);
	}

	// ---- changes -------------------------------------------------------------

	private addPin(list: PinList, target: TFile): HTMLElement | null {
		if (list.files.some((f) => f.path === target.path)) return null;
		if (list.kind === "note" && target.path === this.ctx.view.file?.path) return null;
		let row: HTMLElement | null = null;
		this.flip(this.followersAfter(list.itemsEl), () => {
			list.itemsEl.querySelector(".sk-note-rail-empty")?.remove();
			row = this.createRow(list, target);
			row.toggleClass("is-self", target.path === this.ctx.view.file?.path);
		});
		list.files = [...list.files, target];
		if (row) this.popIn(row);
		this.updateMeta();
		this.persist(list, { add: target });
		return row;
	}

	private removePin(list: PinList, path: string): void {
		const index = list.files.findIndex((f) => f.path === path);
		if (index < 0) return;
		list.files = list.files.filter((f) => f.path !== path);
		const row = this.rowOf(list, path);
		if (row) {
			const doc = row.doc;
			if (row.contains(doc.activeElement)) {
				const rows = this.rows(list).filter((r) => r !== row);
				(rows[index] ?? rows[index - 1] ?? (list.kind === "note" ? this.noteAddEl : this.vaultAddEl)).focus({ preventScroll: true });
			}
			row.addClass("is-leaving");
			const done = () => {
				if (!row.isConnected) return;
				this.flip(this.followersAfter(row), () => {
					row.remove();
					if (!list.files.length && !list.itemsEl.querySelector(".sk-note-rail-empty")) this.popIn(this.showEmpty(list));
				});
			};
			if (reducedMotion(this.win) || typeof row.animate !== "function") done();
			else {
				const anim = row.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(14px)" }], { duration: 180, easing: "ease-in", fill: "forwards" });
				anim.finished.then(done, done);
			}
		}
		this.updateMeta();
		const target = this.ctx.app.vault.getAbstractFileByPath(path);
		this.persist(list, { remove: path, removeFile: target instanceof TFile ? target : null });
	}

	/** Move `row` to `to` (drag drop or Alt+arrows) and save the new order. */
	private reorder(list: PinList, from: number, to: number): void {
		if (from === to) return;
		const files = list.files.slice();
		const [moved] = files.splice(from, 1);
		files.splice(to, 0, moved);
		list.files = files;
		this.persist(list, { order: files.map((f) => f.path) });
	}

	/**
	 * Saves one change as an edit of the current state (never a replacement by the shown list, which
	 * may be stale): pins added or deleted elsewhere meanwhile survive a drop, and are not restored.
	 */
	private persist(list: PinList, change: { add?: TFile; remove?: string; removeFile?: TFile | null; order?: string[] }): void {
		const { app } = this.ctx;
		if (list.kind === "vault") {
			void this.ctx.updateSettings((s) => {
				let pins = cleanVaultPins(s.vaultPins);
				if (change.add && !pins.includes(change.add.path)) pins = [...pins, change.add.path];
				if (change.remove) pins = pins.filter((p) => p !== change.remove);
				if (change.order) pins = pinsReorder(pins, (p) => p as string, change.order) as string[];
				s.vaultPins = pins;
			});
			return;
		}
		const file = this.ctx.view.file;
		if (!file) return;
		const settings = this.ctx.settings;
		let write: Promise<void>;
		if (change.add) write = addNotePin(app, file, change.add, settings);
		else if (change.removeFile) write = removeNotePin(app, file, change.removeFile, settings);
		else if (change.order) write = reorderNotePins(app, file, change.order, settings);
		else return;
		this.pendingNote = sig(list.files);
		this.win.clearTimeout(this.pendingTimer);
		const seq = ++this.writeSeq;
		write
			.then(() => pinWritesSettled(file))
			.then(
				() => {
					// Only the latest write arms the timer; the cache normally confirms within a few ms.
					if (this.destroyed || seq !== this.writeSeq) return;
					this.win.clearTimeout(this.pendingTimer);
					this.pendingTimer = this.win.setTimeout(() => {
						this.pendingNote = null;
						this.refresh();
					}, PENDING_GRACE_MS);
				},
				(err) => {
					console.error("[Snailkit] note-rail: could not save the pins", err);
					new Notice(this.ctx.t("bookmarks.save-error"));
					if (this.destroyed) return;
					this.clearPending();
					this.refresh();
				},
			);
	}

	private clearPending(): void {
		this.pendingNote = null;
		this.win.clearTimeout(this.pendingTimer);
	}

	private toggleCurrentInVault(): void {
		const file = this.ctx.view.file;
		if (!file) return;
		const rail = this.ctx.service<NoteRailService>("note-rail");
		if (rail) {
			void rail.setPinned(file.path, !rail.isPinned(file.path)).catch(() => new Notice(this.ctx.t("bookmarks.save-error")));
			return;
		}
		if (this.vault.files.some((f) => f.path === file.path)) this.removePin(this.vault, file.path);
		else this.addPin(this.vault, file);
	}

	// ---- opening -------------------------------------------------------------

	private async open(file: TFile, evt: MouseEvent | KeyboardEvent): Promise<void> {
		const newTab = Keymap.isModEvent(evt);
		const view = this.ctx.view;
		if (!newTab && view.file?.path === file.path) {
			this.ctx.close("commit");
			return;
		}
		try {
			const leaf = newTab ? this.ctx.app.workspace.getLeaf(newTab) : view.leaf;
			await leaf.openFile(file);
			if (!this.destroyed) this.ctx.close("commit");
		} catch (err) {
			console.error("[Snailkit] note-rail:", err);
			new Notice(this.ctx.t("panel.open-error", { name: file.basename }));
		}
	}

	private fileOfRow(row: HTMLElement): { list: PinList; file: TFile } | null {
		const list = row.parentElement === this.note.itemsEl ? this.note : row.parentElement === this.vault.itemsEl ? this.vault : null;
		const file = list?.files.find((f) => f.path === row.dataset.path);
		return list && file ? { list, file } : null;
	}

	// ---- events --------------------------------------------------------------

	private onClick(e: MouseEvent): void {
		const target = asElement(e.target);
		if (!target || this.suggestEl?.contains(target)) return;
		const row = target.closest<HTMLElement>(".sk-note-rail-bm-row");
		if (!row || row.hasClass("is-leaving")) return;
		const hit = this.fileOfRow(row);
		if (!hit) return;
		if (target.closest(".sk-note-rail-row-action")) {
			e.stopPropagation();
			this.removePin(hit.list, hit.file.path);
			return;
		}
		if (this.suppressClick) return;
		void this.open(hit.file, e);
	}

	private onAuxClick(e: MouseEvent): void {
		if (e.button !== 1) return;
		const row = asElement(e.target)?.closest<HTMLElement>(".sk-note-rail-bm-row");
		const hit = row && !asElement(e.target)?.closest(".sk-note-rail-row-action") ? this.fileOfRow(row) : null;
		if (!hit) return;
		e.preventDefault();
		void this.open(hit.file, e);
	}

	private onMouseOver(e: MouseEvent): void {
		const managed = asElement(e.target)?.closest<HTMLElement>("[data-pin-key]");
		if (managed?.dataset.pinKey?.startsWith("pin:")) {
			this.ctx.app.workspace.trigger("hover-link", {
				event: e, source: this.ctx.hoverSource, hoverParent: this.hoverParent,
				targetEl: managed, linktext: managed.dataset.pinKey.slice(4), sourcePath: this.ctx.view.file?.path ?? "",
			});
			return;
		}
		const row = asElement(e.target)?.closest<HTMLElement>(".sk-note-rail-bm-row");
		if (!row || this.drag?.active) return;
		const hit = this.fileOfRow(row);
		if (!hit) return;
		this.ctx.app.workspace.trigger("hover-link", {
			event: e,
			source: this.ctx.hoverSource,
			hoverParent: this.hoverParent,
			targetEl: row,
			linktext: hit.file.path,
			sourcePath: this.ctx.view.file?.path ?? "",
		});
	}

	private onKeyDown(e: KeyboardEvent): void {
		const target = asElement(e.target) as HTMLElement | null;
		if (!target || this.suggestEl?.contains(target)) return;
		const row = target.hasClass("sk-note-rail-bm-row") ? target : null;
		const hit = row ? this.fileOfRow(row) : null;

		if ((e.key === "ArrowUp" || e.key === "ArrowDown") && e.altKey && hit && row) {
			e.preventDefault();
			const from = hit.list.files.indexOf(hit.file);
			const to = from + (e.key === "ArrowUp" ? -1 : 1);
			if (to < 0 || to >= hit.list.files.length) return;
			const rows = this.rows(hit.list);
			const before = rows.map((r) => r.getBoundingClientRect().top);
			const other = rows[to];
			if (to < from) hit.list.itemsEl.insertBefore(row, other);
			else hit.list.itemsEl.insertBefore(other, row);
			row.focus({ preventScroll: true });
			this.animateMoves(rows, before);
			this.reorder(hit.list, from, to);
			return;
		}
		if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.altKey && !e.ctrlKey && !e.metaKey) {
			const stops = Array.from(this.rootEl.querySelectorAll<HTMLElement>(`${ROW}, .sk-note-rail-add`));
			const i = stops.indexOf(target);
			if (i < 0) return;
			e.preventDefault();
			stops[Math.max(0, Math.min(stops.length - 1, i + (e.key === "ArrowUp" ? -1 : 1)))].focus();
			return;
		}
		if (!hit || target !== row) return;
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			void this.open(hit.file, e);
		} else if (e.key === "Delete" || e.key === "Backspace") {
			e.preventDefault();
			this.removePin(hit.list, hit.file.path);
		}
	}

	private onWindowKeyDown(e: KeyboardEvent): void {
		if (e.key !== "Escape") return;
		if (this.drag) {
			e.preventDefault();
			e.stopPropagation();
			this.endDrag(false, true);
			return;
		}
		const target = asNode(e.target);
		if (this.suggestEl && target && this.suggestEl.contains(target)) {
			e.preventDefault();
			e.stopPropagation();
			this.closeSuggest();
			this.noteAddEl.focus({ preventScroll: true });
		}
	}

	// ---- drag to reorder -----------------------------------------------------

	private onPointerDown(e: PointerEvent): void {
		if (this.drag || e.button !== 0 || this.destroyed) return;
		const target = asElement(e.target);
		const row = target?.closest<HTMLElement>(".sk-note-rail-bm-row");
		if (!row || row.hasClass("is-leaving") || target?.closest(".sk-note-rail-row-action")) return;
		const hit = this.fileOfRow(row);
		if (!hit) return;
		const rows = this.rows(hit.list);
		if (rows.length < 2) return;
		const from = rows.indexOf(row);
		const step = rows[1].offsetTop - rows[0].offsetTop || row.offsetHeight;
		const drag: DragState = {
			list: hit.list,
			row,
			rows,
			from,
			to: from,
			startX: e.clientX,
			startY: e.clientY,
			step,
			pointerId: e.pointerId,
			touch: e.pointerType === "touch",
			active: false,
			timer: 0,
		};
		this.drag = drag;
		try {
			row.setPointerCapture(e.pointerId);
		} catch {
			// Pointer already gone: the up event will not come, drop the state.
			this.drag = null;
			return;
		}
		if (drag.touch) drag.timer = this.win.setTimeout(() => this.activateDrag(), LONG_PRESS_MS);
		this.win.addEventListener("pointermove", this.onPointerMove, true);
		this.win.addEventListener("pointerup", this.onPointerUp, true);
		this.win.addEventListener("pointercancel", this.onPointerCancel, true);
		row.addEventListener("lostpointercapture", this.onPointerCancel);
	}

	private activateDrag(): void {
		const d = this.drag;
		if (!d || d.active) return;
		d.active = true;
		this.win.clearTimeout(d.timer);
		d.row.addClass("is-dragging");
		d.list.itemsEl.addClass("is-sorting");
		this.rootEl.addClass("is-sorting");
		const pop = this.hoverParent.hoverPopover as (HoverPopover & { hide?: () => void }) | null;
		pop?.hide?.();
		if (d.touch) navigator.vibrate?.(8);
	}

	private onPointerMove = (e: PointerEvent): void => {
		const d = this.drag;
		if (!d || e.pointerId !== d.pointerId) return;
		const dy = e.clientY - d.startY;
		if (!d.active) {
			if (d.touch) {
				// Moving before the long press means the finger is scrolling: let it.
				if (Math.abs(dy) > TOUCH_SLOP || Math.abs(e.clientX - d.startX) > TOUCH_SLOP) this.endDrag(false);
				return;
			}
			if (Math.abs(dy) < DRAG_SLOP) return;
			this.activateDrag();
		}
		const n = d.rows.length;
		const cdy = Math.max(-d.from * d.step - 6, Math.min((n - 1 - d.from) * d.step + 6, dy));
		d.row.style.transform = `translateY(${cdy}px) scale(1.02)`;
		d.to = Math.max(0, Math.min(n - 1, d.from + Math.round(cdy / d.step)));
		d.rows.forEach((r, i) => {
			if (r === d.row) return;
			let shift = 0;
			if (d.from < d.to && i > d.from && i <= d.to) shift = -d.step;
			if (d.from > d.to && i >= d.to && i < d.from) shift = d.step;
			r.style.transform = shift ? `translateY(${shift}px)` : "";
		});
	};

	private onPointerUp = (e: PointerEvent): void => {
		if (this.drag && e.pointerId === this.drag.pointerId) this.endDrag(true);
	};

	private onPointerCancel = (e: PointerEvent): void => {
		if (this.drag && e.pointerId === this.drag.pointerId) this.endDrag(false);
	};

	/** Drop (`commit`) or cancel the current drag, then run a refresh that arrived meanwhile. */
	private endDrag(commit: boolean, buttonStillDown = false): void {
		const d = this.drag;
		if (!d) return;
		this.drag = null;
		this.win.clearTimeout(d.timer);
		this.win.removeEventListener("pointermove", this.onPointerMove, true);
		this.win.removeEventListener("pointerup", this.onPointerUp, true);
		this.win.removeEventListener("pointercancel", this.onPointerCancel, true);
		d.row.removeEventListener("lostpointercapture", this.onPointerCancel);
		try {
			if (d.row.hasPointerCapture(d.pointerId)) d.row.releasePointerCapture(d.pointerId);
		} catch {
			// Already released.
		}
		if (d.active) {
			// The click that follows this pointerup must not open the note.
			this.suppressClick = true;
			if (buttonStillDown) this.swallowNextUp();
			else this.win.setTimeout(() => (this.suppressClick = false), 0);
			const to = commit ? d.to : d.from;
			const before = d.row.getBoundingClientRect().top;
			for (const r of d.rows) {
				r.style.transition = "none";
				r.style.transform = "";
			}
			d.row.removeClass("is-dragging");
			d.list.itemsEl.removeClass("is-sorting");
			this.rootEl.removeClass("is-sorting");
			if (to !== d.from) {
				const order = d.rows.filter((r) => r !== d.row);
				order.splice(to, 0, d.row);
				for (const r of order) d.list.itemsEl.appendChild(r);
			}
			void d.list.itemsEl.offsetWidth;
			for (const r of d.rows) r.style.transition = "";
			const after = d.row.getBoundingClientRect().top;
			if (!reducedMotion(this.win) && typeof d.row.animate === "function") {
				d.row.animate([{ transform: `translateY(${before - after}px) scale(1.02)` }, { transform: "none" }], { duration: 380, easing: SPRING });
			}
			if (to !== d.from) this.reorder(d.list, d.from, to);
		}
		if (this.refreshQueued) {
			this.refreshQueued = false;
			this.refresh();
		}
	}

	/** Keep click suppression until the pointer of the cancelled drag is released. */
	private swallowNextUp(): void {
		this.swallowUntilUp?.();
		const win = this.win;
		const detach = (): void => {
			win.removeEventListener("pointerup", done, true);
			win.removeEventListener("pointercancel", done, true);
			this.swallowUntilUp = null;
		};
		const done = (): void => {
			detach();
			// The click is dispatched right after pointerup, in the same task.
			win.setTimeout(() => (this.suppressClick = false), 0);
		};
		win.addEventListener("pointerup", done, true);
		win.addEventListener("pointercancel", done, true);
		this.swallowUntilUp = detach;
	}

	// ---- "pin a note here" search ----------------------------------------------

	private openSuggest(): void {
		if (this.destroyed) return;
		if (this.suggestEl) {
			this.suggestInput?.focus();
			return;
		}
		this.flip(this.followersAfter(this.suggestSlot), () => {
			const el = this.suggestSlot.createDiv("sk-note-rail-suggest");
			const bar = el.createDiv("sk-note-rail-suggest-input");
			setIcon(bar.createSpan("sk-note-rail-suggest-icon"), "search");
			const input = bar.createEl("input", { attr: { type: "text", placeholder: this.ctx.t("bookmarks.search"), spellcheck: "false", "aria-label": this.ctx.t("bookmarks.search") } });
			if (!Platform.isMobile) bar.createSpan({ cls: "sk-note-rail-kbd", text: "Esc" });
			const listEl = el.createDiv({ cls: "sk-note-rail-suggest-list", attr: { role: "listbox" } });
			this.suggestEl = el;
			this.suggestInput = input;
			this.suggestList = listEl;
		});
		const input = this.suggestInput!;
		const listEl = this.suggestList!;
		input.addEventListener("input", () => {
			this.suggestSel = 0;
			this.fillSuggest();
		});
		input.addEventListener("keydown", (e) => {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				const n = this.suggestItems.length;
				if (n) this.suggestSel = (this.suggestSel + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
				this.markSel(true);
			} else if (e.key === "Enter" && !e.isComposing) {
				e.preventDefault();
				const file = this.suggestItems[this.suggestSel];
				if (file) this.choose(file);
			}
		});
		listEl.addEventListener("mousemove", (e) => {
			const r = asElement(e.target)?.closest<HTMLElement>(".sk-note-rail-row");
			if (!r) return;
			const i = Number(r.dataset.index);
			if (i !== this.suggestSel) {
				this.suggestSel = i;
				this.markSel(false);
			}
		});
		listEl.addEventListener("click", (e) => {
			const r = asElement(e.target)?.closest<HTMLElement>(".sk-note-rail-row");
			const file = r ? this.suggestItems[Number(r.dataset.index)] : null;
			if (file) this.choose(file);
		});
		this.suggestSel = 0;
		this.fillSuggest();
		input.focus({ preventScroll: true });
	}

	private fillSuggest(): void {
		const file = this.ctx.view.file;
		if (!file || !this.suggestList || !this.suggestInput) return;
		const query = this.suggestInput.value;
		const ranked = rankCandidates(this.ctx.app, pinCandidates(this.ctx.app, file, this.note.files.map((f) => f.path)), query, SUGGEST_LIMIT);
		this.suggestItems = ranked.map((r) => r.file);
		this.suggestList.empty();
		ranked.forEach((r, i) => {
			const row = this.suggestList!.createDiv({ cls: "sk-note-rail-row", attr: { role: "option", "data-index": String(i) } });
			setIcon(row.createSpan("sk-note-rail-bm-lead"), "file-text");
			const title = row.createSpan("sk-note-rail-row-title");
			renderHighlighted(title, r.file.basename, r.match?.matches ?? null);
			const folder = r.file.parent && !r.file.parent.isRoot() ? r.file.parent.path : "";
			if (folder) row.createSpan({ cls: "sk-note-rail-row-meta", text: folder });
		});
		if (!ranked.length) this.suggestList.createDiv({ cls: "sk-note-rail-empty", text: this.ctx.t(query.trim() ? "bookmarks.no-match" : "bookmarks.no-candidates") });
		this.markSel(false);
	}

	private markSel(reveal: boolean): void {
		if (!this.suggestList) return;
		const rows = Array.from(this.suggestList.querySelectorAll<HTMLElement>(".sk-note-rail-row"));
		rows.forEach((r, i) => {
			r.toggleClass("is-sel", i === this.suggestSel);
			r.setAttribute("aria-selected", String(i === this.suggestSel));
		});
		if (reveal) rows[this.suggestSel]?.scrollIntoView({ block: "nearest" });
	}

	private choose(file: TFile): void {
		this.closeSuggest();
		const row = this.addPin(this.note, file);
		row?.focus({ preventScroll: true });
	}

	private closeSuggest(): void {
		const el = this.suggestEl;
		if (!el) return;
		this.suggestEl = null;
		this.suggestInput = null;
		this.suggestList = null;
		this.suggestItems = [];
		this.flip(this.followersAfter(this.suggestSlot), () => el.remove());
	}

	// ---- helpers ---------------------------------------------------------------

	private rows(list: PinList): HTMLElement[] {
		return Array.from(list.itemsEl.querySelectorAll<HTMLElement>(`:scope > ${ROW}`));
	}

	private rowOf(list: PinList, path: string): HTMLElement | null {
		return this.rows(list).find((r) => r.dataset.path === path) ?? null;
	}

	/** Elements below `el` in the panel (they glide when something above them appears or leaves). */
	private followersAfter(el: HTMLElement): HTMLElement[] {
		return Array.from(this.rootEl.querySelectorAll<HTMLElement>(FOLLOWERS)).filter(
			(x) => x !== el && !el.contains(x) && !x.closest(".sk-note-rail-suggest-list") && !!(el.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING),
		);
	}

	/** FLIP: measure, mutate, then let the moved elements glide from where they were. */
	private flip(els: HTMLElement[], mutate: () => void): void {
		if (reducedMotion(this.win)) {
			mutate();
			return;
		}
		const first = els.map((x) => x.getBoundingClientRect().top);
		mutate();
		this.animateMoves(els, first);
	}

	private animateMoves(els: HTMLElement[], first: number[]): void {
		if (reducedMotion(this.win)) return;
		els.forEach((x, i) => {
			if (!x.isConnected || typeof x.animate !== "function") return;
			const dy = first[i] - x.getBoundingClientRect().top;
			if (Math.abs(dy) > 0.5) x.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: dur(420, this.win), easing: SPRING });
		});
	}

	private popIn(el: HTMLElement): void {
		if (reducedMotion(this.win) || typeof el.animate !== "function") return;
		el.animate([{ opacity: 0, transform: "translateY(-4px) scale(0.97)" }, { opacity: 1, transform: "none" }], { duration: 420, easing: SPRING });
	}

	private listen(target: EventTarget, type: string, fn: (e: Event) => void, options?: boolean | AddEventListenerOptions): void {
		target.addEventListener(type, fn, options);
		this.cleanups.push(() => target.removeEventListener(type, fn, options));
	}

	destroy(): void {
		if (this.destroyed) return;
		this.endDrag(false);
		this.destroyed = true;
		this.vaultManager?.destroy();
		this.win.clearTimeout(this.pendingTimer);
		this.win.cancelAnimationFrame(this.vaultFrame);
		this.swallowUntilUp?.();
		for (const c of this.cleanups) c();
		this.cleanups = [];
		const pop = this.hoverParent.hoverPopover as (HoverPopover & { hide?: () => void }) | null;
		pop?.hide?.();
		this.hoverParent.hoverPopover = null;
		this.body.empty();
	}
}

export const bookmarksPanel: PanelDefinition = {
	id: "bookmarks",
	icon: "bookmark",
	isAvailable: (_env, view) => !!view.file,
	create: (ctx, body) => new BookmarksPanel(ctx, body),
};
