// The New note window: a name, and the parent the note goes under, chosen on the Map, with a
// few options folded away (a link from the parent, a template, what to do next), kept from one
// note to the next. Opened by Home's New note button, "New note here" on the Map, the "New note"
// command, and Ctrl+N when the user asks for it. The name is checked as it is typed: no
// character a file or a link cannot hold, and no second note of the same name (that one opens
// instead). From a note, a selected text becomes the name, then a link to the new note.
// The pure parts are in logic/new-note.ts.
import { MarkdownView, Modal, moment, Platform, Setting, setIcon, TFile, TFolder, type Editor, type EditorPosition } from "obsidian";
import { parentKeyIn, parentLink, parentValue } from "../../core/places/move";
import { mountMap, type MapHandle, type MapStrings } from "../../ui/map";
import { mapStateAt, VAULT_ROOT } from "./logic/map";
import { cleanNoteName, freeNotePath } from "./logic/moves";
import { appendLine, defaultParent, fillTemplate, folderOf, linkAlias, nameFromSelection, nameProblem, sameName, type NameProblem } from "./logic/new-note";
import type { HomeRuntime } from "./runtime";

export interface NewNoteRequest {
	/** Where it was opened: Home (its button, its Map) or anywhere else (the command, Ctrl+N). */
	from: "home" | "command";
	/** A parent already chosen ("New note here" on the Map). */
	parent?: string | null;
	/** Opens a note the caller's way (Home: next to the Workbench); `tab`: in a new tab. */
	open?(path: string, tab: boolean): void;
	/** The note exists and was not opened (Home shows it on its Map); `from`: where its name was typed. */
	created?(path: string, from: DOMRect | null): void;
}

/** The text selected in a note when the window opened: it becomes a link to the new note. */
interface TextSelection {
	view: MarkdownView;
	editor: Editor;
	path: string;
	from: EditorPosition;
	to: EditorPosition;
	text: string;
}

/** What Create was asked for, read once when it is pressed (the window may change while writing). */
interface Choice {
	name: string;
	parent: string | null;
	template: TFile | null;
	link: boolean;
	open: boolean;
	tab: boolean;
}

interface InternalPlugins {
	getPluginById?(id: string): { enabled?: boolean; instance?: { options?: Record<string, unknown> } } | null;
}

export class NewNoteModal extends Modal {
	/** The window open now: a second Ctrl+N brings the focus back to it instead of opening another. */
	static current: NewNoteModal | null = null;
	private parentPath: string | null = null;
	private readonly activePath: string | null;
	private readonly textSel: TextSelection | null;
	private mapHandle: MapHandle | null = null;
	private nameInput!: HTMLInputElement;
	private messageEl!: HTMLElement;
	private whereEl!: HTMLElement;
	private createBtn!: HTMLButtonElement;
	private linkRow: Setting | null = null;
	private writing = false;
	/** The note of the same name, when there is one: the main button opens it. */
	private existingPath: string | null = null;

	constructor(
		private readonly rt: HomeRuntime,
		private readonly request: NewNoteRequest,
	) {
		super(rt.app);
		const app = rt.app;
		const view = request.from === "command" ? app.workspace.getActiveViewOfType(MarkdownView) : null;
		const file = request.from === "command" ? app.workspace.getActiveFile() : null;
		this.activePath = file && file.extension === "md" ? file.path : null;
		this.textSel = null;
		const editor = view?.getMode() === "source" ? view.editor : null;
		if (editor && view?.file && editor.somethingSelected()) {
			const text = editor.getSelection();
			if (nameFromSelection(text)) this.textSel = { view, editor, path: view.file.path, from: editor.getCursor("from"), to: editor.getCursor("to"), text };
		}
	}

	/** The Home runtime that opened it (closed with it when Home stops). */
	get owner(): HomeRuntime {
		return this.rt;
	}

