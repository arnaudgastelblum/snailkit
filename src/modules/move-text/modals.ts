// Destination and title dialogs for the three move actions.
import { Modal, SuggestModal, type TFile } from "obsidian";
import { newNotePath } from "./logic";
import type { Context, ExtractTarget, AppendTarget } from "./types";

// Pick the destination of an extraction: create a new sub-note (typed text
// becomes its title) or append to an existing one.
export class ExtractTargetModal extends SuggestModal<ExtractTarget> {
	constructor(private readonly ctx: Context, private readonly prefix: string, private readonly proposedTitle: string, private readonly existing: TFile[], private readonly onChooseCb: (item: ExtractTarget) => void) {
		super(ctx.app);
		ctx.register(() => this.close());
		// Default SuggestModal cap is 100: with many sub-notes the "append to"
		// entries would be silently truncated.
		this.limit = 1000;
		this.setPlaceholder(
			proposedTitle
				? ctx.t("modal.suggested", { title: proposedTitle })
				: ctx.t("modal.subnote")
		);
	}

	composeName(title: string) {
		if (!title) return "";
		if (this.prefix && !title.startsWith(this.prefix)) {
			return this.prefix + title;
		}
		return title;
	}

	getSuggestions(query: string) {
		const q = query.trim();
		const items: ExtractTarget[] = [];
		const name = this.composeName(q || this.proposedTitle);
		if (name) items.push({ type: "create", name });
		const lq = q.toLowerCase();
		for (const f of this.existing) {
			if (!lq || f.basename.toLowerCase().includes(lq)) {
				items.push({ type: "append", file: f });
			}
		}
		return items;
	}

	renderSuggestion(item: ExtractTarget, el: HTMLElement) {
		if (item.type === "create") {
			el.createEl("div", { text: this.ctx.t("modal.create", { name: item.name }) });
		} else {
			el.createEl("div", { text: this.ctx.t("modal.append", { name: item.file.basename }) });
		}
	}

	onChooseSuggestion(item: ExtractTarget) {
		this.onChooseCb(item);
	}
}

// Pick any note to append to. The checkbox (or Alt+K) keeps the text in the
// origin note; unchecked by default, so the text is moved.
export class AppendTargetModal extends SuggestModal<AppendTarget> {
	private keep = false;
	private keepBox?: HTMLInputElement;
	private readonly files: TFile[];
	constructor(private readonly ctx: Context, private readonly originFile: TFile, private readonly onChooseCb: (item: AppendTarget, keep: boolean) => void) {
		super(ctx.app);
		ctx.register(() => this.close());
		this.keep = false;
		this.limit = 50;
		this.setPlaceholder(ctx.t("modal.destination"));
		this.setInstructions([
			{ command: "↑↓", purpose: ctx.t("modal.navigate") },
			{ command: "↵", purpose: ctx.t("modal.submit") },
			{ command: "alt k", purpose: ctx.t("modal.keep-shortcut") },
			{ command: "esc", purpose: ctx.t("common.cancel") },
		]);
		// Recently opened notes first, then the rest alphabetically.
		const recent = ctx.app.workspace.getLastOpenFiles();
		const rank = (f: TFile) => {
			const i = recent.indexOf(f.path);
			return i === -1 ? Infinity : i;
		};
		this.files = ctx.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path !== originFile.path)
			.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
		this.scope.register(["Alt"], "k", () => {
			this.setKeep(!this.keep);
			return false;
		});
	}

	onOpen() {
		super.onOpen();
		const row = createEl("label", { cls: "sk-move-text-keep-row" });
		this.keepBox = row.createEl("input", { type: "checkbox" });
		row.createSpan({ text: this.ctx.t("modal.keep") });
		this.keepBox.checked = this.keep;
		this.keepBox.addEventListener("change", () => {
			this.setKeep(this.keepBox!.checked);
			this.inputEl.focus();
		});
		this.modalEl.insertBefore(row, this.resultContainerEl);
	}

	setKeep(value: boolean) {
		this.keep = value;
		if (this.keepBox) this.keepBox.checked = value;
	}

	// Matching notes first, then "Create: ..." when the typed name is not an
	// existing note (Enter with no match creates it).
	getSuggestions(query: string) {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		const items: AppendTarget[] = this.files
			.filter((f) => {
				const p = f.path.toLowerCase();
				return words.every((w) => p.includes(w));
			})
			.map((file): AppendTarget => ({ type: "file", file }));
		const path = newNotePath(query, this.originFile);
		if (path) {
			const lp = path.toLowerCase();
			const exists =
				lp === this.originFile.path.toLowerCase() ||
				this.files.some((f) => f.path.toLowerCase() === lp);
			if (!exists) items.push({ type: "create", path });
		}
		return items;
	}

	renderSuggestion(item: AppendTarget, el: HTMLElement) {
		if (item.type === "create") {
			const name = item.path.split("/").pop()!.replace(/\.md$/, "");
			el.createEl("div", { text: this.ctx.t("modal.create", { name }) });
			const folder = item.path.includes("/")
				? item.path.slice(0, item.path.lastIndexOf("/"))
				: "";
			el.createEl("small", {
				text: folder ? this.ctx.t("modal.folder", { folder }) : this.ctx.t("modal.root"),
				cls: "sk-move-text-suggest-path",
			});
			return;
		}
		const file = item.file;
		el.createEl("div", { text: file.basename });
		const folder = file.parent && file.parent.path !== "/" ? file.parent.path : "";
		if (folder) el.createEl("small", { text: folder, cls: "sk-move-text-suggest-path" });
	}

	onChooseSuggestion(item: AppendTarget) {
		this.onChooseCb(item, this.keep);
	}
}

// Ask an optional title for the archived block. Empty input = date only.
export class ArchiveTitleModal extends Modal {
	constructor(private readonly ctx: Context, private readonly dateStr: string, private readonly onSubmit: (title: string) => void) {
		super(ctx.app);
		ctx.register(() => this.close());
	}

	onOpen() {
		this.titleEl.setText(this.ctx.t("command.archive"));
		const { contentEl } = this;
		contentEl.createEl("p", {
			text: this.ctx.t("modal.archive-title", { date: this.dateStr }),
		});
		const input = contentEl.createEl("input", {
			type: "text",
			cls: "sk-move-text-title-input",
		});
		const submit = () => {
			const value = input.value.trim();
			this.close();
			this.onSubmit(value);
		};
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				submit();
			}
		});
		const row = contentEl.createEl("div", { cls: "sk-move-text-btn-row" });
		const btn = row.createEl("button", { text: this.ctx.t("modal.archive"), cls: "mod-cta" });
		btn.addEventListener("click", submit);
		window.setTimeout(() => input.focus(), 0);
	}

	onClose() {
		this.contentEl.empty();
	}
}

