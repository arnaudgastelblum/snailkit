// Pure settings operations. vaultPins remains the membership authority for older callers.
import type { VaultPinGroups, VaultPinFolder } from "../../core/services";
import { cleanVaultPins, remapVaultPins } from "./settings";

export function readPinGroups(pins: unknown, stored: unknown): VaultPinGroups {
	const all = cleanVaultPins(pins);
	const remaining = new Set(all);
	const ids = new Set<string>();
	const folders: VaultPinFolder[] = [];
	for (const item of (Array.isArray(stored) ? stored : []) as unknown[]) {
		if (!item || typeof item !== "object") continue;
		const raw = item as Record<string, unknown>;
		if (!raw || typeof raw.id !== "string" || !raw.id.trim() || ids.has(raw.id)
			|| typeof raw.name !== "string" || !raw.name.trim()) continue;
		ids.add(raw.id);
		const members = cleanVaultPins(raw.pins).filter((path) => {
			if (!remaining.has(path)) return false;
			remaining.delete(path);
			return true;
		});
		folders.push({ id: raw.id, name: raw.name.trim(), pins: members });
	}
	return { loose: all.filter((path) => remaining.has(path)), folders };
}

export function flattenPinGroups(groups: VaultPinGroups): string[] {
	return [...groups.loose, ...groups.folders.flatMap((folder) => folder.pins)];
}

export type PinEdit =
	| { kind: "remove"; path: string }
	| { kind: "move"; path: string; index: number; folderId?: string | null }
	| { kind: "create-folder"; id: string; name: string }
	| { kind: "rename-folder"; id: string; name: string }
	| { kind: "delete-folder"; id: string }
	| { kind: "move-folder"; id: string; index: number };

const indexIn = (index: number, length: number): number => Number.isNaN(index) ? length : Math.max(0, Math.min(length, Math.trunc(index)));

/** Never mutates its input; missing pins/folders and blank names are no-ops. */
export function editPinGroups(source: VaultPinGroups, edit: PinEdit): VaultPinGroups {
	const groups = readPinGroups(flattenPinGroups(source), source.folders);
	if (edit.kind === "remove" || edit.kind === "move") {
		const destination = edit.kind === "move" && edit.folderId ? groups.folders.find((f) => f.id === edit.folderId)?.pins : groups.loose;
		if (!destination || !flattenPinGroups(groups).includes(edit.path)) return groups;
		for (const list of [groups.loose, ...groups.folders.map((f) => f.pins)]) {
			const from = list.indexOf(edit.path);
			if (from >= 0) list.splice(from, 1);
		}
		if (edit.kind === "move") destination.splice(indexIn(edit.index, destination.length), 0, edit.path);
		return groups;
	}
	const folder = groups.folders.find((f) => f.id === edit.id);
	if (edit.kind === "create-folder") {
		if (!folder && edit.id.trim() && edit.name.trim()) groups.folders.push({ id: edit.id, name: edit.name.trim(), pins: [] });
	} else if (folder) {
		if (edit.kind === "rename-folder" && edit.name.trim()) folder.name = edit.name.trim();
		if (edit.kind === "delete-folder") {
			groups.loose.push(...folder.pins);
			groups.folders.splice(groups.folders.indexOf(folder), 1);
		}
		if (edit.kind === "move-folder") {
			groups.folders.splice(groups.folders.indexOf(folder), 1);
			groups.folders.splice(indexIn(edit.index, groups.folders.length), 0, folder);
		}
	}
	return groups;
}

export function remapPinGroups(groups: VaultPinGroups, from: string, to: string | null, isFile: boolean): VaultPinGroups {
	const remap = (pins: string[]) => remapVaultPins(pins, from, to, isFile) ?? [...pins];
	const folders = groups.folders.map((folder) => ({ ...folder, pins: remap(folder.pins) }));
	return readPinGroups([...remap(groups.loose), ...folders.flatMap((f) => f.pins)], folders);
}
