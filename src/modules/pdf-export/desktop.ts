// Desktop-only access to Electron and Node. Nothing here is loaded at import time: the Snailkit
// bundle also runs on mobile, where these modules do not exist. Only the export path calls
// `loadDesktop()`, and the module is desktop only.
import { Platform } from "obsidian";
import type { PrintOptions } from "./logic";

/** The few Electron types the export uses, declared here instead of adding a package. */
export interface PrintWindow {
	loadFile(path: string): Promise<void>;
	webContents: {
		executeJavaScript(code: string): Promise<unknown>;
		printToPDF(options: PrintOptions): Promise<Uint8Array>;
	};
	destroy(): void;
	isDestroyed?(): boolean;
}

interface SaveDialogOptions {
	title: string;
	defaultPath: string;
	filters: Array<{ name: string; extensions: string[] }>;
}

interface SaveDialogResult {
	canceled: boolean;
	filePath?: string;
}

export interface Remote {
	BrowserWindow: new (options: Record<string, unknown>) => PrintWindow;
	dialog?: {
		showSaveDialog(parent: unknown, options: SaveDialogOptions): Promise<SaveDialogResult>;
		showSaveDialog(options: SaveDialogOptions): Promise<SaveDialogResult>;
	};
	shell?: { openPath(path: string): Promise<string> };
	getCurrentWindow?(): unknown;
}

export interface Desktop {
	remote: Remote;
	fs: { promises: {
		mkdir(path: string, options: { recursive: true }): Promise<string | undefined>;
		writeFile(path: string, data: string | Uint8Array, encoding?: "utf8"): Promise<void>;
		unlink(path: string): Promise<void>;
	} };
	os: { tmpdir(): string; homedir(): string };
	path: { join(...paths: string[]): string; dirname(path: string): string };
}

/**
 * Electron's remote module (re-exposed by Obsidian in the renderer) and Node's fs, os and path.
 * Null when one of them is out of reach: the export then stops with a notice.
 */
export function loadDesktop(): Desktop | null {
	if (!Platform.isDesktopApp) return null;
	try {
		const load = (window as unknown as { require?: (id: string) => unknown }).require;
		if (typeof load !== "function") return null;
		const electron = load("electron") as { remote?: Remote } | undefined;
		const remote = electron?.remote;
		if (!remote?.BrowserWindow) return null;
		return {
			remote,
			fs: load("fs") as Desktop["fs"],
			os: load("os") as Desktop["os"],
			path: load("path") as Desktop["path"],
		};
	} catch (error) {
		console.warn("[Snailkit] pdf-export: Electron is not available", error);
		return null;
	}
}
