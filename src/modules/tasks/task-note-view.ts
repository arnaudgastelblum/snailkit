// The "Note" of a task in its details: its task note (task-note.ts), rendered, written in Markdown
// right there with a click, opened as a real note with the arrow (for long texts and images).
// Without a note, an empty area: the note is created as soon as something is written. Pasting an
// image saves it as an attachment of the note. Kept across list redraws, owned by one task.
import { Component, MarkdownRenderer, TFile, setIcon } from "obsidian";
import { moment } from "../../core/moment";
import type { TasksHub } from "./hub";
import type { Task, TaskNotesService } from "./types";

const SAVE_MS = 900;

export class TaskNoteView extends Component {
	readonly el: HTMLElement;
	private readonly openBtn: HTMLButtonElement;
	private readonly content: HTMLElement;
	private renderer: Component | null = null;
	private area: HTMLTextAreaElement | null = null;
	private saveTimer = 0;
	private renderTimer = 0;
	private generation = 0;
	private saving: Promise<void> = Promise.resolve();
	/** Saves what the area holds when it changed (set while editing). */
	private flush: (() => Promise<void>) | null = null;
	private stopped = false;

	constructor(
		private readonly hub: TasksHub,
		private readonly notes: TaskNotesService,
		public task: Task,
	) {
		super();
		const t = (key: string, vars?: Record<string, string | number>) => hub.ctx.t(key, vars);
		this.el = createDiv({ cls: "sk-tasks-tnote" });
		const head = this.el.createDiv({ cls: "sk-tasks-sec-head sk-tasks-tnote-head" });
		setIcon(head.createSpan({ cls: "sk-tasks-tnote-icon" }), "notebook-pen");
		head.createSpan({ text: t("note.title") });
		this.openBtn = head.createEl("button", { cls: "sk-btn is-ghost is-s sk-tasks-tnote-open", attr: { type: "button" } });
		setIcon(this.openBtn.createSpan(), "arrow-up-right");
		this.openBtn.createSpan({ text: t("note.open") });
		this.openBtn.addEventListener("click", (event) => void this.openNote(event));
		this.content = this.el.createDiv({ cls: "sk-tasks-tnote-body" });
		this.el.addEventListener("keydown", (event) => event.stopPropagation());
	}

	private t(key: string, vars?: Record<string, string | number>): string {
		return this.hub.ctx.t(key, vars);
	}

	onload(): void {
		const vault = this.hub.ctx.app.vault;
		this.registerEvent(vault.on("modify", (file) => {
			if (!this.area && file.path === this.notes.file(this.task)?.path) this.scheduleRender();
		}));
		void this.render();
	}

	/** Puts the view in `parent` for this task (a redraw of the details). */
	mount(parent: HTMLElement, task: Task): void {
		const changed = task.noteLink !== this.task.noteLink || task.path !== this.task.path;
		this.task = task;
		parent.append(this.el);
		if (changed && !this.area) this.scheduleRender();
	}

	detach(): void {
		this.el.remove();
	}

	private scheduleRender(): void {
		window.clearTimeout(this.renderTimer);
		this.renderTimer = window.setTimeout(() => void this.render(), 150);
	}

