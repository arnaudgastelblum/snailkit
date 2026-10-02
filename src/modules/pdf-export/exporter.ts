// The export pipeline: read the note, render it with Obsidian's engine in a hidden host, take a
// standalone HTML snapshot, print it in a hidden Electron window, save the PDF. The note is only
// ever read. Turning the module off cancels a running export and cleans everything up.
import { Component, MarkdownRenderer, Notice, TFile, type App } from "obsidian";
import type { ModuleContext } from "../../core/context";
import { loadDesktop, type Desktop, type PrintWindow } from "./desktop";
import {
	CLS,
	ExportCancelled,
	WIDTH_VAR,
	backgroundCss,
	contentWidthPx,
	folderPath,
	isDarkScheme,
	linkTarget,
	pageBreakCss,
	prepareMarkdown,
	printOptions,
	tempHtmlName,
	toArrayBuffer,
	vaultPdfPath,
	withTimeout,
} from "./logic";
import { READY_SCRIPT } from "./print-css";
import { snapshot, waitForRender, type SnapshotContext } from "./snapshot";
import type { PdfExportSettings } from "./types";

// How long the export waits for embeds (Excalidraw, Dataview, charts) before printing what is there.
const RENDER_TIMEOUT_MS = 10000;
// Ceilings for each step, so a stuck renderer or print window cannot hang the export.
const MARKDOWN_TIMEOUT_MS = 60000;
const LOAD_TIMEOUT_MS = 30000;
const READY_TIMEOUT_MS = 15000;
const PRINT_TIMEOUT_MS = 120000;
// Subfolder of the OS temporary folder for the page being printed.
const TEMP_DIR = "snailkit-pdf-export";

/** One export in flight: its cancel signal and the cleanups to run if it is cancelled. */
class Run {
	readonly controller = new AbortController();
	private readonly cleanups = new Set<() => void>();

	get signal(): AbortSignal {
		return this.controller.signal;
	}

	/** Registers a cleanup; the returned function runs it once (at the end of its step). */
	defer(cleanup: () => void): () => void {
		const once = () => {
			if (!this.cleanups.delete(once)) return;
			try {
				cleanup();
			} catch (error) {
				console.warn("[Snailkit] pdf-export: cleanup failed", error);
			}
		};
		this.cleanups.add(once);
		return once;
	}

	throwIfCancelled(): void {
		if (this.signal.aborted) throw new ExportCancelled();
	}

	cancel(): void {
		this.controller.abort();
		for (const cleanup of Array.from(this.cleanups)) cleanup();
	}
}

export class PdfExporter {
	private run: Run | null = null;

	constructor(private readonly ctx: ModuleContext<PdfExportSettings>) {}

	private get app(): App {
		return this.ctx.app;
	}

	/** Called when the module is turned off: hidden host, print window and temp file go away. */
	cancel(): void {
		this.run?.cancel();
		this.run = null;
	}

	async exportFile(file: TFile): Promise<void> {
		const { ctx } = this;
		// One export at a time: the render host and the print window are not shared.
		if (this.run) {
			new Notice(ctx.t("notice.busy"));
			return;
		}
		const desktop = loadDesktop();
		if (!desktop) {
			new Notice(ctx.t("error.desktop"));
			return;
		}
		const run = new Run();
		this.run = run;
		const progress = new Notice(ctx.t("notice.exporting", { name: file.basename }), 0);
		const hideProgress = run.defer(() => progress.hide());
		try {
			const raw = await this.app.vault.cachedRead(file);
			run.throwIfCancelled();
			const markdown = prepareMarkdown(raw, file.basename, ctx.settings);
			const html = await this.render(file, markdown, run);
			const pdf = await this.print(html, file, desktop, run);
			const saved = await this.save(pdf, file, desktop, run);
			if (!saved) {
				new Notice(ctx.t("notice.cancelled"));
				return;
			}
			hideProgress();
			ctx.toast(ctx.t("notice.saved", { path: saved.display }), { duration: 5000 });
			if (ctx.settings.openAfterExport) this.open(saved.absPath, desktop);
		} catch (error) {
			// Turned off mid-way: everything is already cleaned up, nothing to say.
			if (error instanceof ExportCancelled || run.signal.aborted) return;
			console.error("[Snailkit] pdf-export: export failed", error);
			new Notice(ctx.t("error.failed", { message: error instanceof Error ? error.message : String(error) }));
		} finally {
			hideProgress();
			if (this.run === run) this.run = null;
		}
	}

