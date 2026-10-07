// Where a dragged node lands, decided without DOM (tested in test/map.test.ts). On a sibling, the
// top third puts it before, the bottom third after, the middle makes that sibling its parent
// (when allowed). Once a zone is chosen it holds a little past its border, so the preview does
// not flicker between "between" and "onto" when the pointer rests near the line.

export type Zone = "before" | "after" | "into";

/** How far past its border the current zone holds (share of the node's height). */
const HOLD = 0.08;

/**
 * The zone at `frac` (0 = top of the node, 1 = bottom). `sibling`: the node is a sibling and
 * reordering is allowed. `accepts`: the dragged node may hang under it. `previous`: the zone shown
 * on this same node just before, for the hysteresis.
 */
export function dropZone(frac: number, sibling: boolean, accepts: boolean, previous: Zone | null): Zone | null {
	const f = Math.max(0, Math.min(1, frac));
	if (!sibling) return accepts ? "into" : null;
	if (!accepts) {
		if (previous === "before" && f < 0.5 + HOLD) return "before";
		if (previous === "after" && f > 0.5 - HOLD) return "after";
		return f < 0.5 ? "before" : "after";
	}
	if (previous === "into" && f > 0.3 - HOLD && f < 0.7 + HOLD) return "into";
	if (previous === "before" && f < 0.3 + HOLD) return "before";
	if (previous === "after" && f > 0.7 - HOLD) return "after";
	return f < 0.3 ? "before" : f > 0.7 ? "after" : "into";
}

/**
 * The child the dragged node goes before when it lands just after `sibling` (null: at the end),
 * in the full order of the children, shown or not, so a note dropped after the last child shown
 * stays on the Map.
 */
export function nextAfter(all: readonly string[], id: string, sibling: string): string | null {
	const rest = all.filter((c) => c !== id);
	const at = rest.indexOf(sibling);
	return at >= 0 ? rest[at + 1] ?? null : null;
}

/** True when landing before `before` leaves the dragged node where it is. */
export function sameOrder(all: readonly string[], id: string, before: string | null): boolean {
	const at = all.indexOf(id);
	if (at < 0) return false;
	return before === id || (all[at + 1] ?? null) === before;
}
