// Playful motion: the pure rhythm behind it (the run of checks, its pitch, the ring of the day).
import assert from "node:assert/strict";
import { test } from "node:test";
import { dayProgress, nextRun, PENTATONIC, RUN_GAP, stepFrequency } from "../src/ui/playful/rhythm";

test("a run of checks climbs one step at a time, and starts again after a pause", () => {
	let run = nextRun({ step: 0, at: null }, 1000);
	assert.deepEqual(run, { step: 0, at: 1000 });
	run = nextRun(run, 3000);
	run = nextRun(run, 5000);
	assert.equal(run.step, 2);
	// A pause longer than the gap: back to the first step, nothing lost, nothing shown.
	assert.equal(nextRun(run, 5000 + RUN_GAP).step, 0);
	// It never climbs past the top of the scale.
	let long = { step: 0, at: 0 as number | null };
	for (let i = 1; i < 40; i++) long = nextRun(long, i * 1000);
	assert.equal(long.step, PENTATONIC.length - 1);
	// A clock going back (another device, a time change) starts again too.
	assert.equal(nextRun({ step: 4, at: 9000 }, 8000).step, 0);
});

test("each step sounds a pentatonic interval higher", () => {
	assert.equal(stepFrequency(440, 0), 440);
	assert.ok(Math.abs(stepFrequency(440, 5) - 880) < 1e-9);
	assert.ok(stepFrequency(440, 3) > stepFrequency(440, 2));
	assert.equal(stepFrequency(440, 99), stepFrequency(440, PENTATONIC.length - 1));
});

test("the ring of the day: done over done and still due", () => {
	assert.equal(dayProgress(0, 0), 0);
	assert.equal(dayProgress(3, 1), 0.75);
	assert.equal(dayProgress(4, 0), 1);
	assert.equal(dayProgress(0, 5), 0);
});
