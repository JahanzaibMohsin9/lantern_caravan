import type { Effect } from "./bridge";

const notes: Record<Effect, number[]> = {
  buy: [587, 880], sell: [659, 988, 1319], craft: [440, 660, 880],
  deliver: [523, 784], boat: [392, 523, 659, 1047], deal: [494, 740], refuse: [280, 220],
};

let context: AudioContext | undefined;
export function play(effect: Effect, volume: number) {
  if (volume <= 0) return;
  try {
    context ??= new AudioContext();
    void context.resume().catch(() => {});
    for (const [index, note] of notes[effect].entries()) {
      const time = context.currentTime + index * 0.085;
      const tone = context.createOscillator();
      const gain = context.createGain();
      tone.type = "sine";
      tone.frequency.value = note;
      gain.gain.setValueAtTime(0.001, time);
      gain.gain.exponentialRampToValueAtTime(0.075 * volume + 0.001, time + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.55);
      tone.connect(gain).connect(context.destination);
      tone.start(time);
      tone.stop(time + 0.56);
    }
  } catch {
    // The market remains playable when audio is unavailable.
  }
}