	private t(key: string, vars?: Record<string, string | number>): string {
		return this.rt.t(key, vars);
	}

	/** Closed while writing (Escape, Home stopping): it closes once the note is written. */
	private closeLater = false;

	close(): void {
		if (this.writing) {
			this.closeLater = true;
			return;
		}
		super.close();
	}

	open(): void {
		const current = NewNoteModal.current;
		if (current) {
			current.nameInput?.focus();
			return;
		}
		NewNoteModal.current = this;
		super.open();
	}

	onOpen(): void {
		try {
			this.draw();
		} catch (error) {
			console.error("[Snailkit] home: the New note window could not open", error);
			this.close();
		}
	}

	private draw(): void {
		const { rt, contentEl } = this;
		this.modalEl.addClass("sk-home-newnote");
		this.titleEl.setText(this.t("newnote.title"));
		const world = rt.world;
		const parent = defaultParent(
			{
				exists: (path) => world.exists(path),
				hasChildren: (path) => world.hasChildren(path),
				parent: (path) => world.parent(path),
				isDomain: (path) => rt.domainSet().has(path),
			},
			{ given: this.request.parent ?? null, active: this.activePath, last: rt.settings.newNoteParent, home: world.home() },
		);
		this.parentPath = parent && rt.mapSource.node(parent) ? parent : null;

		this.nameInput = contentEl.createEl("input", {
			cls: "sk-home-newnote-name",
			attr: { type: "text", spellcheck: "false", placeholder: this.t("map.untitled"), "aria-label": this.t("map.name-label") },
		});
		if (this.textSel) this.nameInput.value = nameFromSelection(this.textSel.text) ?? "";
		this.messageEl = contentEl.createDiv({ cls: "sk-home-newnote-msg", attr: { role: "status", "aria-live": "polite" } });
		this.messageEl.id = `sk-home-newnote-msg-${Date.now()}`;
		this.nameInput.setAttr("aria-describedby", this.messageEl.id);

		const line = contentEl.createDiv({ cls: "sk-home-newnote-where" });
		this.whereEl = line.createDiv({ cls: "sk-home-newnote-path" });
		const hint = line.createDiv({ cls: "sk-home-newnote-hint" });
		const box = contentEl.createDiv({ cls: "sk-home-newnote-map" });
		this.mountMap(box);
		hint.setText(this.t(box.querySelector(".sk-map-stage.is-tree") ? "newnote.hint-touch" : "newnote.hint"));

		const options = contentEl.createDiv({ cls: "sk-home-newnote-opts" });
		options.hidden = true;
		this.drawOptions(options);

		const foot = contentEl.createDiv({ cls: "sk-home-newnote-foot" });
		const more = foot.createEl("button", { cls: "sk-btn is-ghost is-s sk-home-newnote-more", attr: { type: "button", "aria-expanded": "false" } });
		more.createSpan({ text: this.t("newnote.more") });
		setIcon(more.createSpan({ cls: "sk-home-newnote-chev" }), "chevron-down");
		more.addEventListener("click", () => {
			options.hidden = !options.hidden;
			more.setAttr("aria-expanded", String(!options.hidden));
			more.toggleClass("is-open", !options.hidden);
		});
		foot.createSpan({ cls: "sk-home-newnote-gap" });
		const cancel = foot.createEl("button", { cls: "sk-btn is-ghost", text: this.t("common.cancel"), attr: { type: "button" } });
		cancel.addEventListener("click", () => this.close());
		this.createBtn = foot.createEl("button", { cls: "sk-btn is-primary", attr: { type: "button" } });
		this.createBtn.addEventListener("click", (event) => void this.submit(event.ctrlKey || event.metaKey));

		this.nameInput.addEventListener("input", () => this.check());
		this.nameInput.addEventListener("keydown", (event) => {
			if (event.isComposing) return;
			if (event.key === "Enter") {
				event.preventDefault();
				void this.submit(event.ctrlKey || event.metaKey);
			} else if (event.key === "ArrowDown" && this.mapHandle) {
				event.preventDefault();
				this.mapHandle.focus();
			}
		});
		// Ctrl+Enter anywhere else in the window (the Map keeps Enter to choose).
		this.modalEl.addEventListener("keydown", (event) => {
			if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing && event.target !== this.nameInput && !(event.target as Element).closest?.(".sk-home-newnote-map")) {
				event.preventDefault();
				void this.submit(true);
			}
		});
		this.showWhere();
		this.check();
		this.nameInput.win.setTimeout(() => {
			this.nameInput.focus();
			const end = this.nameInput.value.length;
			this.nameInput.setSelectionRange(end, end);
		}, 0);
	}

	onClose(): void {
		if (NewNoteModal.current === this) NewNoteModal.current = null;
		try {
			this.mapHandle?.destroy();
		} catch (error) {
			console.error("[Snailkit] home: map cleanup failed", error);
		}
		this.mapHandle = null;
		this.contentEl.empty();
	}

	// ----- where the note goes -----

	private mapStrings(): MapStrings {
		return {
			more: (count) => this.rt.tn("map.more", count),
			moreLabel: (count, name) => this.t("map.more-label", { count, name }),
			recenter: this.t("map.recenter"),
			recenterTip: this.t("map.recenter-tip"),
			tree: this.t("newnote.map"),
			breadcrumbs: this.t("map.breadcrumbs"),
			back: this.t("map.back"),
			open: this.t("newnote.choose"),
		};
	}

	/** The Map of Home, to choose the parent: hover unfolds, a click chooses. */
	private mountMap(box: HTMLElement): void {
		const source = this.rt.mapSource;
		source.invalidate();
		const home = source.home();
		// The chosen parent has the cursor: ↓ from the name goes to it.
		const state = { ...mapStateAt(source, home, this.parentPath), focus: this.parentPath };
		try {
			this.mapHandle = mountMap(
				box,
				{ source, home, state, current: this.activePath, strings: this.mapStrings(), icon: (el, icon) => setIcon(el, icon), mode: "auto", picked: this.parentPath, openIcon: "check" },
				{
					open: (id) => this.choose(id),
					openPage: () => undefined,
					pin: () => undefined,
					menu: () => undefined,
					escape: () => this.nameInput.focus(),
				},
			);
			if (this.parentPath) this.mapHandle.reveal(this.parentPath);
		} catch (error) {
			console.error("[Snailkit] home: the map could not open", error);
			this.mapHandle = null;
		}
	}

	private choose(id: string): void {
		this.parentPath = id === VAULT_ROOT ? null : id;
		this.mapHandle?.pick(this.parentPath);
		this.showWhere();
		this.whereEl.removeClass("is-new");
		void this.whereEl.offsetWidth;
		this.whereEl.addClass("is-new");
	}

	/** "In Home › Domain › Parent", the chosen parent last, in bold. */
	private showWhere(): void {
		const el = this.whereEl;
		el.empty();
		const source = this.rt.mapSource;
		if (!this.parentPath) {
			el.createSpan({ cls: "sk-home-newnote-none", text: this.t("newnote.no-parent") });
			this.linkRow?.settingEl.toggleClass("sk-home-off", true);
			return;
		}
		const chain: string[] = [];
		const seen = new Set<string>();
		for (let id: string | null = this.parentPath; id && id !== VAULT_ROOT && !seen.has(id); id = source.parent(id)) {
			seen.add(id);
			chain.unshift(id);
		}
		el.createSpan({ cls: "sk-home-newnote-in", text: this.t("newnote.in") });
		chain.forEach((id, i) => {
			if (i) setIcon(el.createSpan({ cls: "sk-home-newnote-sep", attr: { "aria-hidden": "true" } }), "chevron-right");
			el.createSpan({ cls: i === chain.length - 1 ? "sk-home-newnote-parent" : "", text: source.node(id)?.label ?? this.rt.world.name(id) });
		});
		if (this.linkRow) {
			this.linkRow.settingEl.toggleClass("sk-home-off", false);
			this.linkRow.setDesc(this.t("newnote.link-desc", { parent: this.rt.world.name(this.parentPath) }));
		}
	}

	// ----- the options, folded away -----

	private drawOptions(el: HTMLElement): void {
		const rt = this.rt;
		const s = rt.settings;
		const save = () => void rt.ctx.saveSettings();
		this.linkRow = new Setting(el)
			.setName(this.t("newnote.link"))
			.setDesc(this.t("newnote.link-desc", { parent: this.parentPath ? rt.world.name(this.parentPath) : "" }))
			.addToggle((toggle) =>
				toggle.setValue(s.newNoteLink).onChange((value) => {
					s.newNoteLink = value;
					save();
				}),
			);
		const templates = this.templates();
		if (templates.length) {
			const chosen = this.template(templates)?.path ?? "";
			new Setting(el).setName(this.t("newnote.template")).addDropdown((dropdown) => {
				dropdown.addOption("", this.t("newnote.template-none"));
				for (const file of templates) dropdown.addOption(file.path, file.basename);
				dropdown.setValue(chosen).onChange((value) => {
					s.newNoteTemplate = value;
					save();
				});
			});
		}
		new Setting(el).setName(this.t("newnote.then")).addDropdown((dropdown) =>
			dropdown
				.addOption("open", this.t("newnote.then-open"))
				.addOption("stay", this.t("newnote.then-stay"))
				.setValue(s.newNoteThen === "stay" ? "stay" : "open")
				.onChange((value) => {
					s.newNoteThen = value === "stay" ? "stay" : "open";
					save();
				}),
		);
	}

	/** The notes of the template folders: the core Templates plugin's (when on) and Templater's. */
	private templates(): TFile[] {
		const app = this.app;
		const folders: string[] = [];
		try {
			const core = (app as unknown as { internalPlugins?: InternalPlugins }).internalPlugins?.getPluginById?.("templates");
			const folder = core?.enabled ? core.instance?.options?.folder : null;
			if (typeof folder === "string" && folder.trim()) folders.push(folder.trim());
			const templater = (app as unknown as { plugins?: { plugins?: Record<string, { settings?: { templates_folder?: unknown } }> } }).plugins?.plugins?.["templater-obsidian"];
			const own = templater?.settings?.templates_folder;
			if (typeof own === "string" && own.trim()) folders.push(own.trim());
		} catch {
			/* no template folder known */
		}
		const out = new Map<string, TFile>();
		for (const raw of folders) {
			const folder = app.vault.getAbstractFileByPath(raw.replace(/^\/+|\/+$/g, ""));
			if (!(folder instanceof TFolder)) continue;
			const walk = (f: TFolder) => {
				for (const child of f.children) {
					if (child instanceof TFolder) walk(child);
					else if (child instanceof TFile && child.extension === "md") out.set(child.path, child);
				}
			};
			walk(folder);
		}
		return [...out.values()].sort((a, b) => a.basename.localeCompare(b.basename));
	}

	/** The template kept in the settings, when it is still one of the templates offered. */
	private template(templates = this.templates()): TFile | null {
		const saved = this.rt.settings.newNoteTemplate;
		return saved ? templates.find((f) => f.path === saved) ?? null : null;
	}

	/** Date and time formats of the core Templates plugin. */
	private templateFormats(): { dateFormat: string; timeFormat: string } {
		try {
			const options = (this.app as unknown as { internalPlugins?: InternalPlugins }).internalPlugins?.getPluginById?.("templates")?.instance?.options;
			return {
				dateFormat: typeof options?.dateFormat === "string" ? options.dateFormat : "",
				timeFormat: typeof options?.timeFormat === "string" ? options.timeFormat : "",
			};
		} catch {
			return { dateFormat: "", timeFormat: "" };
		}
	}

	// ----- the name, checked as it is typed -----

	/** What is wrong with the name, the characters shown as keys ("cannot hold : # ?" reads badly). */
	private showProblem(problem: NameProblem): void {
		const el = this.messageEl;
		if (problem.kind !== "chars") {
			el.setText(this.t(problem.kind === "dot-start" ? "newnote.dot-start" : "newnote.dot-end"));
			return;
		}
		const [before, after = ""] = this.t("newnote.bad-chars", { chars: "\u0000" }).split("\u0000");
		el.appendText(before);
		problem.chars.forEach((char, i) => {
			if (i) el.appendText(" ");
			el.createEl("kbd", { text: char });
		});
		el.appendText(after);
	}

	private check(): void {
		const raw = this.nameInput.value;
		const problem = nameProblem(raw);
		const same = problem ? [] : sameName(raw, this.app.vault.getMarkdownFiles());
		this.existingPath = same[0] ?? null;
		this.messageEl.empty();
		this.messageEl.toggleClass("is-error", !!problem);
		this.nameInput.toggleClass("is-invalid", !!problem);
		this.nameInput.setAttr("aria-invalid", problem ? "true" : "false");
		if (problem) this.showProblem(problem);
		else if (this.existingPath) {
			const folder = folderOf(this.existingPath);
			this.messageEl.setText(folder ? this.t("newnote.exists", { folder }) : this.t("newnote.exists-root"));
		}
		this.createBtn.empty();
		this.createBtn.disabled = !!problem;
		this.createBtn.createSpan({ text: this.t(this.existingPath ? "newnote.open-it" : "newnote.create") });
		if (!Platform.isMobile) this.createBtn.createEl("kbd", { text: "↵" });
	}

	// ----- creating -----

	private async submit(tab: boolean): Promise<void> {
		if (this.writing) return;
		this.check();
		if (this.createBtn.disabled) {
			this.nameInput.focus();
			return;
		}
		if (this.existingPath) {
			const path = this.existingPath;
			this.close();
			this.openNote(path, tab, false);
			return;
		}
		const rt = this.rt;
		const choice: Choice = {
			name: this.nameInput.value.trim(),
			parent: this.parentPath,
			template: this.template(),
			link: rt.settings.newNoteLink,
			open: tab || rt.settings.newNoteThen !== "stay",
			tab,
		};
		const from = this.nameInput.getBoundingClientRect();
		this.setWriting(true);
		let written: { file: TFile; upFailed: boolean } | null = null;
		try {
			written = await this.write(choice);
		} catch (error) {
			console.error("[Snailkit] home: could not create the note", error);
		}
		this.setWriting(false);
		// Home stopped meanwhile: the note stays as written, nothing more.
		if (rt.stopped) {
			this.close();
			return;
		}
		if (!written) {
			rt.ctx.toast(this.t("toast.create-failed"));
			if (this.closeLater) this.close();
			else this.nameInput.focus();
			return;
		}
		const { file, upFailed } = written;
		if (choice.parent && rt.settings.newNoteParent !== choice.parent) {
			rt.settings.newNoteParent = choice.parent;
			void rt.ctx.saveSettings();
		}
		const cancelled = this.closeLater;
		this.close();
		const name = file.basename;
		const path = file.path;
		if (upFailed) rt.ctx.toast(this.t("newnote.no-up", { name }));
		// Escape while it was being written: the note is there, not opened.
		if (choice.open && !cancelled) {
			this.openNote(path, choice.tab, !choice.name);
			return;
		}
		if (!upFailed) {
			const parent = choice.parent ? rt.world.name(choice.parent) : "";
			rt.ctx.toast(parent ? this.t("newnote.toast-under", { name, parent }) : this.t("newnote.toast", { name }), {
				action: { label: this.t("newnote.open"), run: () => this.openNote(path, false, false) },
			});
		}
		if (!cancelled) this.request.created?.(path, from);
	}

	/** While writing: nothing in the window can change. */
	private setWriting(on: boolean): void {
		this.writing = on;
		this.nameInput.disabled = on;
		this.createBtn.disabled = on;
		this.contentEl.toggleClass("is-writing", on);
	}

	/**
	 * The note written: its parent in its properties, the template, the selection linked, the link
	 * in the parent. `upFailed`: the note exists but its template's properties could not take the
	 * parent (invalid YAML).
	 */
	private async write(choice: Choice): Promise<{ file: TFile; upFailed: boolean } | null> {
		const app = this.app;
		const parent = choice.parent ? app.vault.getFileByPath(choice.parent) : null;
		const folder = parent ? parent.parent?.path ?? "" : app.fileManager.getNewFileParent(this.activePath ?? "").path;
		const prefix = folder && folder !== "/" ? `${folder}/` : "";
		const taken = (p: string) => !!(app.vault.getAbstractFileByPath(p) ?? (app.vault as unknown as { getAbstractFileByPathInsensitive?(p: string): unknown }).getAbstractFileByPathInsensitive?.(p));
		const path = choice.name ? `${prefix}${choice.name}.md` : freeNotePath(folder, cleanNoteName(this.t("map.untitled")) || "Untitled", taken);
		if (taken(path)) return null;
		const link = parent ? parentLink(app, path, parent) : null;
		let file: TFile;
		let upFailed = false;
		if (choice.template) {
			const formats = this.templateFormats();
			const title = path.replace(/^.*\//, "").replace(/\.md$/, "");
			const text = fillTemplate(await app.vault.read(choice.template), { title, ...formats, format: (pattern) => moment().format(pattern) });
			file = await app.vault.create(path, text);
			if (link) {
				try {
					await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
						const key = parentKeyIn(fm);
						fm[key] = parentValue(fm[key], link);
					});
				} catch (error) {
					console.error("[Snailkit] home: could not write the parent of the new note", error);
					upFailed = true;
				}
			}
		} else {
			const content = link ? `---\nup: "${link.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"\n---\n` : "";
			file = await app.vault.create(path, content);
		}
		// The selected text becomes a link to the note: only while its note is still the one in that
		// editor and the text is still there, unchanged; the spaces around it stay outside the link.
		const sel = this.textSel;
		if (sel && !this.rt.stopped && sel.view.file?.path === sel.path && sel.view.editor === sel.editor && sel.editor.getRange(sel.from, sel.to) === sel.text) {
			const alias = linkAlias(sel.text, file.basename);
			const link = app.fileManager.generateMarkdownLink(file, sel.path, undefined, alias ?? undefined);
			const [, lead, trail] = /^(\s*)[\s\S]*?(\s*)$/.exec(sel.text) ?? ["", "", ""];
			sel.editor.replaceRange(lead + link + trail, sel.from, sel.to);
		}
		if (parent && choice.link && !this.rt.stopped) {
			try {
				const line = `- ${app.fileManager.generateMarkdownLink(file, parent.path)}`;
				await app.vault.process(parent, (text) => appendLine(text, line));
			} catch (error) {
				console.error("[Snailkit] home: could not link the note from its parent", error);
			}
		}
		return { file, upFailed };
	}

	/** Opens a note: the caller's way, else like Obsidian's own "Create new note" (a new tab). */
	private openNote(path: string, tab: boolean, rename: boolean): void {
		if (this.request.open) {
			this.request.open(path, tab);
			return;
		}
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		void this.app.workspace
			.getLeaf("tab")
			.openFile(file, { active: true, state: { mode: "source" }, eState: rename ? { rename: "all" } : undefined })
			.catch((error: unknown) => console.error("[Snailkit] home: could not open the note", error));
	}
}