	/** Shows the note rendered, or the empty area when the task has none. */
	private async render(): Promise<void> {
		if (this.stopped || this.area) return;
		const generation = ++this.generation;
		const file = this.notes.file(this.task);
		this.openBtn.toggleClass("is-hidden", !file);
		const body = file ? await this.notes.read(this.task) : null;
		if (this.stopped || generation !== this.generation || this.area) return;
		if (!file || !body?.trim()) {
			this.clearRenderer();
			this.edit(body ?? "", false);
			return;
		}
		const owner = this.addChild(new Component());
		const rendered = createDiv({ cls: "sk-tasks-tnote-rendered markdown-rendered", attr: { tabindex: "0", role: "button", "aria-label": this.t("note.edit") } });
		await MarkdownRenderer.render(this.hub.ctx.app, body, rendered, file.path, owner);
		if (this.stopped || generation !== this.generation || this.area) {
			this.removeChild(owner);
			return;
		}
		this.clearRenderer();
		this.renderer = owner;
		rendered.addEventListener("click", (event) => {
			const target = event.target as HTMLElement;
			const link = target.closest<HTMLAnchorElement>("a.internal-link, a.external-link");
			if (link) {
				if (link.hasClass("internal-link")) {
					event.preventDefault();
					void this.hub.ctx.app.workspace.openLinkText(link.dataset.href ?? link.getAttribute("href") ?? "", file.path, event.ctrlKey || event.metaKey);
				}
				return;
			}
			if (target.closest('input[type="checkbox"]')) {
				event.preventDefault();
				return;
			}
			this.edit(body, true);
		});
		rendered.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				this.edit(body, true);
			}
		});
		this.content.replaceChildren(rendered);
	}

	private clearRenderer(): void {
		if (this.renderer) this.removeChild(this.renderer);
		this.renderer = null;
	}

	/**
	 * The Markdown of the note in a text area that grows with it. Saved a moment after typing
	 * stops and when leaving; Esc (or leaving) shows the note rendered again.
	 */
	private edit(body: string, focus: boolean): void {
		const area = createEl("textarea", { cls: "sk-tasks-tnote-area", attr: { spellcheck: "true", placeholder: this.t("note.placeholder"), "aria-label": this.t("note.title") } });
		area.value = body;
		this.area = area;
		this.content.replaceChildren(area);
		const fit = () => {
			area.setCssProps({ "--sk-tasks-tnote-h": "auto" });
			area.setCssProps({ "--sk-tasks-tnote-h": `${Math.max(area.scrollHeight + 2, 64)}px` });
		};
		let saved = body;
		const save = () => {
			window.clearTimeout(this.saveTimer);
			const value = area.value;
			if (value === saved) return this.saving;
			saved = value;
			this.saving = this.saving.then(() => this.notes.write(this.hub.index.get(this.task.key) ?? this.task, value)).catch((error) => {
				console.error("[Snailkit] tasks: the task note could not be saved", error);
				this.hub.ctx.toast(this.t("note.save-failed"));
			});
			return this.saving;
		};
		this.flush = save;
		const leave = () => {
			void save().then(() => {
				if (this.area !== area || this.stopped) return;
				// An empty area stays an area: there is nothing to render.
				if (!area.value.trim()) return;
				this.area = null;
				this.flush = null;
				void this.render();
			});
		};
		area.addEventListener("input", () => {
			fit();
			window.clearTimeout(this.saveTimer);
			this.saveTimer = window.setTimeout(() => void save(), SAVE_MS);
		});
		area.addEventListener("blur", () => {
			if (this.area === area) leave();
		});
		area.addEventListener("keydown", (event) => {
			if (event.key === "Escape" || (event.key === "Enter" && (event.ctrlKey || event.metaKey))) {
				event.preventDefault();
				area.blur();
			}
		});
		area.addEventListener("paste", (event) => void this.pasteImages(event, area, save));
		window.requestAnimationFrame(fit);
		if (focus) {
			area.focus();
			area.setSelectionRange(area.value.length, area.value.length);
		}
	}

	/** An image pasted in the area becomes an attachment of the note, embedded where the cursor is. */
	private async pasteImages(event: ClipboardEvent, area: HTMLTextAreaElement, save: () => Promise<void>): Promise<void> {
		const images = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
		if (!images.length) return;
		event.preventDefault();
		const app = this.hub.ctx.app;
		// The note must exist to hold its attachments.
		if (!this.notes.file(this.task)) {
			if (!area.value.trim()) area.value = " ";
			await save();
			await this.waitForNote();
		}
		const note = this.notes.file(this.task);
		if (!note) return;
		const embeds: string[] = [];
		for (const image of images) {
			const ext = image.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
			const stamp = moment().format("YYYYMMDDHHmmss");
			const path = await app.fileManager.getAvailablePathForAttachment(`Pasted image ${stamp}.${ext}`, note.path);
			const file = await app.vault.createBinary(path, await image.arrayBuffer());
			embeds.push(`![[${app.metadataCache.fileToLinktext(file, note.path)}]]`);
		}
		const start = area.selectionStart ?? area.value.length;
		const end = area.selectionEnd ?? start;
		area.setRangeText(embeds.join("\n"), start, end, "end");
		area.dispatchEvent(new Event("input"));
	}

	/** The index sees the new 📝 link a moment after the note is created. */
	private async waitForNote(): Promise<void> {
		for (let i = 0; i < 20 && !this.notes.file(this.task); i++) {
			await new Promise((resolve) => window.setTimeout(resolve, 100));
			const fresh = this.hub.index.get(this.task.key);
			if (fresh) this.task = fresh;
		}
	}

	private async openNote(event: MouseEvent): Promise<void> {
		await this.saving;
		const file = this.notes.file(this.task);
		if (file instanceof TFile) await this.hub.ctx.app.workspace.getLeaf(event.ctrlKey || event.metaKey ? "split" : "tab").openFile(file);
	}

	onunload(): void {
		this.stopped = true;
		this.generation++;
		window.clearTimeout(this.renderTimer);
		// What was typed is saved even when the details go away.
		void this.flush?.();
		this.flush = null;
		this.el.remove();
	}
}
