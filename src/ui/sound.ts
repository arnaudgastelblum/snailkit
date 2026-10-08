// The sound of a task checked by hand: a soft pop, then two bright notes going up (about a third of
// a second), synthesized with the Web Audio API so the plugin ships no sound file. Quiet by design.
// `step` raises it along a pentatonic scale while tasks are checked one after another (playful).
import { stepFrequency } from "./playful/rhythm";

let context: AudioContext | null = null;

function audioContext(win: Window): AudioContext | null {
	const audio = win as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
	const Ctor = audio.AudioContext ?? audio.webkitAudioContext;
	if (!Ctor) return null;
	const ac = (context ??= new Ctor());
	if (ac.state === "suspended") void ac.resume();
	return ac;
}

export function playDoneSound(win: Window = activeWindow, step = 0): void {
	try {
		const ac = audioContext(win);
		if (!ac) return;
		const rise = stepFrequency(1, step);
		const now = ac.currentTime + 0.01;
		const master = ac.createGain();
		master.gain.value = 0.16;
		master.connect(ac.destination);

		// The pop: a short sine falling fast, like a checkbox snapping.
		const pop = ac.createOscillator();
		const popGain = ac.createGain();
		pop.type = "sine";
		pop.frequency.setValueAtTime(900, now);
		pop.frequency.exponentialRampToValueAtTime(320, now + 0.05);
		popGain.gain.setValueAtTime(0.0001, now);
		popGain.gain.exponentialRampToValueAtTime(0.7, now + 0.005);
		popGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
		pop.connect(popGain).connect(master);
		pop.start(now);
		pop.stop(now + 0.09);

		// Two notes, a fifth apart, each with a quiet octave for shine.
		const note = (freq: number, at: number, length: number, level: number) => {
			for (const [mult, gain, type] of [[1, level, "sine"], [2, level * 0.18, "triangle"]] as const) {
				const osc = ac.createOscillator();
				const env = ac.createGain();
				osc.type = type;
				osc.frequency.value = freq * mult;
				env.gain.setValueAtTime(0.0001, now + at);
				env.gain.exponentialRampToValueAtTime(gain, now + at + 0.012);
				env.gain.exponentialRampToValueAtTime(0.0001, now + at + length);
				osc.connect(env).connect(master);
				osc.start(now + at);
				osc.stop(now + at + length + 0.02);
			}
		};
		note(880 * rise, 0.04, 0.2, 0.55);
		note(1318.5 * rise, 0.11, 0.34, 0.6);
	} catch {
		// No audio here (a muted device, a policy): checking a task stays silent.
	}
}

/** One short tone (a sine with a quick attack), on a shared master gain. */
function tone(ac: AudioContext, out: AudioNode, freq: number, at: number, length: number, level: number, type: OscillatorType = "sine"): void {
	const osc = ac.createOscillator();
	const env = ac.createGain();
	osc.type = type;
	osc.frequency.value = freq;
	env.gain.setValueAtTime(0.0001, at);
	env.gain.exponentialRampToValueAtTime(level, at + 0.01);
	env.gain.exponentialRampToValueAtTime(0.0001, at + length);
	osc.connect(env).connect(out);
	osc.start(at);
	osc.stop(at + length + 0.02);
}

/** A soft wooden knock and a high glint: the task landed in the count of the day. */
export function playLandSound(win: Window = activeWindow, step = 0): void {
	try {
		const ac = audioContext(win);
		if (!ac) return;
		const now = ac.currentTime + 0.005;
		const master = ac.createGain();
		master.gain.value = 0.14;
		master.connect(ac.destination);
		const len = Math.floor(ac.sampleRate * 0.05);
		const buffer = ac.createBuffer(1, len, ac.sampleRate);
		const data = buffer.getChannelData(0);
		for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
		const knock = ac.createBufferSource();
		knock.buffer = buffer;
		const band = ac.createBiquadFilter();
		band.type = "bandpass";
		band.frequency.value = 1400;
		band.Q.value = 3;
		knock.connect(band).connect(master);
		knock.start(now);
		tone(ac, master, 1760 * stepFrequency(1, step), now, 0.09, 0.25, "triangle");
	} catch {
		// Silent without audio.
	}
}

/** A warm open chord, once, when nothing is left for today. */
export function playDayClearSound(win: Window = activeWindow): void {
	try {
		const ac = audioContext(win);
		if (!ac) return;
		const now = ac.currentTime + 0.01;
		const master = ac.createGain();
		master.gain.value = 0.12;
		master.connect(ac.destination);
		[0, 4, 7, 12, 16].forEach((semi, i) => tone(ac, master, 587.33 * Math.pow(2, semi / 12), now + i * 0.09, 0.9 - i * 0.08, 0.5));
	} catch {
		// Silent without audio.
	}
}
