// Moving and creating notes from the Map: which drops are allowed, and the name of a new note.
// Pure over World; the writing itself is in src/core/places/move.ts.
import { wouldLoop } from "../../../core/places/move";
import { VAULT_ROOT } from "./map";
import type { World } from "./world";

/**
 * Why `moved` may not go under `target`, or null when it may: not onto the vault itself, not
 * onto a note that is gone, not where it already is, and not on itself or below itself (a loop).
 */
export function dropRefusal(world: World, moved: string, target: string): "root" | "gone" | "same" | "loop" | null {
	if (moved === VAULT_ROOT || target === VAULT_ROOT) return "root";
	if (!world.exists(moved) || !world.exists(target)) return "gone";
	if (world.parent(moved) === target) return "same";
	if (wouldLoop(moved, target, (path) => world.parent(path))) return "loop";
	return null;
}

/** Characters a note name cannot hold (in a file name or a link). */
const FORBIDDEN = /[\\/:*?"<>|#^[\]]/g;

/** A typed name made safe for a file: forbidden characters out, spaces tidied, no leading dot. */
export function cleanNoteName(text: string): string {
	return String(text ?? "")
		.replace(FORBIDDEN, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\.+/, "")
		.trim();
}

/** "Untitled", else "Untitled 1", "Untitled 2"... the first path free in the folder. */
export function freeNotePath(folder: string, base: string, taken: (path: string) => boolean): string {
	const prefix = folder && folder !== "/" ? `${folder.replace(/\/+$/, "")}/` : "";
	for (let i = 0; i < 1000; i++) {
		const path = `${prefix}${i ? `${base} ${i}` : base}.md`;
		if (!taken(path)) return path;
	}
	return `${prefix}${base} ${Date.now()}.md`;
}
