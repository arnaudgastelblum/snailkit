import { MarkdownRenderChild, Menu, type Modal } from "obsidian";
import type { EditorView } from "@codemirror/view";
import type { ModuleContext } from "../../core/context";
import { assignSlots, buildCss, capsule, slotHue, tagKey } from "./colors";
import { classes, ColorModal, ReassignModal } from "./dialogs";
import { editorExtension, refreshColors } from "./editor";
import { frequencies, registry, type ColorHost, type TagColorsSettings } from "./types";
import type { TagColorsAPI } from "./api";

export class TagRuntime implements ColorHost {
	readonly editors = new Set<EditorView>();
	private reading = new Map<Element, { tag: string; nodes: Node[] }>();
	private panes = new Set<Element>();
	private documents = new Map<Document, { style: HTMLStyleElement; observer: MutationObserver }>();
	private dialogs = new Set<Modal>();
	private frames = new Set<() => void>();
	private menu: Menu | undefined;
	private metadataTimer: ReturnType<typeof setTimeout> | undefined;
	private paneTimer: ReturnType<typeof setTimeout> | undefined;
	private saveTimer: ReturnType<typeof setTimeout> | undefined;
	private stopped = false;
	constructor(readonly ctx: ModuleContext<TagColorsSettings>) {}
	get app() { return this.ctx.app; }
	get settings() { return this.ctx.settings; }
	t: ColorHost["t"] = (key, vars) => this.ctx.t(key, vars);
	save(): Promise<void> { return this.ctx.saveSettings(); }
	classes(tag: string): string { return classes(this, tag); }

	start(): void {
		const { ctx } = this;
		ctx.register(() => this.stop());
		this.syncRegistry();
		this.refresh();
		ctx.registerEditorExtension(editorExtension(this));
		ctx.registerMarkdownPostProcessor((el, context) => {
			const render = () => {
				if (this.stopped || !el.closest(".markdown-preview-view") || el.closest(".popover, .canvas-node, .search-result")) return;
				this.attachDocument(el.ownerDocument);
				for (const tag of Array.from(el.querySelectorAll("a.tag"))) this.renderReading(tag);
			};
			render();
			const runtime = this;
			context.addChild(new class extends MarkdownRenderChild {
				onload(): void {
					const win = el.ownerDocument.defaultView;
					if (!win) return;
					if (runtime.stopped) return;
					const cancel = () => { win.cancelAnimationFrame(frame); runtime.frames.delete(cancel); };
					const frame = win.requestAnimationFrame(() => { runtime.frames.delete(cancel); render(); });
					runtime.frames.add(cancel);
					this.register(cancel);
				}
				onunload(): void {
					for (const tag of Array.from(el.querySelectorAll("a.tag"))) runtime.restoreReading(tag);
				}
			}(el));
		});
		const schedule = () => {
			clearTimeout(this.metadataTimer);
			this.metadataTimer = setTimeout(() => this.syncRegistry(), 1000);
		};
		ctx.registerEvent(this.app.metadataCache.on("resolved", schedule));
		ctx.registerEvent(this.app.metadataCache.on("changed", schedule));
		ctx.registerEvent(this.app.metadataCache.on("deleted", schedule));
		ctx.registerEvent(this.app.workspace.on("layout-change", () => this.refresh()));
		ctx.registerEvent(this.app.workspace.on("file-open", () => this.schedulePanes()));
		this.app.workspace.onLayoutReady(() => {
			if (this.stopped) return;
			this.syncRegistry();
			this.refresh();
		});
		ctx.onSettingsChange(() => this.refresh());
		ctx.addCommand({ id: "reassign-automatic-colors", name: ctx.t("reassign"), callback: () => this.openModal(new ReassignModal(this)) });
		ctx.provide<TagColorsAPI>("tag-colors", { version: 1, classes: tag => this.classes(tag) });
	}

