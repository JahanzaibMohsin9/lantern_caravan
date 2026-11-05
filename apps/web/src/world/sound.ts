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

// River Run sound layer: synthesized like the rest of the game, so there are no audio files to load.
export type RiverCue = "cannon" | "enemy" | "hit" | "hurt" | "splash" | "sink" | "boom" | "coin" | "flare" | "pickup"
  | "trade" | "moor" | "thunder" | "gate" | "bell";
let noiseBuffer: AudioBuffer | undefined;
let engine: { osc: OscillatorNode; sub: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | undefined;
const recent = new Map<RiverCue, number>();

function burst(level: number, length: number, cutoff: number, delay = 0, type: BiquadFilterType = "lowpass") {
  if (!context) return;
  if (!noiseBuffer) {
    noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const time = context.currentTime + delay;
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const envelope = context.createGain();
  source.buffer = noiseBuffer;
  filter.type = type;
  filter.frequency.setValueAtTime(cutoff, time);
  filter.frequency.exponentialRampToValueAtTime(Math.max(60, cutoff * .25), time + length);
  envelope.gain.setValueAtTime(Math.max(.001, level), time);
  envelope.gain.exponentialRampToValueAtTime(.0001, time + length);
  source.connect(filter).connect(envelope).connect(context.destination);
  source.start(time);
  source.stop(time + length + .02);
}

function sweep(from: number, to: number, level: number, length: number, type: OscillatorType = "sine", delay = 0) {
  if (!context) return;
  const time = context.currentTime + delay;
  const voice = context.createOscillator();
  const envelope = context.createGain();
  voice.type = type;
  voice.frequency.setValueAtTime(from, time);
  voice.frequency.exponentialRampToValueAtTime(Math.max(20, to), time + length);
  envelope.gain.setValueAtTime(.0001, time);
  envelope.gain.exponentialRampToValueAtTime(Math.max(.001, level), time + .012);
  envelope.gain.exponentialRampToValueAtTime(.0001, time + length);
  voice.connect(envelope).connect(context.destination);
  voice.start(time);
  voice.stop(time + length + .02);
}

/** Plays a River Run cue. Repeats of the same cue are thinned so gunfire never turns into noise. */
export function playRiver(cue: RiverCue, volume: number) {
  if (volume <= 0 || !context) return;
  const now = context.currentTime, gap = cue === "cannon" ? .07 : cue === "splash" || cue === "enemy" ? .09 : .04;
  if (now - (recent.get(cue) ?? -1) < gap) return;
  recent.set(cue, now);
  const v = volume;
  switch (cue) {
    case "cannon": burst(.22 * v, .16, 2600); sweep(170, 55, .2 * v, .18, "triangle"); break;
    case "enemy": burst(.1 * v, .14, 1400); sweep(120, 48, .1 * v, .16, "square"); break;
    case "hit": burst(.12 * v, .09, 3800, 0, "bandpass"); sweep(900, 420, .05 * v, .08, "square"); break;
    case "hurt": burst(.2 * v, .22, 900); sweep(90, 40, .18 * v, .25, "sawtooth"); break;
    case "splash": burst(.05 * v, .28, 1900, 0, "bandpass"); break;
    case "sink": burst(.32 * v, .9, 1500); sweep(110, 30, .26 * v, .8, "triangle"); burst(.08 * v, 1.2, 700, .25); break;
    case "boom": burst(.36 * v, 1.1, 1200); sweep(75, 25, .3 * v, 1, "sawtooth"); tone(context.destination, 196, .3, .04 * v, .5); break;
    case "coin": tone(context.destination, 1319, 0, .05 * v, .18); tone(context.destination, 1760, .07, .05 * v, .26); break;
    case "flare": sweep(320, 2400, .09 * v, .55, "sawtooth"); burst(.18 * v, .7, 6000, .05, "highpass"); break;
    case "pickup": [784, 988, 1175].forEach((note, i) => tone(context!.destination, note, i * .06, .05 * v, .22)); break;
    case "trade": [587, 880].forEach((note, i) => tone(context!.destination, note, i * .08, .06 * v, .3)); break;
    case "moor": [392, 523, 659, 784].forEach((note, i) => tone(context!.destination, note, i * .11, .06 * v, .7)); break;
    case "bell": tone(context.destination, 880, 0, .07 * v, 1.4); tone(context.destination, 1318, .02, .03 * v, 1.1); break;
    case "gate": [523, 659, 784, 1047].forEach((note, i) => tone(context!.destination, note, i * .07, .06 * v, .5)); break;
    case "thunder": burst(.3 * v, 2.2, 500); burst(.15 * v, 1.4, 260, .3); break;
  }
}

/** Continuous engine hum for the barge: pitch follows speed and lifts while boosting. */
export function riverEngine(speed: number, boost: boolean, volume: number) {
  if (!context) return;
  const time = context.currentTime;
  if (volume <= 0 || speed < 0) {
    if (engine) {
      engine.gain.gain.setTargetAtTime(0, time, .08);
      const old = engine;
      engine = undefined;
      window.setTimeout(() => { try { old.osc.stop(); old.sub.stop(); } catch { /* already stopped */ } }, 400);
    }
    return;
  }
  if (!engine) {
    const osc = context.createOscillator(), sub = context.createOscillator();
    const gain = context.createGain(), filter = context.createBiquadFilter();
    osc.type = "sawtooth"; sub.type = "sine";
    filter.type = "lowpass"; filter.frequency.value = 380;
    gain.gain.value = 0;
    osc.connect(filter); sub.connect(filter); filter.connect(gain).connect(context.destination);
    osc.start(); sub.start();
    engine = { osc, sub, gain, filter };
  }
  const pace = Math.min(1, speed / 340);
  engine.osc.frequency.setTargetAtTime(38 + pace * 46 + (boost ? 18 : 0), time, .12);
  engine.sub.frequency.setTargetAtTime(26 + pace * 20, time, .12);
  engine.filter.frequency.setTargetAtTime(260 + pace * 520 + (boost ? 380 : 0), time, .12);
  engine.gain.gain.setTargetAtTime((.018 + pace * .03 + (boost ? .02 : 0)) * volume, time, .1);
}
