import { Component, MarkdownRenderer, TFile } from "obsidian";
import type { TasksHub } from "./hub";
import type { Task } from "./types";
import { noteWindow } from "./note-window";

/** Kept across list redraws, but owned by exactly one selected task. */
export class TaskNotePreview extends Component {
	readonly el: HTMLDetailsElement;
	private readonly content: HTMLElement;
	private readonly toggle: HTMLButtonElement;
	private renderer: Component | null = null;
	private timer = 0;
	private generation = 0;
	private stopped = false;
	private whole = false;
	private positioned = false;
	private scroll = 0;
	private currentLine: number;

	constructor(private readonly hub: TasksHub, public task: Task, side: boolean, open: (line: number, event: MouseEvent) => void) {
		super();
		this.currentLine = task.line;
		// Bound: ctx.t reads this.handle.
		const t = (key: string, vars?: Record<string, string | number>) => hub.ctx.t(key, vars);
		this.el = document.createElement("details");
		this.el.className = "sk-tasks-note";
		this.el.open = !side;
		this.el.createEl("summary", { text: t("preview.note") });
		const header = this.el.createDiv({ cls: "sk-tasks-note-header" });
		const name = header.createDiv({ cls: "sk-tasks-note-name" });
		name.createEl("b", { text: task.path.replace(/^.*\//, "").replace(/\.md$/i, "") });
		name.createDiv({ text: task.path.includes("/") ? task.path.slice(0, task.path.lastIndexOf("/")) : "/" });
		header.createEl("button", { cls: "sk-btn is-ghost is-s", text: t("preview.open") })
			.addEventListener("click", (event) => open(this.currentLine, event));
		this.toggle = this.el.createEl("button", { cls: "sk-btn is-ghost is-s", text: t("preview.whole") });
		this.toggle.addEventListener("click", () => {
			this.whole = !this.whole;
			this.positioned = false;
			void this.render();
		});
		this.content = this.el.createDiv({ cls: "sk-tasks-note-content markdown-rendered", attr: { tabindex: "0" } });
		this.el.addEventListener("keydown", (event) => event.stopPropagation());
		this.content.addEventListener("click", (event) => {
			const target = event.target as HTMLElement;
			if (target.closest('input[type="checkbox"], .task-list-item-checkbox')) {
				event.preventDefault();
				event.stopImmediatePropagation();
				return;
			}
			const link = target.closest<HTMLAnchorElement>("a.internal-link");
			if (link) {
				event.preventDefault();
				event.stopPropagation();
				void hub.ctx.app.workspace.openLinkText(link.dataset.href ?? link.getAttribute("href") ?? "", this.task.path, event.ctrlKey || event.metaKey);
			}
		}, true);
		this.el.addEventListener("toggle", () => {
			if (this.el.open) void this.render();
		});
	}

	onload(): void {
		const observer = new MutationObserver(() => {
			this.content.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((box) => { box.disabled = true; });
		});
		observer.observe(this.content, { childList: true, subtree: true });
		this.register(() => observer.disconnect());
		const vault = this.hub.ctx.app.vault;
		this.registerEvent(vault.on("modify", (file) => { if (file.path === this.task.path) this.schedule(); }));
		this.registerEvent(vault.on("delete", (file) => { if (file.path === this.task.path) this.schedule(); }));
		this.registerEvent(vault.on("rename", (_file, old) => { if (old === this.task.path) this.schedule(); }));
		if (this.el.open) void this.render();
	}

	private schedule(): void {
		window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => void this.render(), 200);
	}

	detach(): void {
		this.scroll = this.content.scrollTop;
		this.el.remove();
	}

	mount(parent: HTMLElement, task: Task): void {
		const changed = task.raw !== this.task.raw || task.line !== this.task.line;
		this.task = task;
		parent.append(this.el);
		this.content.scrollTop = this.scroll;
		if (changed) this.schedule();
	}

	private async render(): Promise<void> {
		if (this.stopped || !this.el.open) return;
		const generation = ++this.generation;
		const app = this.hub.ctx.app;
		let owner: Component | null = null;
		try {
			const file = app.vault.getAbstractFileByPath(this.task.path);
			if (!(file instanceof TFile)) throw new Error("Missing note");
			const text = await app.vault.cachedRead(file);
			if (this.stopped || generation !== this.generation) return;
			const excerpt = noteWindow(text, this.task, this.whole);
			this.currentLine = excerpt.line >= 0 ? excerpt.line : this.task.line;
			owner = this.addChild(new Component());
			const rendered = this.content.doc.createElement("div");
			await MarkdownRenderer.render(app, excerpt.markdown, rendered, file.path, owner);
			if (this.stopped || generation !== this.generation) { this.removeChild(owner); return; }
			if (this.renderer) this.removeChild(this.renderer);
			this.renderer = owner;
			const scroll = this.content.scrollTop;
			rendered.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((box) => { box.disabled = true; });
			this.content.replaceChildren(rendered);
			this.toggle.hidden = !this.whole && !excerpt.truncated;
			this.toggle.setText(this.hub.ctx.t(this.whole ? "preview.excerpt" : "preview.whole"));
			this.toggle.setAttribute("aria-pressed", String(this.whole));
			const anchor = rendered.querySelector<HTMLElement>(".sk-tasks-note-anchor");
			const target = anchor?.closest("li") ?? anchor;
			target?.classList.add("sk-tasks-note-highlight");
			this.content.scrollTop = this.positioned ? scroll : target
				? target.getBoundingClientRect().top - this.content.getBoundingClientRect().top + this.content.scrollTop - this.content.clientHeight / 3 : 0;
			this.positioned = true;
			this.scroll = this.content.scrollTop;
		} catch {
			if (owner) this.removeChild(owner);
			if (!this.stopped && generation === this.generation) {
				if (this.renderer) this.removeChild(this.renderer);
				this.renderer = null;
				this.content.setText(this.hub.ctx.t("preview.unavailable"));
			}
		}
	}

	onunload(): void {
		this.stopped = true;
		this.generation++;
		window.clearTimeout(this.timer);
		this.el.remove();
	}
}
