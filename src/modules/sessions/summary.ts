// The summary shown before closing a session: the thread of ideas as colored bars, the counts,
// the tasks with their description, what is left to decide (with "Make it a task"), and the
// reminder that nothing is lost. "Close the session" writes the closing line.
import { Modal, setIcon, type TFile } from "obsidian";
import { capsule } from "./capsule";
import { hhmm, type Summary } from "./logic";
import type { SessionsRuntime } from "./runtime";

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export class SummaryModal extends Modal {
	private frames: number[] = [];

	constructor(private rt: SessionsRuntime, private file: TFile, private text: string) {
		super(rt.app);
	}

	private t(key: string, vars?: Record<string, string | number>): string {
		return this.rt.ctx.t(key, vars);
	}

	onOpen(): void {
		const { rt, file } = this;
		rt.modals.add(this);
		const s: Summary = rt.summaryOf(this.text);
		this.modalEl.addClass("sk-sessions-summary-modal");
		this.setTitle("");
		const el = this.contentEl;
		el.addClass("sk-sessions-summary");
		el.setAttr("aria-label", this.t("summary.label"));

		const kick = el.createDiv({ cls: "sk-sessions-sum-kick" });
		setIcon(kick.createSpan({ cls: "sk-sessions-sum-bolt" }), "zap");
		const started = new Date(file.stat.ctime);
		const now = new Date();
		const sameDay = started.toDateString() === now.toDateString();
		kick.createSpan({ text: sameDay ? this.t("summary.kick", { title: file.basename, from: hhmm(started), to: hhmm(now) }) : file.basename });

		el.createEl("h2", { cls: "sk-sessions-sum-title", text: this.t(s.tasks.length || s.questions.length ? "summary.clear" : "summary.noted") });

		const counts = el.createDiv({ cls: "sk-sessions-sum-counts" });
		const count = (key: string, n: number, cls: string, delay: number) => {
			const full = rt.ctx.tn(key, n);
			const at = full.indexOf(String(n));
			const span = counts.createSpan({ cls });
			if (at > 0) span.appendText(full.slice(0, at));
			const b = span.createEl("b", { text: "0" });
			span.appendText(at >= 0 ? full.slice(at + String(n).length) : full);
			this.countUp(b, n, delay);
		};
		count("ideas", s.ideas, "is-ideas", 160);
		counts.createSpan({ cls: "sk-sessions-sum-dot", text: "·" });
		count("tasks", s.tasks.length, "is-tasks", 280);
		counts.createSpan({ cls: "sk-sessions-sum-dot", text: "·" });
		count("decide", s.questions.length, "is-decide", 400);

		// The thread: one bar per idea, as wide as it is long, in the order they came.
		if (s.items.length) {
			const spec = el.createDiv({ cls: "sk-sessions-spectrum" });
			const tip = el.createDiv({ cls: "sk-sessions-spec-tip", text: this.t("summary.spectrum") });
			const max = Math.max(1, ...s.items.map((i) => i.size));
			s.items.forEach((item, i) => {
				const bar = spec.createEl("i", { cls: `sk-sessions-bar is-${item.kind} ${item.tag ? rt.tagClasses(item.tag) : ""}`.trim() });
				bar.style.flex = `${Math.max(10, item.size)} 1 0`;
				bar.style.height = `${item.kind === "task" ? 100 : item.kind === "question" ? 70 : 40 + 20 * (item.size / max)}%`;
				bar.style.animationDelay = `${180 + i * 38}ms`;
				bar.addEventListener("pointerenter", () => tip.setText(this.t(item.kind === "task" ? "summary.bar-task" : item.kind === "question" ? "summary.bar-question" : "summary.bar-free", { text: item.text })));
			});
			spec.addEventListener("pointerleave", () => tip.setText(this.t("summary.spectrum")));
			const legend = el.createDiv({ cls: "sk-sessions-legend" });
			for (const [cls, key] of [["is-task", "summary.legend-task"], ["is-question", "summary.legend-question"], ["is-free", "summary.legend-free"]]) {
				const item = legend.createSpan();
				item.createEl("i", { cls: `sk-sessions-bar ${cls}` });
				item.appendText(this.t(key));
			}
		}

		const cols = el.createDiv({ cls: "sk-sessions-sum-cols" });
		const tasks = cols.createDiv();
		tasks.createEl("h3", { text: this.t("summary.tasks") });
		if (!s.tasks.length) tasks.createEl("p", { cls: "sk-sessions-sum-none", text: this.t("summary.no-tasks") });
		s.tasks.forEach((task, i) => {
			const row = tasks.createDiv({ cls: "sk-sessions-sum-task" + (task.done ? " is-done" : "") });
			row.style.animationDelay = `${420 + i * 70}ms`;
			row.createSpan({ cls: "sk-sessions-sum-box" });
			const body = row.createDiv();
			body.createSpan({ text: task.title });
			if (task.tag) body.append(" ", capsule(el.ownerDocument, task.tag, rt.tagClasses(task.tag)));
			if (task.description.length) body.createEl("small", { text: rt.ctx.tn("summary.description", task.description.length) });
		});
		const questions = cols.createDiv();
		questions.createEl("h3", { text: this.t("summary.decide") });
		if (!s.questions.length) questions.createEl("p", { cls: "sk-sessions-sum-none", text: this.t("summary.no-questions") });
		s.questions.forEach((q, i) => {
			const row = questions.createDiv({ cls: "sk-sessions-sum-question" });
			row.style.animationDelay = `${480 + i * 70}ms`;
			if (q.explicit) row.createSpan({ cls: "sk-sessions-sum-qmark", text: "?" });
			row.appendText(q.text);
			const make = row.createEl("button", { cls: "sk-btn is-ghost is-s sk-sessions-sum-make", attr: { type: "button" } });
			setIcon(make.createSpan({ cls: "sk-sessions-sum-make-icon" }), "plus");
			make.appendText(this.t("summary.make-task"));
			make.addEventListener("click", () => {
				this.close();
				window.setTimeout(() => void rt.catchAt(file, q.line, q.start, q.end), reduced() ? 0 : 200);
			});
		});

		const rest = el.createEl("p", { cls: "sk-sessions-sum-rest" });
		if (s.free) rest.appendText(rt.ctx.tn("summary.free", s.free) + " ");
		rest.appendText(this.t("summary.rest"));

		const actions = el.createDiv({ cls: "sk-sessions-sum-actions" });
		const back = actions.createEl("button", { cls: "sk-btn is-ghost", text: this.t("summary.back"), attr: { type: "button" } });
		const done = actions.createEl("button", { cls: "sk-btn is-primary", text: this.t("summary.close"), attr: { type: "button" } });
		back.addEventListener("click", () => this.close());
		done.addEventListener("click", () => {
			this.close();
			void rt.writeClosing(file);
		});
		window.setTimeout(() => done.focus(), 60);
	}

	private countUp(el: HTMLElement, to: number, delay: number): void {
		if (reduced() || !to) {
			el.setText(String(to));
			return;
		}
		const t0 = performance.now() + delay;
		const duration = 620 + to * 25;
		const step = (now: number) => {
			const t = Math.max(0, Math.min(1, (now - t0) / duration));
			el.setText(String(Math.round(to * (1 - Math.pow(1 - t, 3)))));
			if (t < 1) this.frames.push(window.requestAnimationFrame(step));
		};
		this.frames.push(window.requestAnimationFrame(step));
	}

	onClose(): void {
		this.rt.modals.delete(this);
		for (const f of this.frames) window.cancelAnimationFrame(f);
		this.contentEl.empty();
	}
}
