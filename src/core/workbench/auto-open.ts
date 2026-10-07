// Opening the Workbench by itself, as its setting asks (data.workbench.autoOpen, on Home, else on
// the first tab; never while no tool has a tab):
// - at Obsidian's startup only (not when the plugin is updated or turned on again): the first tab
//   of the main area, pinned, on the asked tab, active. Never two: a Workbench restored in the main
//   area of the main window is reused and moved to the front of its tab group (one in a pop-out
//   window stays as it is); a lone empty tab too. Restored tabs stay, except transient Workbenches
//   (new tabs of the last session showing Home, not pinned since): the startup Workbench stands for
//   them, so they close; with "Never", they go back to being empty tabs.
// - in new empty tabs ("startup-and-new-tabs"): Ctrl/Cmd+T or closing the last tab leaves an empty
//   tab; when it is still empty and active a frame later (a tab opened to show a note is not), it
//   becomes a transient Workbench: opening a note from it takes its place.
// Phones follow the same setting; the focus is not put in a field there (no keyboard popping up).
import { Platform, View, type WorkspaceLeaf, type WorkspaceParent } from "obsidian";
import type SnailkitPlugin from "../../main";
import type { WorkbenchCore } from "./index";
import { isSideLeaf, readViewState, startupPlan } from "./state";
import { WORKBENCH_VIEW_TYPE } from "./types";
import { WorkbenchView } from "./view";

const EMPTY_VIEW = "empty";

export class AutoOpener {
	private layoutReady = false;
	private startupDone = false;
	private checking = new Set<WorkspaceLeaf>();
	private disposed = false;
	/** Gives back the keys held while the startup Workbench opens (see holdKeys). */
	private releaseKeys: (() => void) | null = null;

	constructor(
		private readonly plugin: SnailkitPlugin,
		private readonly core: WorkbenchCore,
		/** False when the plugin was loaded into a running Obsidian (update, reactivation). */
		private readonly startup: boolean,
	) {
		const workspace = plugin.app.workspace;
		plugin.registerEvent(workspace.on("layout-change", () => this.newTabSoon()));
		plugin.registerEvent(workspace.on("active-leaf-change", () => this.newTabSoon()));
		if (startup) this.holdKeys();
	}

	private get app() {
		return this.plugin.app;
	}

	/** The modules started and the workspace is ready. */
	ready(): void {
		if (this.disposed || this.layoutReady) return;
		this.layoutReady = true;
		if (!this.startup) {
			this.startupDone = true;
			return;
		}
		(this.core.autoOpenMode === "never" ? this.forgetTransients() : this.openAtStartup())
			.catch((error) => console.error("[Snailkit] workbench: could not open at startup", error))
			.finally(() => {
				this.releaseKeys?.();
				this.startupDone = true;
			});
	}

	/** The leaves of the main area of the main window (not the side panels, not pop-out windows). */
	private mainLeaves(): WorkspaceLeaf[] {
		const out: WorkspaceLeaf[] = [];
		this.app.workspace.iterateRootLeaves((leaf) => {
			out.push(leaf);
		});
		return out;
	}

	/** The first tab group of the main area. */
	private firstGroup(): WorkspaceParent | null {
		let first: WorkspaceLeaf | null = null;
		this.app.workspace.iterateRootLeaves((leaf) => {
			if (!first) first = leaf;
		});
		return (first as WorkspaceLeaf | null)?.parent ?? null;
	}

	/** The Workbenches restored in the main area, in tab order, and what each was. */
	private restored(): Array<{ leaf: WorkspaceLeaf; pinned: boolean; transient: boolean }> {
		return this.mainLeaves()
			.filter((leaf) => leaf.view.getViewType() === WORKBENCH_VIEW_TYPE)
			.map((leaf) => {
				// Read from the saved state: a restored leaf may still be deferred (its view not built).
				const saved = leaf.getViewState();
				return { leaf, pinned: !!(saved.pinned ?? (leaf as unknown as { pinned?: boolean }).pinned), transient: readViewState(saved.state).transient === true };
			});
	}

	/** "Never": the transient Workbenches of the last session go back to being empty tabs. */
	private async forgetTransients(): Promise<void> {
		const benches = this.restored();
		for (const i of startupPlan(benches, false).empty) {
			if (this.disposed) return;
			await benches[i].leaf.setViewState({ type: EMPTY_VIEW });
		}
	}

	/**
	 * Moves a leaf to the front of its tab group, through Obsidian's public API: a new leaf there
	 * takes its view state (tabs, scroll, pinned), then the old one closes. Returns the leaf now first.
	 */
	private async toFront(leaf: WorkspaceLeaf): Promise<WorkspaceLeaf> {
		const group = leaf.parent as unknown as { children?: unknown[] } | null;
		if (!group || !Array.isArray(group.children) || group.children.indexOf(leaf) <= 0) return leaf;
		const state = leaf.getViewState();
		const front = this.app.workspace.createLeafInParent(group as never, 0);
		await front.setViewState({ ...state, active: false });
		leaf.detach();
		return front;
	}

