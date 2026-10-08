// Keeps one rail on every Markdown view (every tab, split and popout window) in sync with the
// layout, the open file, its metadata and the settings, and owns the module's commands.
import { MarkdownView, Notice, TFile, type TAbstractFile } from "obsidian";
import type { ModuleContext } from "../../core/context";
import type { NoteRailService } from "../../core/services";
import type { Vars } from "../../i18n";
import { getVaultPins } from "./pins";
import { PinNoteModal } from "./panels/bookmarks/candidates";
import { getDailyConfig, getOrCreateDailyNote } from "./panels/calendar/daily";
import { tocEditorExtension } from "./panels/toc/highlight";
import { cancelAllScrolls } from "./panels/toc/scroll";
import { clearAllFlashes } from "./panels/toc/surface";
import { countDue } from "./panels/tasks/summary";
import { Rail } from "./rail/Rail";
import { cleanVaultPins } from "./settings";
import { editPinGroups, flattenPinGroups, readPinGroups, remapPinGroups, type PinEdit } from "./vault-pins";
import type { NoteRailSettings, PanelId, RailEnv, TasksService, VaultTaskCounts, WorkbenchOptions } from "./types";
import { moment } from "../../core/moment";

type Context = ModuleContext<NoteRailSettings>;

/** Page preview source (Ctrl or Cmd hover on a bookmark or a calendar day). */
const HOVER_SOURCE = "snailkit-note-rail";

interface HoverLinkSources {
	registerHoverLinkSource?(id: string, info: { display: string; defaultMod: boolean }): void;
	unregisterHoverLinkSource?(id: string): void;
}

/** Vault task changes come in bursts (typing in a note): counted again after a short pause. */
const VAULT_TASKS_DELAY = 250;

const PANEL_COMMANDS: { id: string; panel: PanelId; icon: string }[] = [
	{ id: "open-contents", panel: "toc", icon: "list-tree" },
	{ id: "open-bookmarks", panel: "bookmarks", icon: "bookmark" },
	{ id: "open-tasks", panel: "tasks", icon: "list-checks" },
	{ id: "open-calendar", panel: "calendar", icon: "calendar-days" },
];

export class NoteRailController {
	private rails = new Map<MarkdownView, Rail>();
	private syncFrame = 0;
	private disposed = false;
	private modals = new Set<PinNoteModal>();
	private readonly env: RailEnv;
	/** The Tasks module's service we listen to, and what it says is due (null while it is off). */
	private tasks: TasksService | null = null;
	private tasksOff: (() => void) | null = null;
	private vault: { day: string; counts: VaultTaskCounts } | null = null;
	private vaultTimer = 0;
	/** Fires just after local midnight: what was "today" becomes overdue. */
	private midnightTimer = 0;
	/** Listeners of the "note-rail" service's onPinsChange, and the pins they last heard of. */
	private pinListeners = new Set<() => void>();
	private pinsSeen = "";

	constructor(private ctx: Context) {
		this.env = {
			app: ctx.app,
			get settings() {
				return ctx.settings;
			},
			lang: ctx.lang,
			hoverSource: HOVER_SOURCE,
			service: <T>(name: string) => ctx.service<T>(name),
			vaultTasks: () => this.vaultTasks(),
			openWorkbench: (options?: WorkbenchOptions) => this.openWorkbench(options),
			t: (key: string, vars?: Vars) => ctx.t(key, vars),
			tn: (key: string, count: number, vars?: Vars) => ctx.tn(key, count, vars),
			updateSettings: async (mutate) => {
				mutate(ctx.settings);
				const groups = readPinGroups(ctx.settings.vaultPins, ctx.settings.vaultPinFolders);
				ctx.settings.vaultPins = flattenPinGroups(groups);
				ctx.settings.vaultPinFolders = groups.folders;
				await ctx.saveSettings();
			},
		};
	}