	private syncRegistry(): void {
		if (this.stopped) return;
		const next = Object.entries(assignSlots(registry(this.settings, "slots"), frequencies(this.app)));
		if (JSON.stringify(next) === JSON.stringify(this.settings.slots)) return;
		this.settings.slots = next;
		this.refresh();
		clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			this.saveTimer = undefined;
			void this.save();
		}, 400);
	}

	private attachDocument(doc: Document): void {
		if (this.documents.has(doc)) return;
		const style = doc.createElement("style");
		doc.head.append(style);
		const observer = new MutationObserver(records => {
			const relevant = records.some(record => {
				const target = record.target.nodeType === 1 ? record.target as Element : record.target.parentElement;
				if (target?.closest('.metadata-container, [data-type="tag"]')) return true;
				return Array.from(record.addedNodes).concat(Array.from(record.removedNodes)).some(node => node.nodeType === 1 &&
					((node as Element).matches(".metadata-container") || (node as Element).querySelector(".metadata-container")));
			});
			if (relevant) this.schedulePanes();
		});
		this.documents.set(doc, { style, observer });
		this.updateCss(doc, style);
		this.ctx.registerDomEvent(doc, "contextmenu", event => {
			const target = event.target as Element | null;
			const el = target?.closest?.(".markdown-preview-view a.tag");
			if (el && !el.closest(".popover, .canvas-node, .search-result")) this.showMenu(event, this.reading.get(el)?.tag ?? el.textContent ?? "");
		});
	}

	private updateCss(doc: Document, style: HTMLStyleElement): void {
		style.textContent = buildCss([...Array.from({ length: 14 }, (_, i) => slotHue(i)), ...Object.values(registry(this.settings, "overrides"))]);
		doc.body.classList.toggle("sk-tag-colors-upper", this.settings.uppercase);
	}

	private refresh(): void {
		if (this.stopped) return;
		this.attachDocument(document);
		for (const type of ["markdown", "tag"]) {
			for (const leaf of this.app.workspace.getLeavesOfType(type)) this.attachDocument(leaf.view.containerEl.ownerDocument);
		}
		for (const [doc, { style }] of this.documents) {
			this.updateCss(doc, style);
			for (const el of Array.from(doc.querySelectorAll('.workspace-leaf-content[data-type="markdown"] .markdown-preview-view a.tag'))) {
				if (!el.closest(".popover, .canvas-node, .search-result")) this.renderReading(el);
			}
		}
		for (const [el] of this.reading) if (!el.isConnected) this.restoreReading(el);
		for (const view of this.editors) view.dispatch({ effects: refreshColors.of(null) });
		this.observePanes();
		this.app.workspace.trigger("snailkit:services-changed");
	}

	private renderReading(el: Element): void {
		let saved = this.reading.get(el);
		if (!saved || !el.querySelector(".sk-tag-colors-tag")) {
			saved = { tag: (el.textContent ?? "").replace(/^#/, ""), nodes: Array.from(el.childNodes) };
			this.reading.set(el, saved);
		}
		el.replaceChildren(capsule(el.ownerDocument, saved.tag, this.classes(saved.tag)));
	}

	private restoreReading(el: Element): void {
		const saved = this.reading.get(el);
		if (saved && el.querySelector(".sk-tag-colors-tag")) el.replaceChildren(...saved.nodes);
		this.reading.delete(el);
	}

	private clearPane(el: Element): void {
		for (const cls of Array.from(el.classList)) {
			if (/^sk-tag-colors-[rl]-/.test(cls) || cls === "sk-tag-colors-property" || cls === "sk-tag-colors-pane") el.classList.remove(cls);
		}
	}

	private schedulePanes(): void {
		clearTimeout(this.paneTimer);
		this.paneTimer = setTimeout(() => this.observePanes(), 100);
	}

	private observePanes(): void {
		if (this.stopped) return;
		for (const { observer } of this.documents.values()) observer.disconnect();
		for (const el of this.panes) this.clearPane(el);
		this.panes.clear();
		if (!this.settings.colorPanes) return;
		for (const [doc, { observer }] of this.documents) {
			for (const root of Array.from(doc.querySelectorAll('.workspace-leaf-content[data-type="markdown"], .workspace-leaf-content[data-type="tag"]'))) {
				const pane = root.matches('[data-type="tag"]');
				const selector = pane ? ".tree-item-self .tree-item-inner" : '.metadata-container [data-property-key="tags"] .multi-select-pill';
				for (const el of Array.from(root.querySelectorAll(selector))) {
					const tag = el.getAttribute("data-tag") || el.querySelector(".multi-select-pill-content")?.textContent || el.textContent || "";
					el.classList.add(pane ? "sk-tag-colors-pane" : "sk-tag-colors-property", ...this.classes(tag.trim()).split(" "));
					this.panes.add(el);
				}
				observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["data-tag", "data-property-key"] });
			}
		}
	}

	openSearch(tag: string): void {
		const app = this.app as typeof this.app & { internalPlugins?: { getPluginById?(id: string): { instance?: { openGlobalSearch?(query: string): void } } } };
		const search = app.internalPlugins?.getPluginById?.("global-search")?.instance;
		if (search?.openGlobalSearch) search.openGlobalSearch("tag:#" + tag.replace(/^#/, ""));
		else this.ctx.toast(this.t("search.unavailable"));
	}

	private openModal(modal: Modal): void {
		if (this.stopped) return;
		this.dialogs.add(modal);
		const close = modal.onClose.bind(modal);
		modal.onClose = () => { this.dialogs.delete(modal); close(); };
		modal.open();
	}

	showMenu(event: MouseEvent, tag: string): void {
		if (this.stopped) return;
		event.preventDefault();
		event.stopPropagation();
		this.menu?.hide();
		const menu = this.menu = new Menu();
		menu.addItem(item => item.setTitle(this.t("color.tag")).setIcon("palette").onClick(() => this.openModal(new ColorModal(this, tag))));
		if (tagKey(tag).includes("/")) menu.addItem(item => item.setTitle(this.t("color.family")).setIcon("palette")
			.onClick(() => this.openModal(new ColorModal(this, tagKey(tag).split("/")[0]))));
		menu.showAtMouseEvent(event);
	}

	private stop(): void {
		this.stopped = true;
		clearTimeout(this.metadataTimer);
		clearTimeout(this.paneTimer);
		if (this.saveTimer !== undefined) { clearTimeout(this.saveTimer); void this.save(); }
		this.menu?.hide();
		for (const cancel of this.frames) cancel();
		for (const modal of this.dialogs) modal.close();
		for (const [doc, { style, observer }] of this.documents) {
			observer.disconnect();
			style.remove();
			doc.body.classList.remove("sk-tag-colors-upper");
		}
		for (const [el] of this.reading) this.restoreReading(el);
		for (const el of this.panes) this.clearPane(el);
		this.documents.clear();
		this.panes.clear();
	}
}
