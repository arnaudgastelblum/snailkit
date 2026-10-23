import { editorInfoField, getAllTags, MarkdownRenderChild, setIcon, TFile } from "obsidian";
import { StateEffect, type AnnotationType, type Range } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { Decoration, ViewPlugin, WidgetType, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import { openTagPicker, tagColorsFrom, taskTagChoices, type TagPickerHandle } from "../../ui/tag-picker";
import type { TagRuntime } from "./runtime";
import { frequencies } from "./types";
import { checkedSourceTaskInsertion, checkedTaskInsertion, checkedTaskTagChange, hasTaskTag, taskBodyStart, taskLine, taskLines } from "./task-placeholder-logic";
import { elementOf } from "../../ui/dom";
import { parentFirst, parentSuggestion, type ParentSuggestion, type TasksApi } from "./task-parent";

const refresh = StateEffect.define<null>();
const isolate = isolateHistory as unknown as AnnotationType<"full">;

/** Owns picker lifetimes and reading sections as well as the visible editor decorations. */
export function registerTaskPlaceholders(runtime: TagRuntime): { changeTag(view: EditorView, anchor: HTMLElement, pos: number, old: string): void } {
	const { ctx } = runtime;
	let stopped = false;
	let picker: TagPickerHandle | undefined;
	/** Where the open picker writes: its editor (null in reading view) and its note. The note changing closes it. */
	let pickerOwner: EditorView | null = null;
	let pickerPath: string | null = null;
	const editors = new Set<EditorView>();
	const sections = new Set<() => void>();
	const enabled = () => !stopped && ctx.settings.taskPlaceholder;
	const parentAt = (path: string) => parentSuggestion(ctx.service<TasksApi>("tasks")?.parentOf?.(path));
	const close = () => { picker?.close(); picker = undefined; pickerOwner = null; pickerPath = null; };
	const remember = (tag: string) => {
		ctx.settings.placeholderRecent = [tag, ...ctx.settings.placeholderRecent.filter(t => t.toLowerCase() !== tag.toLowerCase())].slice(0, 12);
		void ctx.saveSettings();
	};
	const apply = (choose: (tag: string) => boolean | Promise<boolean>, tag: string) => {
		void Promise.resolve().then(() => !stopped && choose(tag)).then(ok => { if (ok && !stopped) remember(tag); }).catch(error => {
			console.error("[Snailkit] task tag insertion failed", error);
			ctx.toast(ctx.t("placeholder.failed"));
		});
	};
	// In reading view the picker writes into the file: the file changing elsewhere closes it.
	ctx.registerEvent(ctx.app.vault.on("modify", (file) => {
		if (picker && !pickerOwner && file.path === pickerPath) close();
	}));
	/**
	 * Opens the tag picker under `anchor`; `choose` writes the tag. `chosen` is the tag being changed,
	 * if any: changing a tag works even with the placeholder setting off.
	 */
	function openPicker(anchor: HTMLElement, path: string, owner: EditorView | null, choose: (tag: string) => boolean | Promise<boolean>, chosen: string | null = null): void {
		const allowed = () => !stopped && (chosen !== null || ctx.settings.taskPlaceholder);
		if (!allowed()) return;
		close();
		// Snapshot metadata only on opening, never while typing in the editor or picker.
		// Priorities (#high, #medium, #low) mark a task, they are never offered as its tag.
		const notPriority = (tag: string) => !/^(?:high|medium|low)$/i.test(tag);
		const all = Object.entries(frequencies(ctx.app)).sort((a, b) => b[1] - a[1]).map(([tag]) => tag.replace(/^#/, "")).filter(notPriority);
		const cache = ctx.app.metadataCache.getCache(path);
		const near = parentFirst(cache ? (getAllTags(cache) ?? []).map(tag => tag.replace(/^#/, "")).filter(notPriority) : [], parentAt(path));
		// With Tasks: its tag tree, and the tags used around the note (the step's task first) instead of the note's tags.
		const choices = taskTagChoices(ctx, path);
		pickerOwner = owner;
		pickerPath = path;
		picker = openTagPicker(anchor, {
			t: (key, vars) => ctx.t(key, vars), colors: tagColorsFrom(ctx),
			sources: {
				all: () => all, near: () => (choices ? [] : near), around: () => choices?.around ?? [], tree: () => choices?.tree ?? [],
				recent: () => ctx.settings.placeholderRecent.filter(notPriority), chosen: () => chosen,
			},
			onCancel: () => { picker = undefined; pickerOwner = null; pickerPath = null; },
			onChoose: (tag) => {
				picker = undefined;
				pickerOwner = null;
				pickerPath = null;
				if (allowed() && tag !== chosen) apply(choose, tag);
			},
		});
	}
	function chip(doc: Document, path: string, choose: (tag: string) => boolean | Promise<boolean>, owner: EditorView | null = null): HTMLButtonElement {
		const el = elementOf(doc, "button");
		el.type = "button";
		el.tabIndex = -1;
		el.className = "sk-tag-colors-task-placeholder";
		const parent = parentAt(path);
		el.setAttribute("aria-label", parent ? ctx.t("placeholder.parent", { tag: parent.tag, task: parent.task }) : ctx.t("placeholder.add"));
		if (parent) {
			el.classList.add("sk-tag-colors-task-suggestion", ...runtime.classes(parent.tag).split(" "));
			el.appendText("#" + parent.tag);
		} else {
			const icon = el.createSpan();
			setIcon(icon, "tag");
			el.appendText("tag");
		}
		el.addEventListener("mousedown", e => e.preventDefault());
		el.addEventListener("click", e => {
			e.preventDefault(); e.stopPropagation();
			if (!enabled()) return;
			if (parent && parentAt(path)?.tag === parent.tag) { close(); apply(choose, parent.tag); }
			else openPicker(el, path, owner, choose);
		});
		if (parent) el.addEventListener("contextmenu", e => {
			e.preventDefault(); e.stopPropagation();
			openPicker(el, path, owner, choose);
		});
		return el;
	}
	/**
	 * Equal for every task of the note, so typing never rebuilds the chip (it would blink): its line
	 * is read where it stands when a tag is chosen (any edit before that closes the picker).
	 */
	class TaskWidget extends WidgetType {
		constructor(readonly path: string, readonly parent: ParentSuggestion | null) { super(); }
		eq(other: TaskWidget): boolean { return this.path === other.path && this.parent?.tag === other.parent?.tag && this.parent?.task === other.parent?.task; }
		toDOM(view: EditorView): HTMLElement {
			const el: HTMLElement = chip(view.dom.ownerDocument, this.path, tag => {
				if (!editors.has(view) || !el.isConnected || view.scrollDOM.classList.contains("sk-sessions-composing") || view.state.field(editorInfoField, false)?.file?.path !== this.path) return false;
				const line = view.state.doc.lineAt(view.posAtDOM(el));
				const change = checkedTaskInsertion(line.text, line.text, tag);
				if (!change || excluded(view, line.from)) return false;
				view.dispatch({ changes: { from: line.from + change.at, insert: change.insert }, annotations: isolate.of("full"), userEvent: "input.tag" });
				view.focus();
				return true;
			}, view);
			return el;
		}
		ignoreEvent(): boolean { return true; }
	}
	/** Changes the tag `old` of the open task shown by `anchor` (a tag capsule of the editor), at `pos`. */
	function changeTag(view: EditorView, anchor: HTMLElement, pos: number, old: string): void {
		const path = view.state.field(editorInfoField, false)?.file?.path;
		if (!path || pos > view.state.doc.length) return;
		const line = view.state.doc.lineAt(pos), snapshot = line.text, at = pos - line.from;
		if (!checkedTaskTagChange(snapshot, snapshot, at, old, old)) return;
		openPicker(anchor, path, view, tag => {
			if (!editors.has(view) || view.state.field(editorInfoField, false)?.file?.path !== path || pos > view.state.doc.length) return false;
			const now = view.state.doc.lineAt(pos);
			const change = now.from === line.from ? checkedTaskTagChange(now.text, snapshot, at, old, tag) : null;
			if (!change) return false;
			view.dispatch({ changes: { from: now.from + change.from, to: now.from + change.to, insert: change.insert }, annotations: isolate.of("full"), userEvent: "input.tag" });
			view.focus();
			return true;
		}, old);
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
		const parent = parentAt(path);
		const ranges: Range<Decoration>[] = [], seen = new Set<number>();
		for (const visible of view.visibleRanges) {
			for (let n = view.state.doc.lineAt(visible.from).number; n <= view.state.doc.lineAt(visible.to).number; n++) {
				if (seen.has(n)) continue;
				seen.add(n);
				const line = view.state.doc.line(n), task = taskLine(line.text);
				if (!task?.open || hasTaskTag(line.text) || excluded(view, line.from + line.text.search(/\S/))) continue;
				// Right after the checkbox, before the cursor: typing the task never pushes it along.
				const at = line.from + taskBodyStart(line.text);
				ranges.push(Decoration.widget({ widget: new TaskWidget(path, parent), side: -1 }).range(at));
			}
		}
		return Decoration.set(ranges, true);
	}
	ctx.registerEditorExtension(ViewPlugin.fromClass(class {
		decorations = Decoration.none;
		private timer: number | undefined;
		private observer: MutationObserver;
		constructor(private view: EditorView) {
			editors.add(view);
			this.decorations = decorate(view);
			this.observer = new MutationObserver(() => this.schedule());
			this.observer.observe(view.scrollDOM, { attributes: true, attributeFilter: ["class"] });
		}
		private schedule(): void {
			window.clearTimeout(this.timer);
			this.timer = window.setTimeout(() => this.view.dispatch({ effects: refresh.of(null) }), 80);
		}
		update(update: ViewUpdate): void {
			// The note changed under an open picker: its line may have moved, it closes rather than write elsewhere.
			if (update.docChanged && picker && pickerOwner === this.view) close();
			if (update.transactions.some(tr => tr.effects.some(e => e.is(refresh)))) this.decorations = decorate(this.view);
			else if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
				// Rebuilt at once (equal widgets keep their DOM: no blink while typing), then once more
				// when the parser has caught up (code blocks, properties).
				this.decorations = decorate(this.view);
				this.schedule();
			}
		}
		destroy(): void { window.clearTimeout(this.timer); this.observer.disconnect(); editors.delete(this.view); }
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
				// Right after the checkbox, as in the editor.
				const box = Array.from(host.children).find(child => child.matches("input.task-list-item-checkbox"));
				host.insertBefore(button, box ? box.nextSibling : host.firstChild);
				chips.push(button);
			});
		};
		sections.add(render);
		render();
		context.addChild(new class extends MarkdownRenderChild {
			onunload(): void { active = false; clear(); sections.delete(render); }
		}(el));
	});
	const refreshAll = () => {
		if (stopped) return;
		if (!enabled()) close();
		for (const view of editors) view.dispatch({ effects: refresh.of(null) });
		for (const render of sections) render();
	};
	let tasks: TasksApi | undefined;
	let unsubscribe: (() => void) | undefined;
	const servicesChanged = () => {
		const next = ctx.service<TasksApi>("tasks");
		if (next === tasks) return;
		unsubscribe?.();
		tasks = next;
		unsubscribe = tasks?.on("change", () => { close(); refreshAll(); });
		close();
		refreshAll();
	};
	ctx.onSettingsChange(refreshAll);
	ctx.onServicesChange(servicesChanged);
	servicesChanged();
	ctx.register(() => { stopped = true; unsubscribe?.(); close(); for (const render of sections) render(); sections.clear(); });
	return { changeTag };
}