	start(): void {
		const { ctx } = this;
		const ws = ctx.app.workspace;
		ctx.register(() => this.stop());
		ctx.registerEditorExtension(tocEditorExtension);
		// Where a note belongs ("places") is published by the core now. This module shares its vault
		// pins and its daily notes settings (Home, Search).
		this.pinsSeen = JSON.stringify(readPinGroups(ctx.settings.vaultPins, ctx.settings.vaultPinFolders));
		ctx.provide<NoteRailService>("note-rail", this.service());
		ctx.onSettingsChange(() => {
			for (const rail of this.rails.values()) rail.sync(true);
			this.pinsChanged();
		});
		// The session button, the Search magnifier and the pill's click follow their modules as they come and go.
		ctx.onServicesChange(() => {
			this.followTasks();
			for (const rail of this.rails.values()) rail.sync(false);
		});
		this.followTasks();
		this.armMidnight();

		ctx.registerEvent(ws.on("layout-change", () => this.queueSync()));
		ctx.registerEvent(ws.on("active-leaf-change", () => this.queueSync()));
		ctx.registerEvent(ws.on("file-open", () => this.queueSync()));
		ctx.registerEvent(ws.on("window-open", () => this.queueSync()));
		ctx.registerEvent(ctx.app.metadataCache.on("changed", (file) => {
			for (const rail of this.rails.values()) rail.sync(rail.view.file === file);
		}));
		ctx.registerEvent(ctx.app.vault.on("rename", (file, oldPath) => {
			this.followVaultPins(file, oldPath);
			this.queueSync();
		}));
		ctx.registerEvent(ctx.app.vault.on("delete", (file) => {
			this.followVaultPins(file, null);
			this.queueSync();
		}));
		ctx.registerEvent(ctx.app.vault.on("create", () => this.queueSync()));
		// The rule of parents changed (a home page or ignored folders set in the Home module): pills follow.
		ctx.register(ctx.places.onChange(() => this.queueSync()));

		// Ctrl/Cmd hover shows Obsidian's page preview (core plugin Page preview), listed under our name.
		const sources = ws as unknown as HoverLinkSources;
		if (sources.registerHoverLinkSource && sources.unregisterHoverLinkSource) {
			sources.registerHoverLinkSource(HOVER_SOURCE, { display: `${ctx.plugin.manifest.name}: ${ctx.t("module.name")}`, defaultMod: true });
			ctx.register(() => sources.unregisterHoverLinkSource?.(HOVER_SOURCE));
		}

		ws.onLayoutReady(() => {
			if (!this.disposed) this.syncRails();
		});
		this.addCommands();
	}

