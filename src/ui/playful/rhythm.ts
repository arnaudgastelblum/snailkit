// The rhythm of a run of gestures: checking tasks one after another raises the pitch of the sound,
// one step of a pentatonic scale each time, back to the start after a pause. Nothing is counted on
// screen and nothing is lost when the run stops: it is only a feeling of momentum. Pure.

/** Semitones of a major pentatonic scale over two octaves: every step sounds good after any other. */
export const PENTATONIC: readonly number[] = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

/** How long a pause may last before the run starts again (ms). */
export const RUN_GAP = 9000;

export interface Run {
	/** Step reached in the run (0: the first gesture). */
	step: number;
	/** When the last gesture happened (ms), or null before the first one. */
	at: number | null;
}

/** The run after one more gesture at `now`: one step higher within `gap`, else back to the first step. */
export function nextRun(run: Run, now: number, gap = RUN_GAP, top = PENTATONIC.length - 1): Run {
	const going = run.at !== null && now - run.at >= 0 && now - run.at < gap;
	return { step: going ? Math.min(run.step + 1, top) : 0, at: now };
}

/** The frequency of a step: `base` raised by the pentatonic interval of that step. */
export function stepFrequency(base: number, step: number): number {
	const i = Math.max(0, Math.min(PENTATONIC.length - 1, Math.floor(step)));
	return base * Math.pow(2, PENTATONIC[i] / 12);
}

/**
 * How full the ring of the day is: tasks done today over those done and those still due today (or
 * late). 0 when nothing is planned, 1 once everything due is done.
 */
export function dayProgress(doneToday: number, stillDue: number): number {
	const total = Math.max(0, doneToday) + Math.max(0, stillDue);
	return total ? Math.max(0, doneToday) / total : 0;
}
