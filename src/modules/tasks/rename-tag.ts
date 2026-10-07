// "Rename tag" from the navigator of the Tasks list: the new name, then what it will change in the
// vault (notes and occurrences, sub-tags included, a merge with an existing tag said in words),
// before anything is written. The engine is the core's (src/core/tags/rename.ts).
import { Modal, setIcon } from "obsidian";
import { applyTagRename, normalizeTagName, planTagRename, type TagRenameResult } from "../../core/tags/rename";
import type { TasksHub } from "./hub";

export class RenameTagModal extends Modal {
	private timer = 0;
	private seq = 0;

	constructor(
		private readonly hub: TasksHub,
		private readonly from: string,
		private readonly onDone: (to: string, result: TagRenameResult, merges: boolean) => void,
	) {
		super(hub.ctx.app);
		hub.ctx.register(() => this.close());
	}

	private t(key: string, vars?: Record<string, string | number>): string {
		return this.hub.ctx.t(key, vars);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.modalEl.addClass("sk-tasks-rename-tag");
		this.setTitle(this.t("rename-tag.title", { tag: this.from }));
		const field = contentEl.createDiv({ cls: "sk-tasks-rename-tag-field" });
		field.createSpan({ cls: "sk-tasks-rename-tag-hash", text: "#" });
		const input = field.createEl("input", { type: "text", attr: { spellcheck: "false", "aria-label": this.t("rename-tag.label") } });
		input.value = this.from;
		const preview = contentEl.createDiv({ cls: "sk-tasks-rename-tag-preview" });
		const buttons = contentEl.createDiv({ cls: "modal-button-container" });
		const cancel = buttons.createEl("button", { text: this.t("rename-tag.cancel") });
		const go = buttons.createEl("button", { cls: "mod-cta", text: this.t("rename-tag.go") });
		go.disabled = true;
		cancel.addEventListener("click", () => this.close());

		let ready: { to: string; merges: boolean } | null = null;
		const line = (iconName: string, text: string, cls = "") => {
			const row = preview.createDiv({ cls: "sk-tasks-rename-tag-line " + cls });
			setIcon(row.createSpan({ cls: "sk-tasks-rename-tag-icon" }), iconName);
			row.createSpan({ text });
		};
		const check = () => {
			const seq = ++this.seq;
			ready = null;
			go.disabled = true;
			preview.empty();
			const to = normalizeTagName(input.value);
			if (!to) {
				if (input.value.trim()) line("alert-circle", this.t("rename-tag.invalid"), "is-warn");
				return;
			}
			if (to === this.from) return;
			preview.addClass("is-loading");
			window.clearTimeout(this.timer);
			this.timer = window.setTimeout(() => {
				void planTagRename(this.app, this.from, to).then((plan) => {
					if (seq !== this.seq) return;
					preview.removeClass("is-loading");
					preview.empty();
					if (!plan.total) {
						line("info", this.t("rename-tag.nothing"));
						return;
					}
					line("file-text", this.hub.ctx.tn("rename-tag.plan", plan.files.length, { total: plan.total }));
					const prefix = this.from.toLowerCase() + "/";
					if (this.hub.index.allTags().some((tag) => tag.startsWith(prefix))) line("corner-down-right", this.t("rename-tag.subtags", { from: this.from, to }));
					if (plan.merges) line("merge", this.t("rename-tag.merge", { to }), "is-warn");
					ready = { to, merges: plan.merges };
					go.disabled = false;
				});
			}, 250);
		};
		const run = async () => {
			if (!ready || go.disabled) return;
			const { to, merges } = ready;
			go.disabled = true;
			cancel.disabled = true;
			input.disabled = true;
			go.setText(this.t("rename-tag.working"));
			try {
				const result = await applyTagRename(this.app, this.from, to);
				this.close();
				this.onDone(to, result, merges);
			} catch (error) {
				console.error("[Snailkit] tasks: tag rename failed", error);
				this.close();
				this.hub.ctx.toast(this.t("rename-tag.failed"));
			}
		};
		input.addEventListener("input", check);
		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				void run();
			}
		});
		go.addEventListener("click", () => void run());
		input.focus();
		input.select();
	}

	onClose(): void {
		window.clearTimeout(this.timer);
		this.seq++;
		this.contentEl.empty();
	}
}
