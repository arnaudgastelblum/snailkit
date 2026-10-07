import { syntaxTree } from "@codemirror/language";
import { Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { editorInfoField, Notice, type Editor } from "obsidian";
import { runItem } from "../actions/executor";
import type { ActionContext } from "../actions/types";
import { flashField } from "../editor/flash";
import { normalize, type SearchIndex } from "../search/SearchIndex";
import type { Availability, SlashMenuHost } from "../types/host";
import type { SlashItem } from "../types/settings";
import { buildMenuModel, type MenuRow } from "./model";
import { SlashMenu, type MenuAnchor } from "./SlashMenu";

/** What the controller needs from the plugin. */
export interface MenuControllerHost extends SlashMenuHost {
	/** Search index, rebuilt by the plugin when settings or commands change. */
	getIndex(): SearchIndex;
	blocked(): boolean;
	/** Availability for the current editor (computed once per menu opening). */
	availabilityFor(item: SlashItem, hasEditor: boolean): Availability;
	recordRecent(itemId: string): void;
}

interface Session {
	view: EditorView;
	/** Position of the trigger character. */
	from: number;
	menu: SlashMenu;
	query: string;
	/** Selection replaced by the trigger when opened by command (restored on Escape). */
	selection: string;
	/** Availability, computed at most once per item while the menu is open. */
	availability: (item: SlashItem) => Availability;
}

/** Syntax nodes where "/" is just a character (code, math, frontmatter). */
const NO_TRIGGER_NODE_RE = /codeblock|inline-code|code-block|math|frontmatter|comment/i;
const MAX_QUERY = 60;

/**
 * Connects CodeMirror to the floating menu: detects the trigger, follows the
 * typed query, handles the keyboard and runs the chosen item.
 */
export class MenuController {
	private session: Session | null = null;
	private views = new Set<EditorView>();

	private menus = new Set<SlashMenu>();
	constructor(private host: MenuControllerHost) {}
	destroy(): void { this.close(false); for (const menu of this.menus) menu.destroy(); this.menus.clear(); }

	/** Editor extensions to register with registerEditorExtension. */
	extensions(): Extension[] {
		const plugin = ViewPlugin.define((view) => {
			const onScroll = () => this.reanchor(view);
			this.views.add(view);
			view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
			return {
				update: (update: ViewUpdate) => this.onUpdate(update),
				destroy: () => {
					this.views.delete(view);
					view.scrollDOM.removeEventListener("scroll", onScroll);
					if (this.session?.view === view) this.close(false);
				},
			};
		});

		const whenOpen = (fn: (s: Session) => boolean) => (view: EditorView) => {
			const s = this.session;
			return s !== null && s.view === view ? fn(s) : false;
		};
		const keys = Prec.highest(
			keymap.of([
				{ key: "ArrowDown", run: whenOpen((s) => (s.menu.move(1), true)) },
				{ key: "ArrowUp", run: whenOpen((s) => (s.menu.move(-1), true)) },
				{ key: "Ctrl-n", run: whenOpen((s) => (s.menu.move(1), true)) },
				{ key: "Ctrl-p", run: whenOpen((s) => (s.menu.move(-1), true)) },
				{ key: "PageDown", run: whenOpen((s) => (s.menu.page(1), true)) },
				{ key: "PageUp", run: whenOpen((s) => (s.menu.page(-1), true)) },
				{ key: "Enter", run: whenOpen((s) => this.chooseSelected(s)) },
				{ key: "Tab", run: whenOpen((s) => this.complete(s)) },
				{ key: "Escape", run: whenOpen((s) => (this.escape(s), true)) },
			]),
		);
		return [plugin, keys, flashField];
	}

	get isOpen(): boolean {
		return this.session !== null;
	}

	/** Closes the menu (settings changed, plugin unloading, focus lost...). */
	close(animated = true): void {
		const s = this.session;
		if (!s) return;
		this.session = null;
		s.menu.close(animated);
	}

	/**
	 * Opens the menu from the "Open slash menu" command: inserts the trigger at
	 * the cursor, temporarily replacing and remembering the selection.
	 */
	openFromCommand(editor: Editor): boolean {
		if (this.host.blocked()) return false;
		const view = this.viewFor(editor);
		if (!view) return false;
		this.close(false);
		const { triggerChar } = this.host.store.settings;
		const range = view.state.selection.main;
		const selection = view.state.sliceDoc(range.from, range.to);
		view.dispatch({
			changes: { from: range.from, to: range.to, insert: triggerChar },
			selection: { anchor: range.from + triggerChar.length },
			userEvent: "input.slash-menu",
		});
		view.focus();
		this.open(view, range.from, selection);
		return true;
	}

	private viewFor(editor: Editor): EditorView | null {
		for (const view of this.views) {
			if (view.state.field(editorInfoField, false)?.editor === editor) return view;
		}
		return null;
	}

	private onUpdate(update: ViewUpdate): void {
		if (this.host.blocked()) { this.close(false); return; }
		const s = this.session;
		if (s && s.view === update.view) {
			this.followSession(s, update);
			return;
		}
		if (!s && this.shouldOpen(update)) {
			const head = update.state.selection.main.head;
			this.open(update.view, head - this.host.store.settings.triggerChar.length, "");
		}
	}

	/** True when this update is the user typing the trigger in a place where it makes sense. */
	private shouldOpen(update: ViewUpdate): boolean {
		if (!update.docChanged || update.view.composing) return false;
		if (!update.transactions.some((tr) => tr.isUserEvent("input.type"))) return false;
		const { triggerChar, triggerAfterSpaceOnly } = this.host.store.settings;
		const state = update.state;
		const sel = state.selection.main;
		if (!sel.empty) return false;

		// The typed text must end with the trigger's last character; the whole trigger
		// (which may be several characters typed one by one) is checked in the document below.
		let typedTrigger = false;
		update.changes.iterChanges((_fa, _ta, _fb, toB, inserted) => {
			if (toB === sel.head && inserted.length > 0 && inserted.toString().endsWith(triggerChar.slice(-1))) typedTrigger = true;
		});
		if (!typedTrigger) return false;

		const from = sel.head - triggerChar.length;
		if (from < 0 || state.sliceDoc(from, sel.head) !== triggerChar) return false;
		if (triggerAfterSpaceOnly) {
			const line = state.doc.lineAt(from);
			const before = state.sliceDoc(line.from, from);
			// Line start, after a space, or after a list/quote marker.
			if (before !== "" && !/\s$/.test(before)) return false;
		}
		return !this.inNoTriggerZone(update.view, from);
	}

	private inNoTriggerZone(view: EditorView, pos: number): boolean {
		try {
			for (let node: { name: string; parent: unknown } | null = syntaxTree(view.state).resolveInner(pos, 1); node; node = node.parent as typeof node) {
				if (NO_TRIGGER_NODE_RE.test(node.name)) return true;
			}
			const line = view.state.doc.lineAt(pos);
			for (let node: { name: string; parent: unknown } | null = syntaxTree(view.state).resolveInner(line.from, 1); node; node = node.parent as typeof node) {
				if (NO_TRIGGER_NODE_RE.test(node.name)) return true;
			}
		} catch {
			// No syntax tree (plain text editor): allow.
		}
		return false;
	}

	private open(view: EditorView, from: number, selection: string): void {
		const settings = this.host.store.settings;
		const hasEditor = !!view.state.field(editorInfoField, false)?.editor;
		const doc = view.dom.ownerDocument;
		const menu = new SlashMenu(
			doc,
			this.host.t,
			() => this.menus.delete(menu),
			{
				showIcons: settings.showIcons,
				showDescriptions: settings.showDescriptions,
				animations: settings.animations && !prefersReducedMotion(doc),
				triggerChar: settings.triggerChar,
			},
			(row) => {
				const s = this.session;
				if (s && s.menu === menu) this.choose(s, row);
			},
		);
		this.menus.add(menu);
		const cache = new Map<string, Availability>();
		const availability = (item: SlashItem) => {
			let a = cache.get(item.id);
			if (!a) cache.set(item.id, (a = this.host.availabilityFor(item, hasEditor)));
			return a;
		};
		const session: Session = { view, from, menu, query: "", selection, availability };
		this.session = session;
		// Layout can only be read outside of an update cycle. The user may type before
		// the measure runs: render the session's latest query at its mapped position.
		view.requestMeasure({
			read: () => this.anchorFor(view, session.from),
			write: (anchor) => {
				if (this.session !== session) return;
				if (!anchor) return this.close(false);
				menu.open(anchor, session.query, this.sections(session, session.query));
			},
		});
	}

	private sections(s: Session, query: string) {
		return buildMenuModel({
			settings: this.host.store.settings,
			index: this.host.getIndex(),
			query,
			availability: s.availability,
			labels: { pinned: this.host.t("menu.section.pinned"), recent: this.host.t("menu.section.recent") },
		});
	}

	private followSession(s: Session, update: ViewUpdate): void {
		if (update.focusChanged && !update.view.hasFocus) {
			this.close();
			return;
		}
		if (!update.docChanged && !update.selectionSet) return;
		const state = update.state;
		const { triggerChar } = this.host.store.settings;
		s.from = update.changes.mapPos(s.from, 1);
		const sel = state.selection.main;
		const start = s.from + triggerChar.length;
		const valid =
			sel.empty &&
			sel.head >= start &&
			state.sliceDoc(s.from, start) === triggerChar &&
			state.doc.lineAt(s.from).number === state.doc.lineAt(sel.head).number &&
			sel.head - start <= MAX_QUERY;
		if (!valid) {
			this.close();
			return;
		}
		const query = state.sliceDoc(start, sel.head);
		if (query === s.query) return;
		// A leading space or a double space means the user is just writing.
		if (/^\s|\s\s$/.test(query)) {
			this.close();
			return;
		}
		s.query = query;
		const sections = this.sections(s, query);
		// Typing a space after a query that matches nothing: the "/" was plain text.
		if (sections.length === 0 && /\s$/.test(query)) {
			this.close();
			return;
		}
		s.menu.update(query, sections);
	}

	private reanchor(view: EditorView): void {
		const s = this.session;
		if (!s || s.view !== view) return;
		view.requestMeasure({
			read: () => this.anchorFor(view, s.from),
			write: (anchor) => {
				if (this.session !== s) return;
				if (!anchor) this.close(false);
				else s.menu.reanchor(anchor);
			},
		});
	}

	private anchorFor(view: EditorView, pos: number): MenuAnchor | null {
		const c = view.coordsAtPos(pos);
		if (!c) return null;
		// Scrolled out of the editor: close instead of floating over something else.
		const box = view.scrollDOM.getBoundingClientRect();
		if (c.bottom < box.top || c.top > box.bottom) return null;
		return { left: c.left, top: c.top, bottom: c.bottom };
	}

	private chooseSelected(s: Session): boolean {
		const row = s.menu.selectedRow();
		if (!row) {
			// Nothing matches: Enter keeps its normal meaning.
			this.close();
			return false;
		}
		this.choose(s, row);
		return true;
	}

	/** Tab: complete the query to the selected entry's name, or run it when already complete. */
	private complete(s: Session): boolean {
		const row = s.menu.selectedRow();
		if (!row) return true;
		if (normalize(s.query) === normalize(row.item.name)) return this.chooseSelected(s);
		const start = s.from + this.host.store.settings.triggerChar.length;
		const head = s.view.state.selection.main.head;
		s.view.dispatch({
			changes: { from: start, to: head, insert: row.item.name },
			selection: { anchor: start + row.item.name.length },
			userEvent: "input.complete",
		});
		return true;
	}

	private escape(s: Session): void {
		this.close();
		if (!s.selection) return;
		// Opened by command over a selection: put the selection back.
		const head = s.view.state.selection.main.head;
		s.view.dispatch({ changes: { from: s.from, to: head, insert: s.selection }, selection: { anchor: s.from, head: s.from + s.selection.length } });
	}

	private choose(s: Session, row: MenuRow): void {
		if (!row.availability.available) {
			s.menu.shake();
			new Notice(row.availability.reason ? `${row.item.name}: ${row.availability.reason}` : this.host.t("menu.unavailable"));
			return;
		}
		this.session = null;
		s.menu.playChosenAndClose();

		// Remove "/query" first; the action then works at a clean cursor. When the menu was
		// opened by command over a selection, put that selection back (selected) instead:
		// Blocks convert its line, commands act on it, and snippets replace it.
		const view = s.view;
		const head = view.state.selection.main.head;
		view.dispatch({
			changes: { from: s.from, to: head, insert: s.selection },
			selection: { anchor: s.from, head: s.from + s.selection.length },
			userEvent: "delete.slash-menu",
		});

		const info = view.state.field(editorInfoField, false);
		const ctx: ActionContext = {
			app: this.host.app,
			host: this.host,
			settings: this.host.store.settings,
			item: row.item,
			editor: info?.editor ?? null,
			cmView: view,
			file: info?.file ?? null,
			selection: s.selection,
		};
		this.host.recordRecent(row.item.id);
		void runItem(ctx);
	}
}

function prefersReducedMotion(doc: Document): boolean {
	try {
		return (doc.defaultView ?? window).matchMedia("(prefers-reduced-motion: reduce)").matches;
	} catch {
		return false;
	}
}
