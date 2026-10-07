import { editorInfoField, getAllTags, MarkdownRenderChild, setIcon, TFile } from "obsidian";
import { StateEffect, type AnnotationType, type Range } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { Decoration, ViewPlugin, WidgetType, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import { openTagPicker, tagColorsFrom, type TagPickerHandle } from "../../ui/tag-picker";
import type { TagRuntime } from "./runtime";
import { frequencies } from "./types";
import { checkedSourceTaskInsertion, checkedTaskInsertion, hasTaskTag, taskLine, taskLines, taskTagPosition } from "./task-placeholder-logic";

const refresh = StateEffect.define<null>();
const isolate = isolateHistory as unknown as AnnotationType<"full">;

/** Owns picker lifetimes and reading sections as well as the visible editor decorations. */
export function registerTaskPlaceholders(runtime: TagRuntime): void {
	const { ctx } = runtime;
	let stopped = false;
	let picker: TagPickerHandle | undefined;
	/** Where the open picker writes: its editor (null in reading view) and its note. The note changing closes it. */
	let pickerOwner: EditorView | null = null;
	let pickerPath: string | null = null;
	const editors = new Set<EditorView>();
	const sections = new Set<() => void>();
	const enabled = () => !stopped && ctx.settings.taskPlaceholder;
	const close = () => { picker?.close(); picker = undefined; pickerOwner = null; pickerPath = null; };
	const remember = (tag: string) => {
		ctx.settings.placeholderRecent = [tag, ...ctx.settings.placeholderRecent.filter(t => t.toLowerCase() !== tag.toLowerCase())].slice(0, 12);
		void ctx.saveSettings();
	};
	// In reading view the picker writes into the file: the file changing elsewhere closes it.
	ctx.registerEvent(ctx.app.vault.on("modify", (file) => {
		if (picker && !pickerOwner && file.path === pickerPath) close();
	}));
	function chip(doc: Document, path: string, choose: (tag: string) => boolean | Promise<boolean>, owner: EditorView | null = null): HTMLButtonElement {
		const el = doc.createElement("button");
		el.type = "button";
		el.tabIndex = -1;
		el.className = "sk-tag-colors-task-placeholder";
		el.setAttribute("aria-label", ctx.t("placeholder.add"));
		const icon = doc.createElement("span");
		setIcon(icon, "tag");
		el.append(icon, doc.createTextNode("tag"));
		el.addEventListener("mousedown", e => e.preventDefault());
		el.addEventListener("click", e => {
			e.preventDefault(); e.stopPropagation();
			if (!enabled()) return;
			close();
			// Snapshot metadata only on opening, never while typing in the editor or picker.
			// Priorities (#high, #medium, #low) mark a task, they are never offered as its tag.
			const notPriority = (tag: string) => !/^(?:high|medium|low)$/i.test(tag);
			const all = Object.entries(frequencies(ctx.app)).sort((a, b) => b[1] - a[1]).map(([tag]) => tag.replace(/^#/, "")).filter(notPriority);
			const cache = ctx.app.metadataCache.getCache(path);
			const near = cache ? (getAllTags(cache) ?? []).map(tag => tag.replace(/^#/, "")).filter(notPriority) : [];
			pickerOwner = owner;
			pickerPath = path;
			picker = openTagPicker(el, {
				t: (key, vars) => ctx.t(key, vars), colors: tagColorsFrom(ctx),
				sources: { all: () => all, near: () => near, recent: () => ctx.settings.placeholderRecent.filter(notPriority) },
				onCancel: () => { picker = undefined; pickerOwner = null; pickerPath = null; },
				onChoose: (tag) => {
					picker = undefined;
					pickerOwner = null;
					pickerPath = null;
					if (enabled()) void Promise.resolve(choose(tag)).then(ok => { if (ok && !stopped) remember(tag); }).catch(error => {
						console.error("[Snailkit] task tag insertion failed", error);
						ctx.toast(ctx.t("placeholder.failed"));
					});
				},
			});
		});
		return el;
	}
	class TaskWidget extends WidgetType {
		constructor(readonly line: number, readonly text: string, readonly path: string) { super(); }
		eq(other: TaskWidget): boolean { return this.line === other.line && this.text === other.text && this.path === other.path; }
		toDOM(view: EditorView): HTMLElement {
			return chip(view.dom.ownerDocument, this.path, tag => {
				if (!editors.has(view) || view.scrollDOM.classList.contains("sk-sessions-composing") || view.state.field(editorInfoField, false)?.file?.path !== this.path || this.line > view.state.doc.lines) return false;
				const line = view.state.doc.line(this.line);
				const change = checkedTaskInsertion(line.text, this.text, tag);
				if (!change || excluded(view, line.from)) return false;
				view.dispatch({ changes: { from: line.from + change.at, insert: change.insert }, annotations: isolate.of("full"), userEvent: "input.tag" });
				view.focus();
				return true;
			}, view);
		}
		ignoreEvent(): boolean { return true; }
	}
	function excluded(view: EditorView, pos: number): boolean {
		for (let node = syntaxTree(view.state).resolveInner(pos, 1); node; node = node.parent!) {
			if (/codeblock|fencedcode|code-block|frontmatter|yaml|hmd-code/i.test(node.name)) return true;
		}
		return false;
	}
	function decorate(view: EditorView): DecorationSet {
		if (!enabled() || view.scrollDOM.classList.contains("sk-sessions-composing")) return Decoration.none;
		const path = view.state.field(editorInfoField, false)?.file?.path;
		if (!path) return Decoration.none;
		const ranges: Range<Decoration>[] = [], seen = new Set<number>();
		for (const visible of view.visibleRanges) {
			for (let n = view.state.doc.lineAt(visible.from).number; n <= view.state.doc.lineAt(visible.to).number; n++) {
				if (seen.has(n)) continue;
				seen.add(n);
				const line = view.state.doc.line(n), task = taskLine(line.text);
				if (!task?.open || hasTaskTag(line.text) || excluded(view, line.from + line.text.search(/\S/))) continue;
				const at = line.from + taskTagPosition(line.text);
				ranges.push(Decoration.widget({ widget: new TaskWidget(n, line.text, path), side: 1 }).range(at));
			}
		}
		return Decoration.set(ranges, true);
	}
	ctx.registerEditorExtension(ViewPlugin.fromClass(class {
		decorations = Decoration.none;
		private timer: ReturnType<typeof setTimeout> | undefined;
		private observer: MutationObserver;
		constructor(private view: EditorView) {
			editors.add(view);
			this.decorations = decorate(view);
			this.observer = new MutationObserver(() => this.schedule());
			this.observer.observe(view.scrollDOM, { attributes: true, attributeFilter: ["class"] });
		}
		private schedule(): void {
			clearTimeout(this.timer);
			this.timer = setTimeout(() => this.view.dispatch({ effects: refresh.of(null) }), 80);
		}
		update(update: ViewUpdate): void {
			// The note changed under an open picker: its line may have moved, it closes rather than write elsewhere.
			if (update.docChanged && picker && pickerOwner === this.view) close();
			if (update.transactions.some(tr => tr.effects.some(e => e.is(refresh)))) this.decorations = decorate(this.view);
			else if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
				// Do not leave a clickable snapshot at a stale position while the debounce runs.
				this.decorations = Decoration.none;
				this.schedule();
			}
		}
		destroy(): void { clearTimeout(this.timer); this.observer.disconnect(); editors.delete(this.view); }
	}, { decorations: value => value.decorations }));

	ctx.registerMarkdownPostProcessor((el, context) => {
		const chips: HTMLElement[] = [];
		const consumed = new Set<number>();
		let active = true;
		const clear = () => { for (const chip of chips.splice(0)) chip.remove(); };
		const render = () => {
			clear();
			if (!enabled() || !active) return;
			const info = context.getSectionInfo(el);
			if (!info) return;
			const tasks = taskLines(info.text).filter(t => t.line >= info.lineStart && t.line <= info.lineEnd);
			const items = Array.from(el.querySelectorAll<HTMLElement>("li.task-list-item"));
			// An ambiguous third-party render is safer to skip than to write to the wrong line.
			if (tasks.length !== items.length) return;
			items.forEach((item, i) => {
				const task = tasks[i];
				if (!task.open || consumed.has(task.line) || hasTaskTag(task.text) || item.closest("pre, code")) return;
				const button = chip(el.ownerDocument, context.sourcePath, async tag => {
					const file = ctx.app.vault.getAbstractFileByPath(context.sourcePath);
					if (!(file instanceof TFile)) return false;
					let changed = false;
					await ctx.app.vault.process(file, source => {
						if (!enabled() || !active) return source;
						const next = checkedSourceTaskInsertion(source, task.line, task.text, tag);
						if (next === null) return source;
						changed = true;
						return next;
					});
					if (changed) { consumed.add(task.line); button.remove(); }
					return changed;
				});
				const paragraph = Array.from(item.children).find(child => child.tagName === "P");
				const host = paragraph ?? item;
				const marker = /(?:📅|✅|🛫|⏳|➕|❌|🔺|⏫|🔼|🔽|⏬)/u.exec(task.text.slice(taskTagPosition(task.text)))?.[0];
				const walker = el.ownerDocument.createTreeWalker(host, 4 /* SHOW_TEXT */);
				let placed = false;
				if (marker) for (let node = walker.nextNode(); node; node = walker.nextNode()) {
					if (node.parentElement?.closest("li") !== item) continue;
					const at = (node.textContent ?? "").indexOf(marker);
					if (at < 0) continue;
					const tail = at === 0 ? node : (node as Text).splitText(at);
					tail.parentNode!.insertBefore(button, tail);
					placed = true;
					break;
				}
				if (!placed) host.insertBefore(button, Array.from(host.children).find(child => /^(UL|OL)$/.test(child.tagName)) ?? null);
				chips.push(button);
			});
		};
		sections.add(render);
		render();
		context.addChild(new class extends MarkdownRenderChild {
			onunload(): void { active = false; clear(); sections.delete(render); }
		}(el));
	});
	ctx.onSettingsChange(() => {
		if (!enabled()) close();
		for (const view of editors) view.dispatch({ effects: refresh.of(null) });
		for (const render of sections) render();
	});
	ctx.register(() => { stopped = true; close(); for (const render of sections) render(); sections.clear(); });
}
