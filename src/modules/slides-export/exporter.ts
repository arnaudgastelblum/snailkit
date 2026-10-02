import { Notice, Platform, TFile, TFolder } from "obsidian";
import type { ModuleContext } from "../../core/context";
import { unavailableReason } from "./availability";
import { askWhereToSave, loadDesktop } from "./desktop";
import { buildSlides, exportAreaFor, folderPath, presentationTitle, renderScale, SLIDE_SIZES, validFolder, validRectangle, vaultPptxPath, withPptxExtension } from "./logic";
import { buildPptx, pngDimensions, slideBackground, type RenderedSlide } from "./pptx";
import type { Automate, DrawingView, SlidesSettings } from "./types";

class Cancelled extends Error {}

// Shared across activations: disabling and re-enabling cannot start a second render
// while Excalidraw is still finishing the first one.
const running = new WeakSet<object>();

export class SlidesExporter {
	private stopped = false;
	private progress: Notice | null = null;
	constructor(private readonly ctx: ModuleContext<SlidesSettings>) {}

	cancel(): void {
		this.stopped = true;
		this.progress?.hide();
		this.progress = null;
	}

	private check(): void {
		if (this.stopped) throw new Cancelled();
		const reason = unavailableReason(this.ctx.app, (key) => this.ctx.t(key));
		if (reason) throw new Error(reason);
	}

	private say(message: string): void {
		new Notice(`${this.ctx.t("module.name")}: ${message}`);
	}

	async exportView(view: DrawingView): Promise<void> {
		const ctx = this.ctx;
		if (this.stopped) return;
		if (running.has(ctx.app)) { this.say(ctx.t("notice.busy")); return; }
		running.add(ctx.app);
		try {
			this.check();
			const ea = (window as unknown as { ExcalidrawAutomate?: Automate }).ExcalidrawAutomate;
			if (!ea || typeof ea.createViewPNG !== "function" || typeof ea.setView !== "function" || typeof ea.getViewElements !== "function" || typeof ea.getExcalidrawAPI !== "function") {
				throw new Error(ctx.t("notice.api"));
			}
			const file = view.file;
			this.progress = new Notice(ctx.t("notice.reading"), 0);
			ea.setView(view);
			const slides = buildSlides(ea.getViewElements());
			if (!slides.length) { this.say(ctx.t("notice.empty")); return; }
			if (slides.some((slide) => !validRectangle(slide))) throw new Error(ctx.t("notice.geometry"));
			const desktop = !Platform.isMobile && ctx.settings.saveMode === "ask" ? loadDesktop() : null;
			let diskPath: string | null = null;
			if (desktop) {
				this.progress.setMessage(ctx.t("notice.choose"));
				const name = `${presentationTitle(file)}.pptx`;
				const result = await askWhereToSave(desktop, {
					title: ctx.t("command.export"),
					defaultPath: ctx.settings.lastSaveDir ? desktop.path.join(ctx.settings.lastSaveDir, name) : name,
					filters: [{ name: "PowerPoint", extensions: ["pptx"] }],
				});
				this.check();
				if (!result || result.canceled || !result.filePath) { this.say(ctx.t("notice.cancelled")); return; }
				diskPath = withPptxExtension(result.filePath);
			}
			// Read current preferences after the dialog. Keep one size/theme/background for
			// the entire deck so changing a setting cannot produce mismatched bands.
			const size = SLIDE_SIZES[ctx.settings.slideSize] ?? SLIDE_SIZES["16:9"];
			ea.setView(view);
			const state = ea.getExcalidrawAPI().getAppState();
			const theme = ["light", "dark"].includes(ctx.settings.theme) ? ctx.settings.theme : state.theme;
			const background = ctx.settings.withBackground;
			const requestedWidth = Number(ctx.settings.imageWidth);
			const imageWidth = [1280, 1920, 2560, 3840].includes(requestedWidth) ? requestedWidth : 1920;
			const rendered: RenderedSlide[] = [];
			for (let i = 0; i < slides.length; i++) {
				this.check();
				this.progress.setMessage(ctx.t("notice.rendering", { current: i + 1, total: slides.length }));
				// Other scripts can change the shared Automate target between slides.
				ea.setView(view);
				const blob = await ea.createViewPNG({
					withBackground: background, theme,
					frameRendering: { enabled: true, clip: true, name: false, outline: false },
					padding: 0, selectedOnly: false, embedScene: false,
					exportArea: exportAreaFor(slides[i]), scale: renderScale(slides[i], size, imageWidth),
				});
				this.check();
				if (!blob) throw new Error(ctx.t("notice.image", { title: slides[i].title }));
				const png = new Uint8Array(await blob.arrayBuffer());
				this.check();
				let dimensions: { width: number; height: number };
				try { dimensions = pngDimensions(png); } catch { throw new Error(ctx.t("notice.image", { title: slides[i].title })); }
				rendered.push({ title: slides[i].title, png, ...dimensions });
			}
			this.progress.setMessage(ctx.t("notice.writing"));
			const bytes = buildPptx({ slides: rendered, size, background: background ? slideBackground(state.viewBackgroundColor, theme) : null, title: presentationTitle(file), date: new Date() });
			this.check();
			let savedPath: string;
			if (desktop && diskPath) {
				await desktop.fs.promises.writeFile(diskPath, bytes);
				this.check();
				ctx.settings.lastSaveDir = desktop.path.dirname(diskPath);
				await ctx.saveSettings();
				savedPath = diskPath;
			} else {
				const folder = folderPath(ctx.settings.outputFolder || file.parent?.path || "");
				if (!validFolder(folder)) throw new Error(ctx.t("notice.folder"));
				let current = "";
				for (const part of folder.split("/").filter(Boolean)) {
					this.check();
					current = current ? `${current}/${part}` : part;
					const existing = ctx.app.vault.getAbstractFileByPath(current);
					if (existing && !(existing instanceof TFolder)) throw new Error(ctx.t("notice.folder"));
					if (!existing) {
						try { await ctx.app.vault.createFolder(current); }
						catch (error) { if (!(ctx.app.vault.getAbstractFileByPath(current) instanceof TFolder)) throw error; }
					}
				}
				this.check();
				savedPath = vaultPptxPath(folder, file.basename);
				const existing = ctx.app.vault.getAbstractFileByPath(savedPath);
				const buffer = new Uint8Array(bytes).buffer;
				if (existing instanceof TFile) await ctx.app.vault.modifyBinary(existing, buffer);
				else if (existing) throw new Error(ctx.t("notice.folder"));
				else await ctx.app.vault.createBinary(savedPath, buffer);
			}
			this.check();
			this.say(ctx.tn("notice.saved", slides.length, { path: savedPath }));
		} catch (error) {
			if (!this.stopped && !(error instanceof Cancelled)) {
				console.error("[Snailkit] slides-export", error);
				this.say(ctx.t("notice.failed", { message: error instanceof Error ? error.message : String(error) }));
			}
		} finally {
			this.progress?.hide();
			this.progress = null;
			running.delete(ctx.app);
		}
	}
}
