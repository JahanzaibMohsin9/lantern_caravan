import type { Effect } from "./bridge";

const notes: Record<Effect, number[]> = {
  buy: [587, 880], sell: [659, 988, 1319], craft: [440, 660, 880],
  deliver: [523, 784], boat: [392, 523, 659, 1047], deal: [494, 740], refuse: [280, 220],
  relit: [392, 493, 587, 784, 988], finale: [392, 523, 659, 784, 1047, 1319, 1568],
};

let context: AudioContext | undefined;
let ambient: GainNode | undefined;
let music: GainNode | undefined;
let timer = 0;
let beat = 0;
let boatLayers = 0;
let urgent = false;

function tone(target: AudioNode, note: number, delay: number, level: number, length: number) {
  if (!context) return;
  const time = context.currentTime + delay;
  const voice = context.createOscillator();
  const envelope = context.createGain();
  voice.type = "sine";
  voice.frequency.value = note;
  envelope.gain.setValueAtTime(.0001, time);
  envelope.gain.exponentialRampToValueAtTime(Math.max(.001, level), time + Math.min(.04, length / 4));
  envelope.gain.exponentialRampToValueAtTime(.0001, time + length);
  voice.connect(envelope).connect(target);
  voice.start(time);
  voice.stop(time + length + .01);
}

export function unlockSound() {
  try {
    if (!context) {
      context = new AudioContext();
      music = context.createGain();
      music.gain.value = 0;
      music.connect(context.destination);
      ambient = context.createGain();
      ambient.gain.value = 0;
      ambient.connect(context.destination);
      const buffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
      const wave = buffer.getChannelData(0);
      let smooth = 0;
      for (let index = 0; index < wave.length; index++) {
        smooth = smooth * .94 + (Math.random() * 2 - 1) * .06;
        wave[index] = smooth * (.7 + Math.sin(index / wave.length * Math.PI * 6) * .27);
      }
      const river = context.createBufferSource();
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 480;
      river.buffer = buffer;
      river.loop = true;
      river.connect(filter).connect(ambient);
      river.start();
    }
    void context.resume().catch(() => {});
  } catch { /* audio is optional */ }
}

const chords = [[146.83, 220, 293.66], [130.81, 196, 261.63], [110, 164.81, 261.63], [98, 146.83, 220]];
export function mixMarket(active: boolean, master: number, level: number, boats: number, closing: boolean) {
  if (!context || !music || !ambient) return;
  boatLayers = boats;
  urgent = closing;
  const time = context.currentTime;
  music.gain.setTargetAtTime(active ? master * level : 0, time, .2);
  ambient.gain.setTargetAtTime(active ? master * .10 : 0, time, .2);
  if (active && !timer) {
    const tick = () => {
      if (!music) return;
      const chord = chords[Math.floor(beat / 4) % chords.length]!;
      if (beat % 4 === 0) tone(music, chord[0]!, 0, .065, 1.7);
      tone(music, chord[(beat % 3)]! * (beat % 2 ? 2 : 1), 0, .034, 1.05);
      if (boatLayers > 0 && beat % 2 === 1) tone(music, chord[2]! * 2, .21, .02, .9);
      if (boatLayers > 2 && beat % 4 === 2) tone(music, chord[1]! * 4, .31, .017, 1.1);
      if (urgent) tone(music, 57, .25, .035, .15);
      beat++;
    };
    tick();
    timer = window.setInterval(tick, 560);
  } else if (!active && timer) {
    window.clearInterval(timer);
    timer = 0;
  }
}

export function play(effect: Effect, volume: number) {
  if (volume <= 0) return;
  unlockSound();
  if (!context) return;
  for (const [index, note] of notes[effect].entries()) tone(context.destination, note, index * .085, .078 * volume, .56);
}
