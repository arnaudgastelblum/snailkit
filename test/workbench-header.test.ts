import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkspaceLeaf } from "obsidian";
import { WorkbenchCore } from "../src/core/workbench";
import { WorkbenchView } from "../src/core/workbench/view";

class HeaderElement {
	readonly classes = new Set<string>();
	parentElement: HeaderElement | null = null;
	children: HeaderElement[] = [];
	header: HeaderElement | null = null;
	height = 30;
	hidden = false;
	addClass(...names: string[]): void { names.forEach(name => this.classes.add(name)); }
	removeClass(...names: string[]): void { names.forEach(name => this.classes.delete(name)); }
	hasClass(name: string): boolean { return this.classes.has(name); }
	toggleClass(name: string, on: boolean): void { if (on) this.addClass(name); else this.removeClass(name); }
	get firstElementChild(): HeaderElement | null { return this.children[0] ?? null; }
	getClientRects(): number[] { return [1]; }
	getBoundingClientRect(): { height: number } { return { height: this.height }; }
	querySelector(selector: string): HeaderElement | null { return selector === ":scope > .view-header" ? this.header : null; }
	contains(el: HeaderElement): boolean { return el === this || this.children.some(child => child.contains(el)); }
	prepend(el: HeaderElement): void { el.remove(); el.parentElement = this; this.children.unshift(el); }
	createDiv(): HeaderElement { const el = new HeaderElement(); this.prepend(el); return el; }
	empty(): void { for (const child of [...this.children]) child.remove(); }
	remove(): void {
		if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
		this.parentElement = null;
	}
}

interface HeaderState {
	tabsHeader: HeaderElement;
	tabsEl: HeaderElement;
	tabsHint: HeaderElement | null;
	placeTabs(): void;
	renderTabs(): void;
	dismissHint(): void;
}

for (const ending of ["close", "unload"] as const) {
	test(`Workbench headers follow moved and hidden tabs and clean up on ${ending}`, async () => {
		const globals = globalThis as unknown as { window?: unknown; ResizeObserver?: unknown };
		const previous = { window: globals.window, ResizeObserver: globals.ResizeObserver };
		globals.window = globalThis;
		globals.ResizeObserver = class { observe(): void {} disconnect(): void {} };
		const core = new WorkbenchCore();
		const view = new WorkbenchView({} as WorkspaceLeaf, core);
		const container = new HeaderElement(), content = new HeaderElement(), header = new HeaderElement();
		header.addClass("view-header", "host-class");
		container.header = header;
		Object.assign(view, { containerEl: container, contentEl: content });
		const state = view as unknown as HeaderState;
		try {
			await view.onOpen();
			state.tabsHeader = new HeaderElement();
			state.tabsEl = new HeaderElement();
			state.tabsHint = state.tabsHeader.createDiv();
			state.placeTabs();
			assert.equal(header.hasClass("sk-wb-has-tabs"), true);
			assert.equal(header.hasClass("sk-wb-has-hint"), true);

			header.height = 0;
			state.placeTabs();
			assert.deepEqual([...header.classes], ["view-header", "host-class"]);
			assert.equal(state.tabsHeader.parentElement, content);

			header.height = 30;
			state.placeTabs();
			state.dismissHint();
			assert.equal(header.hasClass("sk-wb-has-tabs"), true);
			assert.equal(header.hasClass("sk-wb-has-hint"), false);
			state.renderTabs();
			assert.equal(state.tabsHeader.hidden, true);
			assert.equal(header.hasClass("sk-wb-has-tabs"), false);

			state.tabsHeader.hidden = false;
			state.tabsHint = state.tabsHeader.createDiv();
			state.placeTabs();
			if (ending === "close") await view.onClose();
			else view.unload();
			assert.deepEqual([...header.classes], ["view-header", "host-class"]);
			state.dismissHint();
			assert.deepEqual([...header.classes], ["view-header", "host-class"], "late callbacks cannot restore the classes");
		} finally {
			await view.onClose();
			view.unload();
			core.dispose();
			globals.window = previous.window;
			globals.ResizeObserver = previous.ResizeObserver;
		}
	});
}