	/** Renders the note in a hidden host as wide as the page, waits for the embeds, takes the snapshot. */
	private async render(file: TFile, markdown: string, run: Run): Promise<string> {
		const settings = this.ctx.settings;
		const host = document.body.createDiv({ cls: CLS.host });
		const component = new Component();
		// Frees the children (embeds, Dataview) and removes the host, success, failure or cancel.
		const cleanup = run.defer(() => {
			component.unload();
			host.remove();
		});
		try {
			// Anything that measures its container lays itself out as on paper.
			host.style.setProperty(WIDTH_VAR, contentWidthPx(settings.pageSize, settings.landscape, settings.marginMm) + "px");
			const view = host.createDiv({ cls: `markdown-preview-view markdown-rendered ${CLS.wrap}` });
			const sizer = view.createDiv({ cls: `markdown-preview-sizer markdown-preview-section ${CLS.wrap}` });
			component.load();
			await withTimeout(
				MarkdownRenderer.render(this.app, markdown, sizer, file.path, component),
				MARKDOWN_TIMEOUT_MS,
				"Rendering the note",
				run.signal,
			);
			const settled = await waitForRender(host, RENDER_TIMEOUT_MS, run.signal);
			run.throwIfCancelled();
			if (!settled) new Notice(this.ctx.t("notice.slow"));
			return snapshot(view, this.snapshotContext(file), document);
		} finally {
			cleanup();
		}
	}

	private snapshotContext(file: TFile): SnapshotContext {
		const settings = this.ctx.settings;
		const dark = isDarkScheme(settings.colorScheme, document.body.classList.contains("theme-dark"));
		return {
			basePath: this.basePath().replace(/\\/g, "/"),
			vaultName: this.vaultName(),
			internalLinks: settings.internalLinks,
			resolve: (linkpath) => this.resolveLink(linkpath, file.path),
			title: file.basename,
			colorScheme: settings.colorScheme,
			clickableImages: settings.clickableImages,
			extraCss: [pageBreakCss(settings.pageBreakBefore), backgroundCss(settings.pageBackground, dark)].filter(Boolean).join("\n"),
		};
	}

	/** Prints the HTML in a hidden window. The window and the temporary file never outlive the step. */
	private async print(html: string, file: TFile, desktop: Desktop, run: Run): Promise<Uint8Array> {
		const { fs, os, path, remote } = desktop;
		const dir = path.join(os.tmpdir(), TEMP_DIR);
		const htmlPath = path.join(dir, tempHtmlName(file.basename, Date.now()));
		let win: PrintWindow | null = null;
		// The temporary page holds the note in clear text: removed as soon as printing is over.
		const removeFiles = () => {
			try {
				if (win && !win.isDestroyed?.()) win.destroy();
			} catch (error) {
				console.warn("[Snailkit] pdf-export: could not close the print window", error);
			}
			win = null;
			fs.promises.unlink(htmlPath).catch(() => undefined);
		};
		const cleanup = run.defer(removeFiles);
		try {
			await fs.promises.mkdir(dir, { recursive: true });
			await fs.promises.writeFile(htmlPath, html, "utf8");
			run.throwIfCancelled();
			win = new remote.BrowserWindow({
				show: false,
				width: 1000,
				height: 800,
				webPreferences: {
					nodeIntegration: false,
					contextIsolation: true,
					sandbox: true,
					// The window is hidden: it must still run at full speed.
					backgroundThrottling: false,
					// webSecurity stays on (its default): a file:// page may load file:// images,
					// style sheets and fonts; turning it off would only open the note to the web.
				},
			});
			const printWin = win;
			await withTimeout(printWin.loadFile(htmlPath), LOAD_TIMEOUT_MS, "Loading the print page", run.signal);
			try {
				await withTimeout(printWin.webContents.executeJavaScript(READY_SCRIPT), READY_TIMEOUT_MS, "Waiting for fonts and images", run.signal);
			} catch (error) {
				if (error instanceof ExportCancelled) throw error;
				// Not fatal: print what is loaded.
				console.warn("[Snailkit] pdf-export: print page not fully ready", error);
			}
			return await withTimeout(printWin.webContents.printToPDF(printOptions(this.ctx.settings)), PRINT_TIMEOUT_MS, "Printing", run.signal);
		} finally {
			cleanup();
			// Also when the cancel cleanup ran before the file was written.
			fs.promises.unlink(htmlPath).catch(() => undefined);
		}
	}

