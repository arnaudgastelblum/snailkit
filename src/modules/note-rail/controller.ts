// Keeps one rail on every Markdown view (every tab, split and popout window) in sync with the
// layout, the open file, its metadata and the settings, and owns the module's commands.
import { MarkdownView, moment, Notice, TFile, type TAbstractFile } from "obsidian";
import type { ModuleContext } from "../../core/context";
import type { Vars } from "../../i18n";
import { PinNoteModal } from "./panels/bookmarks/candidates";
import { getDailyConfig, getOrCreateDailyNote } from "./panels/calendar/daily";
import { tocEditorExtension } from "./panels/toc/highlight";
import { cancelAllScrolls } from "./panels/toc/scroll";
import { clearAllFlashes } from "./panels/toc/surface";
import { Rail } from "./rail/Rail";
import { cleanVaultPins, remapVaultPins } from "./settings";
import type { NoteRailSettings, PanelId, RailEnv } from "./types";

type Context = ModuleContext<NoteRailSettings>;

/** Page preview source (Ctrl or Cmd hover on a bookmark or a calendar day). */
const HOVER_SOURCE = "snailkit-note-rail";

interface HoverLinkSources {
	registerHoverLinkSource?(id: string, info: { display: string; defaultMod: boolean }): void;
	unregisterHoverLinkSource?(id: string): void;
}

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

	constructor(private ctx: Context) {
		this.env = {
			app: ctx.app,
			get settings() {
				return ctx.settings;
			},
			lang: ctx.lang,
			hoverSource: HOVER_SOURCE,
			t: (key: string, vars?: Vars) => ctx.t(key, vars),
			tn: (key: string, count: number, vars?: Vars) => ctx.tn(key, count, vars),
			updateSettings: async (mutate) => {
				mutate(ctx.settings);
				ctx.settings.vaultPins = cleanVaultPins(ctx.settings.vaultPins);
				await ctx.saveSettings();
			},
		};
	}

	start(): void {
		const { ctx } = this;
		const ws = ctx.app.workspace;
		ctx.register(() => this.stop());
		ctx.registerEditorExtension(tocEditorExtension);
		ctx.onSettingsChange(() => {
			for (const rail of this.rails.values()) rail.sync(true);
		});

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

	/** Everything the module put on screen goes away: rails, panels, marks, scroll animations, modals. */
	private stop(): void {
		this.disposed = true;
		for (const modal of Array.from(this.modals)) modal.close();
		this.modals.clear();
		if (this.syncFrame) window.cancelAnimationFrame(this.syncFrame);
		this.syncFrame = 0;
		for (const rail of this.rails.values()) rail.destroy();
		this.rails.clear();
		cancelAllScrolls();
		clearAllFlashes();
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
		const pins = cleanVaultPins(this.ctx.settings.vaultPins);
		const next = remapVaultPins(pins, oldPath ?? file.path, oldPath === null ? null : file.path, file instanceof TFile);
		if (!next) return;
		void this.env.updateSettings((s) => {
			s.vaultPins = next;
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