	private async openAtStartup(): Promise<void> {
		const workspace = this.app.workspace;
		const tabId = this.core.autoOpenTab;
		const main = this.mainLeaves();
		const benches = this.restored();
		const plan = startupPlan(benches, true);
		// New tabs of the last session showing Home: the startup Workbench stands for them.
		for (const i of plan.close) benches[i].leaf.detach();
		let leaf = plan.keep >= 0 ? benches[plan.keep].leaf : null;
		if (leaf) {
			leaf = await this.toFront(leaf);
			if (this.disposed) return;
			const view = await this.core.viewOf(leaf);
			if (view) {
				view.setTransient(false);
				await view.select(tabId);
			}
		} else {
			if (main.length === 1 && main[0].view.getViewType() === EMPTY_VIEW) leaf = main[0];
			else {
				const group = this.firstGroup();
				leaf = group ? workspace.createLeafInParent(group, 0) : workspace.getLeaf("tab");
			}
			await leaf.setViewState({ type: WORKBENCH_VIEW_TYPE, state: { activeTab: tabId, tabs: {} } });
		}
		if (this.disposed) return;
		leaf.setPinned(true);
		await workspace.revealLeaf(leaf);
		workspace.setActiveLeaf(leaf, { focus: !Platform.isMobile });
		const view = await this.core.viewOf(leaf);
		view?.syncLayout();
		view?.focusTab();
	}

	/**
	 * Obsidian focuses the restored note before the startup Workbench is up (from the plugin's
	 * load to the end of the startup opening, unless the mode is "never"): what is typed in
	 * between is meant for the Workbench's search, never for the note. Typed characters are held
	 * and given to the field that has the focus once the Workbench is open (Enter, Backspace,
	 * Delete and Tab are dropped). Desktop only: phones put no focus in a field.
	 */
	private holdKeys(): void {
		if (Platform.isMobile) return;
		const win = window;
		const held: string[] = [];
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (this.core.autoOpenMode === "never" || !target?.closest?.(".workspace-leaf-content[data-type='markdown']")) return;
			if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
			if (event.key.length === 1) held.push(event.key);
			else if (!["Enter", "Backspace", "Delete", "Tab"].includes(event.key)) return;
			event.preventDefault();
			event.stopPropagation();
		};
		win.addEventListener("keydown", onKey, true);
		this.releaseKeys = () => {
			this.releaseKeys = null;
			win.removeEventListener("keydown", onKey, true);
			const field = win.document.activeElement as HTMLInputElement | null;
			if (!held.length || field?.tagName !== "INPUT" || field.closest(".workspace-leaf-content[data-type='markdown']")) return;
			const end = field.selectionEnd ?? field.value.length;
			field.setRangeText(held.join(""), field.selectionStart ?? end, end, "end");
			field.dispatchEvent(new Event("input", { bubbles: true }));
		};
	}

	/** An empty tab of the main area may be a new tab: checked again a frame later. */
	private newTabSoon(): void {
		if (this.disposed || !this.layoutReady || !this.startupDone || this.core.autoOpenMode !== "startup-and-new-tabs") return;
		const leaf = this.activeLeaf();
		if (!leaf || this.checking.has(leaf) || !this.isNewTab(leaf)) return;
		this.checking.add(leaf);
		const win = leaf.view.containerEl.win ?? window;
		win.requestAnimationFrame(() => {
			win.setTimeout(() => {
				this.checking.delete(leaf);
				if (this.disposed || this.core.autoOpenMode !== "startup-and-new-tabs") return;
				if (this.activeLeaf() !== leaf || !this.isNewTab(leaf)) return;
				void this.replace(leaf);
			}, 0);
		});
	}

	private activeLeaf(): WorkspaceLeaf | null {
		const leaf = this.app.workspace.getActiveViewOfType(View)?.leaf;
		return leaf && !isSideLeaf(this.app, leaf) ? leaf : null;
	}

	private isNewTab(leaf: WorkspaceLeaf): boolean {
		return leaf.view?.getViewType() === EMPTY_VIEW && !isSideLeaf(this.app, leaf) && !!leaf.parent;
	}

	private async replace(leaf: WorkspaceLeaf): Promise<void> {
		try {
			await leaf.setViewState({ type: WORKBENCH_VIEW_TYPE, active: true, state: { activeTab: this.core.autoOpenTab, tabs: {}, transient: true } });
			if (this.disposed || !(leaf.view instanceof WorkbenchView)) return;
			leaf.view.syncLayout();
			leaf.view.focusTab();
		} catch (error) {
			console.error("[Snailkit] workbench: could not open in the new tab", error);
		}
	}

	dispose(): void {
		this.disposed = true;
		this.releaseKeys?.();
		this.checking.clear();
	}
}