	/** Writes the PDF where the settings say. Null when the user cancelled the save dialog. */
	private async save(buffer: Uint8Array, file: TFile, desktop: Desktop, run: Run): Promise<{ display: string; absPath: string } | null> {
		const settings = this.ctx.settings;
		const { fs, os, path, remote } = desktop;
		const name = file.basename + ".pdf";
		// printToPDF answers a Node Buffer through the remote bridge; the Vault API wants an ArrayBuffer.
		const data = toArrayBuffer(buffer);

		if (settings.saveMode === "nextToNote" || settings.saveMode === "folder") {
			const folder = settings.saveMode === "folder" ? folderPath(settings.outputFolder) : this.noteFolder(file);
			await this.ensureFolder(folder);
			run.throwIfCancelled();
			const vaultPath = vaultPdfPath(folder, file.basename);
			const existing = this.app.vault.getAbstractFileByPath(vaultPath);
			// A PDF is a derived artifact: exporting again replaces it.
			if (existing instanceof TFile) await this.app.vault.modifyBinary(existing, data);
			else await this.app.vault.createBinary(vaultPath, data);
			const base = this.basePath();
			return { display: vaultPath, absPath: base ? path.join(base, vaultPath) : vaultPath };
		}

		if (!remote.dialog) throw new Error("no save dialog available");
		const defaultDir = settings.lastSaveDir || this.basePath() || os.homedir();
		const options = {
			title: this.ctx.t("dialog.title"),
			defaultPath: path.join(defaultDir, name),
			filters: [{ name: "PDF", extensions: ["pdf"] }],
		};
		// Attached to the Obsidian window: a parentless dialog can open behind it on Windows and
		// look like a hung export.
		let parent: unknown = null;
		try {
			parent = remote.getCurrentWindow?.() ?? null;
		} catch {
			parent = null;
		}
		const dialog = parent ? remote.dialog.showSaveDialog(parent, options) : remote.dialog.showSaveDialog(options);
		const result = await withTimeout(dialog, 0, "Save dialog", run.signal);
		if (!result || result.canceled || !result.filePath) return null;
		run.throwIfCancelled();
		await fs.promises.writeFile(result.filePath, new Uint8Array(data));
		this.ctx.settings.lastSaveDir = path.dirname(result.filePath);
		await this.ctx.saveSettings();
		return { display: result.filePath, absPath: result.filePath };
	}

	private open(absPath: string, desktop: Desktop): void {
		const shell = desktop.remote.shell;
		if (!shell) return;
		// openPath resolves with an error string, and may reject through the remote bridge:
		// swallow both, an unopened PDF is still exported.
		const warn = (error: unknown) => console.warn("[Snailkit] pdf-export: could not open the PDF", error);
		try {
			shell.openPath(absPath).then((error) => error && warn(error), warn);
		} catch (error) {
			warn(error);
		}
	}

	/** Folder of a note, "" at the vault root. */
	private noteFolder(file: TFile): string {
		const parent = file.parent?.path ?? "";
		return parent === "/" || parent === "." ? "" : parent;
	}

	private async ensureFolder(folder: string): Promise<void> {
		if (!folder) return;
		let current = "";
		for (const part of folder.split("/").filter(Boolean)) {
			current = current ? current + "/" + part : part;
			if (this.app.vault.getAbstractFileByPath(current)) continue;
			try {
				await this.app.vault.createFolder(current);
			} catch {
				// Created meanwhile, or a file already owns the name (the write then says so).
			}
		}
	}

	// Defensive vault helpers: these APIs are desktop specific or not all documented.
	private basePath(): string {
		try {
			const adapter = this.app.vault.adapter as { getBasePath?: () => string };
			return typeof adapter.getBasePath === "function" ? adapter.getBasePath() : "";
		} catch {
			return "";
		}
	}

	private vaultName(): string {
		try {
			return this.app.vault.getName() || "";
		} catch {
			return "";
		}
	}

	/** Vault path of a link target, null when it resolves to nothing. */
	private resolveLink(linkpath: string, sourcePath: string): string | null {
		const target = linkTarget(linkpath);
		if (!target) return null;
		try {
			return this.app.metadataCache.getFirstLinkpathDest(target, sourcePath)?.path ?? null;
		} catch {
			return null;
		}
	}
}
