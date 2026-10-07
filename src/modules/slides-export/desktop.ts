import { Platform } from "obsidian";

interface DialogOptions {
	title: string;
	defaultPath: string;
	filters: Array<{ name: string; extensions: string[] }>;
}
interface DialogResult { canceled: boolean; filePath?: string }
interface Remote {
	dialog: {
		showSaveDialog(parent: unknown, options: DialogOptions): Promise<DialogResult>;
		showSaveDialog(options: DialogOptions): Promise<DialogResult>;
	};
	getCurrentWindow?(): unknown;
}
export interface Desktop {
	remote: Remote;
	fs: { promises: { writeFile(path: string, data: Uint8Array): Promise<void> } };
	path: { join(...paths: string[]): string; dirname(path: string): string };
}

// Called only for a desktop export. Importing this file never loads Node or Electron.
export function loadDesktop(): Desktop | null {
	if (!Platform.isDesktopApp) return null;
	try {
		const load = (window as unknown as { require?: (id: string) => unknown }).require;
		if (!load) return null;
		const remote = (load("electron") as { remote?: Remote })?.remote;
		if (!remote?.dialog) return null;
		return { remote, fs: load("fs") as Desktop["fs"], path: load("path") as Desktop["path"] };
	} catch {
		return null;
	}
}

export async function askWhereToSave(desktop: Desktop, options: DialogOptions): Promise<DialogResult> {
	let parent: unknown = null;
	try { parent = desktop.remote.getCurrentWindow?.() ?? null; } catch { /* Use an unparented dialog. */ }
	return parent ? desktop.remote.dialog.showSaveDialog(parent, options) : desktop.remote.dialog.showSaveDialog(options);
}
