/** A direction in screen coordinates. */
export type Direction = "L" | "R" | "U" | "D";

/** Strokes in order, or an empty string for no gesture. */
export type Gesture = string;

/** Actions in priority order: tabs first, then Snailkit's own (the Workbench, a new note). */
export const ACTIONS = ["close", "reopen", "back", "forward", "newTab", "nextTab", "prevTab", "launcher", "home", "tasks", "brainstorm", "newNote"] as const;
export type ActionId = (typeof ACTIONS)[number];

/** The gesture of each action, empty when disabled. */
export type GestureMap = Record<ActionId, Gesture>;

/** Gestures offered in settings, in display order. */
export const GESTURES: readonly Gesture[] = [
	"L", "R", "U", "D", "DR", "DL", "UR", "UL",
	"RD", "RU", "LD", "LU", "UD", "DU", "LR", "RL",
];

/** Whether a gesture is offered in settings. */
export function isGesture(value: string): boolean {
	return GESTURES.includes(value);
}

/** Display arrows, skipping unknown characters. */
export function arrows(gesture: Gesture): string {
	const symbols: Record<Direction, string> = { L: "←", U: "↑", R: "→", D: "↓" };
	const result: string[] = [];
	for (const direction of gesture) {
		if (direction === "L" || direction === "R" || direction === "U" || direction === "D") {
			result.push(symbols[direction]);
		}
	}
	return result.join(" ");
}

/** Find the first action assigned to a supported gesture. */
export function actionFor(map: GestureMap, gesture: Gesture): ActionId | null {
	if (!isGesture(gesture)) return null;
	return ACTIONS.find((action) => map[action] === gesture) ?? null;
}

/** Find other actions sharing this action's nonempty gesture. */
export function sharing(map: GestureMap, action: ActionId): ActionId[] {
	const gesture = map[action];
	return gesture === "" ? [] : ACTIONS.filter((other) => other !== action && map[other] === gesture);
}

/** A gesture given to any command of Obsidian or of a plugin. */
export interface CustomGesture {
	gesture: Gesture;
	command: string;
}

/** Who holds a gesture: an action or the custom entry at that index. */
export type GestureOwner = { action: ActionId } | { custom: number };

/** Clean saved custom entries, disabling unsupported gestures. Never throws. */
export function cleanCustom(value: unknown): CustomGesture[] {
	const result: CustomGesture[] = [];
	try {
		if (!Array.isArray(value)) return result;
		for (const entry of value) {
			try {
				if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
				const { command, gesture } = entry as Record<string, unknown>;
				if (typeof command !== "string" || command === "") continue;
				result.push({ command, gesture: typeof gesture === "string" && isGesture(gesture) ? gesture : "" });
			} catch {
				// Skip unreadable entries.
			}
		}
	} catch {
		// Keep entries already read if the list is unreadable.
	}
	return result;
}

/** Find the first custom entry assigned to a supported gesture. */
export function customFor(custom: readonly CustomGesture[], gesture: Gesture): CustomGesture | null {
	if (!isGesture(gesture)) return null;
	return custom.find((entry) => entry.gesture === gesture) ?? null;
}

/** Find the first offered gesture held by no action or custom entry. */
export function freeGesture(map: GestureMap, custom: readonly CustomGesture[]): Gesture {
	return GESTURES.find((gesture) => !ACTIONS.some((action) => map[action] === gesture)
		&& !custom.some((entry) => entry.gesture === gesture)) ?? "";
}

/**
 * Give a gesture to one owner and clear it from all others, returning copies.
 * An empty gesture disables only that owner. An unknown custom index changes nothing.
 */
export function assign(map: GestureMap, custom: readonly CustomGesture[], owner: GestureOwner, gesture: Gesture): { map: GestureMap; custom: CustomGesture[] } {
	const result = { map: { ...map }, custom: custom.map((entry) => ({ ...entry })) };
	if ("custom" in owner && (!Number.isInteger(owner.custom) || owner.custom < 0 || owner.custom >= custom.length)) return result;
	if (gesture !== "") {
		for (const action of ACTIONS) {
			if (result.map[action] === gesture) result.map[action] = "";
		}
		for (const entry of result.custom) {
			if (entry.gesture === gesture) entry.gesture = "";
		}
	}
	if ("action" in owner) result.map[owner.action] = gesture;
	else result.custom[owner.custom].gesture = gesture;
	return result;
}

/** Sampling, recognition and trail limits. */
export interface TrackerOptions {
	/** Minimum distance from the last sample, default 8 px. */
	sample?: number;
	/** Travel needed to commit a new direction, default 24 px. */
	stroke?: number;
	/** Maximum trail positions, default 2000. */
	maxPoints?: number;
}

/** Recognize strokes from pointer positions starting at the press point. */
export class GestureTracker {
	private anchor: [number, number];
	private last: Direction | null = null;
	private pending: { direction: Direction; length: number } | null = null;
	private strokes: Gesture = "";
	private readonly trail: [number, number][];
	private readonly sample: number;
	private readonly stroke: number;
	private readonly maxPoints: number;

	constructor(x: number, y: number, options: TrackerOptions = {}) {
		this.anchor = [x, y];
		this.trail = [[x, y]];
		this.sample = options.sample ?? 8;
		this.stroke = options.stroke ?? 24;
		this.maxPoints = options.maxPoints ?? 2000;
	}

	/** Strokes committed so far. */
	get gesture(): Gesture {
		return this.strokes;
	}

	/** Press point and moves retained for drawing the trail. */
	get points(): ReadonlyArray<readonly [number, number]> {
		return this.trail;
	}

	/** Feed a position and report whether the gesture changed. */
	move(x: number, y: number): boolean {
		this.trail.push([x, y]);
		if (this.trail.length > this.maxPoints) {
			this.trail.splice(0, this.trail.length - this.maxPoints);
		}
		const dx = x - this.anchor[0];
		const dy = y - this.anchor[1];
		const length = Math.hypot(dx, dy);
		if (length < this.sample) return false;
		const direction: Direction = Math.abs(dx) >= Math.abs(dy)
			? (dx > 0 ? "R" : "L")
			: (dy > 0 ? "D" : "U");
		this.anchor = [x, y];
		if (direction === this.last) {
			this.pending = null;
			return false;
		}
		if (this.pending?.direction === direction) {
			this.pending.length += length;
		} else {
			this.pending = { direction, length };
		}
		if (this.pending.length >= this.stroke) {
			this.strokes += direction;
			this.last = direction;
			this.pending = null;
			return true;
		}
		return false;
	}
}