	private addCommands(): void {
		const { ctx } = this;
		for (const command of PANEL_COMMANDS) {
			ctx.addCommand({
				id: command.id,
				name: ctx.t(`command.${command.id}`),
				icon: command.icon,
				checkCallback: (checking) => this.panelCommand(command.panel, checking),
			});
		}
		ctx.addCommand({
			id: "open-today",
			name: ctx.t("command.open-today"),
			icon: "calendar-check",
			callback: () => void this.openToday(),
		});
		ctx.addCommand({
			id: "pin-to-vault",
			name: ctx.t("command.pin-to-vault"),
			icon: "pin",
			checkCallback: (checking) => {
				const file = ctx.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (checking) return true;
				const pinned = cleanVaultPins(ctx.settings.vaultPins).includes(file.path);
				void this.env.updateSettings((s) => {
					const pins = cleanVaultPins(s.vaultPins);
					s.vaultPins = pinned ? pins.filter((p) => p !== file.path) : [...pins, file.path];
				});
				ctx.toast(ctx.t(pinned ? "notice.vault-unpinned" : "notice.vault-pinned", { name: file.basename }));
				return true;
			},
		});
		ctx.addCommand({
			id: "pin-note-here",
			name: ctx.t("command.pin-note-here"),
			icon: "plus",
			checkCallback: (checking) => {
				const file = ctx.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) {
					const modal: PinNoteModal = new PinNoteModal(this.env, file, () => !this.disposed, () => this.modals.delete(modal));
					this.modals.add(modal);
					modal.open();
				}
				return true;
			},
		});
	}

	/** The "note-rail" service (src/core/services.ts): the vault pins of the Bookmarks panel, and where daily notes are. */
	private service(): NoteRailService {
		const { ctx } = this;
		const edit = async (change: PinEdit): Promise<void> => {
			if (this.disposed) return;
			await this.env.updateSettings((s) => {
				const next = editPinGroups(readPinGroups(s.vaultPins, s.vaultPinFolders), change);
				s.vaultPins = flattenPinGroups(next);
				s.vaultPinFolders = next.folders;
			});
		};
		return {
			version: 1,
			listPins: () => this.disposed ? { loose: [], folders: [] } : readPinGroups(ctx.settings.vaultPins, ctx.settings.vaultPinFolders),
			removePin: (path) => edit({ kind: "remove", path }),
			movePin: (path, index, folderId) => edit({ kind: "move", path, index, folderId }),
			createPinFolder: async (name) => {
				if (this.disposed || !name.trim()) return null;
				const id = crypto.randomUUID();
				await edit({ kind: "create-folder", id, name });
				return id;
			},
			renamePinFolder: (id, name) => edit({ kind: "rename-folder", id, name }),
			deletePinFolder: (id) => edit({ kind: "delete-folder", id }),
			movePinFolder: (id, index) => edit({ kind: "move-folder", id, index }),
			vaultPins: () => (this.disposed ? [] : getVaultPins(ctx.app, ctx.settings).map((file) => file.path)),
			isPinned: (path) => !this.disposed && cleanVaultPins(ctx.settings.vaultPins).includes(path),
			setPinned: async (path, pinned) => {
				if (this.disposed || typeof path !== "string" || !path) return;
				if (pinned && !(ctx.app.vault.getAbstractFileByPath(path) instanceof TFile)) return;
				const pins = cleanVaultPins(ctx.settings.vaultPins);
				if (pins.includes(path) === !!pinned) return;
				await this.env.updateSettings((s) => {
					const now = cleanVaultPins(s.vaultPins);
					s.vaultPins = pinned ? (now.includes(path) ? now : [...now, path]) : now.filter((p) => p !== path);
				});
			},
			onPinsChange: (callback) => {
				if (this.disposed || typeof callback !== "function") return () => undefined;
				this.pinListeners.add(callback);
				return () => {
					this.pinListeners.delete(callback);
				};
			},
			dailyConfig: () => getDailyConfig(ctx.app, ctx.settings),
		};
	}

	/** Tells the service's listeners when the vault pins changed (here, from another device, or by a rename). */
	private pinsChanged(): void {
		const now = JSON.stringify(readPinGroups(this.ctx.settings.vaultPins, this.ctx.settings.vaultPinFolders));
		if (now === this.pinsSeen) return;
		this.pinsSeen = now;
		for (const callback of [...this.pinListeners]) {
			try {
				callback();
			} catch (err) {
				console.error("[Snailkit] note-rail: a pins listener failed", err);
			}
		}
	}

	/** Everything the module put on screen goes away: rails, panels, marks, scroll animations, modals. */
	private stop(): void {
		this.disposed = true;
		this.pinListeners.clear();
		window.clearTimeout(this.vaultTimer);
		window.clearTimeout(this.midnightTimer);
		this.safeOff();
		this.tasks = null;
		this.vault = null;
		for (const modal of Array.from(this.modals)) modal.close();
		this.modals.clear();
		if (this.syncFrame) window.cancelAnimationFrame(this.syncFrame);
		this.syncFrame = 0;
		for (const rail of this.rails.values()) rail.destroy();
		this.rails.clear();
		cancelAllScrolls();
		clearAllFlashes();
	}

	// ---- the Tasks module ----------------------------------------------------------

	/** Listen to the Tasks module while it is on (it comes and goes with its module). */
	private followTasks(): void {
		const raw = this.ctx.service<TasksService>("tasks");
		const next = raw && raw.version === 1 && typeof raw.getTasks === "function" && typeof raw.on === "function" ? raw : null;
		if (next === this.tasks) return;
		this.safeOff();
		this.tasks = next;
		this.vault = null;
		if (next) {
			try {
				this.tasksOff = next.on("change", () => this.vaultTasksSoon());
			} catch (err) {
				console.error("[Snailkit] note-rail: tasks service", err);
			}
		}
		this.vaultTasksSoon(0);
	}

	/** At the next local midnight (and every hour at most), badges and summaries count again if the day turned. */
	private armMidnight(): void {
		window.clearTimeout(this.midnightTimer);
		if (this.disposed) return;
		const next = new Date();
		next.setHours(24, 0, 5, 0);
		// Capped at an hour: a sleeping computer or a clock change never leaves it far off.
		const wait = Math.min(Math.max(1000, next.getTime() - Date.now()), 3_600_000);
		this.midnightTimer = window.setTimeout(() => {
			if (this.disposed) return;
			if (this.vault && this.vault.day !== moment().format("YYYY-MM-DD")) this.vaultTasksSoon(0);
			this.armMidnight();
		}, wait);
	}

	private safeOff(): void {
		try {
			this.tasksOff?.();
		} catch {
			/* the Tasks module is already gone */
		}
		this.tasksOff = null;
	}

	private vaultTasksSoon(delay = VAULT_TASKS_DELAY): void {
		if (this.disposed) return;
		window.clearTimeout(this.vaultTimer);
		this.vaultTimer = window.setTimeout(() => {
			if (this.disposed) return;
			this.vault = null;
			for (const rail of this.rails.values()) rail.vaultTasksChanged();
		}, delay);
	}

	/** Overdue and today's tasks of the vault, counted once per change (and again when the day turns). */
	private vaultTasks(): VaultTaskCounts | null {
		const tasks = this.tasks;
		if (!tasks) return null;
		const day = moment().format("YYYY-MM-DD");
		if (this.vault && this.vault.day === day) return this.vault.counts;
		try {
			this.vault = { day, counts: countDue(tasks.getTasks(), day) };
		} catch (err) {
			console.error("[Snailkit] note-rail: could not count the vault tasks", err);
			this.vault = { day, counts: { overdue: 0, today: 0 } };
		}
		return this.vault.counts;
	}

	/**
	 * The Workbench (a view of the core) on a tab (Tasks when missing), with a scope for Tasks.
	 * False when that tab is not there (its module is off) and Tasks neither.
	 */
	private openWorkbench(options?: WorkbenchOptions): boolean {
		const workbench = this.ctx.workbench;
		const wanted = options?.tab ?? "tasks";
		const tab = workbench.hasTab(wanted) ? wanted : workbench.hasTab("tasks") ? "tasks" : null;
		if (!tab) return false;
		const state = tab === "tasks" && options?.scope ? { scope: options.scope } : undefined;
		workbench.open({ tab, state }).catch((err) => console.error("[Snailkit] note-rail: could not open the Workbench", err));
		return true;
	}

	/** Toggle a panel on the active note's rail. */
	private panelCommand(id: PanelId, checking: boolean): boolean {
		const view = this.ctx.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || !view.file) return false;
		if (checking) return true;
		this.syncRails();
		const rail = this.rails.get(view);
		if (!rail) return false;
		if (!rail.toggle(id, true)) new Notice(this.ctx.t("notice.panel-unavailable"));
		return true;
	}

	/** Today's daily note (created from the template if missing) in the active pane. */
	private async openToday(): Promise<void> {
		const key = moment().format("YYYY-MM-DD");
		try {
			const file = await getOrCreateDailyNote(this.ctx.app, key, getDailyConfig(this.ctx.app, this.ctx.settings));
			if (this.disposed) return;
			await this.ctx.app.workspace.getLeaf(false).openFile(file);
		} catch (err) {
			console.error("[Snailkit] note-rail: could not open today's daily note", err);
			new Notice(this.ctx.t("notice.today-error"));
		}
	}

	/** Vault pins are paths: follow renames (files and folders) and drop deleted notes. */
	private followVaultPins(file: TAbstractFile, oldPath: string | null): void {
		const pins = readPinGroups(this.ctx.settings.vaultPins, this.ctx.settings.vaultPinFolders);
		const next = remapPinGroups(pins, oldPath ?? file.path, oldPath === null ? null : file.path, file instanceof TFile);
		if (JSON.stringify(next) === JSON.stringify(pins)) return;
		void this.env.updateSettings((s) => {
			s.vaultPins = flattenPinGroups(next);
			s.vaultPinFolders = next.folders;
		});
	}

	private queueSync(): void {
		if (this.disposed || this.syncFrame) return;
		this.syncFrame = window.requestAnimationFrame(() => {
			this.syncFrame = 0;
			if (!this.disposed) this.syncRails();
		});
	}

	/** Mount a rail on every Markdown view, drop rails of closed views, sync the others. */
	private syncRails(): void {
		if (this.disposed) return;
		const live = new Set<MarkdownView>();
		this.ctx.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) live.add(leaf.view);
		});
		for (const [view, rail] of this.rails) {
			if (!live.has(view)) {
				rail.destroy();
				this.rails.delete(view);
			}
		}
		for (const view of live) {
			const rail = this.rails.get(view);
			if (!rail) this.rails.set(view, new Rail(this.env, view));
			else rail.sync(false);
		}
	}
}
