// Pure geometry and timings of "open on hover": the intent before a panel opens, the grace
// before it closes, and the corridor that lets the pointer cross other buttons on its way from a
// button to the open panel. Tested in test/note-rail.test.ts.

/** The pointer rests this long on a button before its panel opens (crossing the rail opens nothing). */
export const OPEN_INTENT_MS = 150;
/** A panel opened by hovering closes this long after the pointer left the rail and the panel. */
export const CLOSE_GRACE_MS = 300;
/** While the pointer heads for the panel across another button, the switch waits this long for it to stop. */
export const CORRIDOR_WAIT_MS = 120;

export interface Point {
	x: number;
	y: number;
}

export interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** True when `p` is inside the triangle `a`, `b`, `c` (edges included). */
export function inTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
	const cross = (o: Point, u: Point, v: Point) => (u.x - o.x) * (v.y - o.y) - (u.y - o.y) * (v.x - o.x);
	const d1 = cross(p, a, b);
	const d2 = cross(p, b, c);
	const d3 = cross(p, c, a);
	const negative = d1 < 0 || d2 < 0 || d3 < 0;
	const positive = d1 > 0 || d2 > 0 || d3 > 0;
	return !(negative && positive);
}

/**
 * The pointer moved from `from` to `to` toward the open panel: `to` lies in the triangle between
 * `from` and the near edge of the panel (widened by `slack` above and below), and it moved toward
 * the panel's side. `side` is the side of the note the rail sits on (the panel is on the other side
 * of the rail: to the right of a left rail).
 */
export function headingToPanel(from: Point, to: Point, panel: Box, side: "left" | "right", slack = 8): boolean {
	const towards = side === "left" ? to.x - from.x : from.x - to.x;
	if (towards <= 0) return false;
	const edge = side === "left" ? panel.left : panel.right;
	if (side === "left" ? to.x > edge : to.x < edge) return false;
	return inTriangle(to, from, { x: edge, y: panel.top - slack }, { x: edge, y: panel.bottom + slack });
}
