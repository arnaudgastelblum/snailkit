import { normalizePath, TFolder, type App } from "obsidian";

/** Creates a folder and its parents when missing. Empty path means the vault root. */
export async function ensureFolder(app: App, path: string): Promise<string> {
	const clean = normalizePath(path.trim() || "/");
	if (clean === "/" || clean === "") return "";
	const existing = app.vault.getAbstractFileByPath(clean);
	if (existing instanceof TFolder) return clean;
	if (existing) throw new Error(`"${clean}" exists and is not a folder`);
	let current = "";
	for (const part of clean.split("/")) {
		current = current ? `${current}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(current)) {
			try {
				await app.vault.createFolder(current);
			} catch (e) {
				// Created in the meantime (another plugin, sync): fine.
				if (!(app.vault.getAbstractFileByPath(current) instanceof TFolder)) throw e;
			}
		}
	}
	return clean;
}

export function joinPath(folder: string, name: string): string {
	return normalizePath(folder ? `${folder}/${name}` : name);
}

/** "folder/Name.md", then "folder/Name 1.md", "folder/Name 2.md"... */
export function availablePath(app: App, folder: string, base: string, ext: string): string {
	let path = joinPath(folder, `${base}${ext}`);
	for (let i = 1; app.vault.getAbstractFileByPath(path) && i < 1000; i++) path = joinPath(folder, `${base} ${i}${ext}`);
	return path;
}
