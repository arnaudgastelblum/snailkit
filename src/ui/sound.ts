// The sound of a task checked by hand: a soft pop, then two bright notes going up (about a third of
// a second), synthesized with the Web Audio API so the plugin ships no sound file. Quiet by design.
let context: AudioContext | null = null;

export function playDoneSound(win: Window = activeWindow): void {
	const audio = win as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
	const Ctor = audio.AudioContext ?? audio.webkitAudioContext;
	if (!Ctor) return;
	try {
		const ac = (context ??= new Ctor());
		if (ac.state === "suspended") void ac.resume();
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
		note(880, 0.04, 0.2, 0.55);
		note(1318.5, 0.11, 0.34, 0.6);
	} catch {
		// No audio here (a muted device, a policy): checking a task stays silent.
	}
}
