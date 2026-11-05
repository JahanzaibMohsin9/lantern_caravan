import { landing, reaches, trimFor, villages, type ReachId, type VillageId } from "@lantern/content/river";
import { items, type ItemId } from "@lantern/content";
import { distance, objective, type Point, type River, type RiverEffect } from "@lantern/river-sim";
import type { Snapshot } from "@lantern/protocol";
import type { RiverCue } from "../world/sound";
import { bankWidth, bounds, drawTerrain, hash, onWater, riverInfo, type Terrain } from "./terrain";

type Ink = CanvasRenderingContext2D;
const tau = Math.PI * 2;
const bandLight = { dark: 0, tight: .35, healthy: .7, thriving: 1 } as const;
export const cargoColor: Record<string, string> = { paper: "#efe2c4", oil: "#f0a24e", reed: "#9fca86", cord: "#cfa978", dye: "#9a86ec" };

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string;
  kind: "spark" | "smoke" | "debris" | "foam" | "ember" | "glint"; spin?: number; angle?: number };
type Ring = { x: number; y: number; from: number; to: number; life: number; max: number; color: string; width: number };
type Label = { x: number; y: number; text: string; color: string; life: number; max: number; big?: boolean };
type Flash = { x: number; y: number; radius: number; color: string; life: number; max: number };

export type Scene = {
  terrain: Terrain; particles: Particle[]; rings: Ring[]; labels: Label[]; flashes: Flash[];
  wakes: Map<string, { x: number; y: number; t: number }[]>; seen: number; time: number;
  shake: number; hurt: number; whiteout: number; lightning: number; nextThunder: number;
  gate: number; outcome?: string; announce?: { title: string; sub: string; life: number; tone: "good" | "warn" | "info" };
  reach?: ReachId; smokeTimer: number; lastFrame: number; rain: { x: number; y: number; s: number }[];
};

export function createScene(terrain: Terrain): Scene {
  return { terrain, particles: [], rings: [], labels: [], flashes: [], wakes: new Map(), seen: -1, time: 0, shake: 0, hurt: 0,
    whiteout: 0, lightning: 0, nextThunder: 3, gate: 0, smokeTimer: 0, lastFrame: 0,
    rain: Array.from({ length: 140 }, (_, i) => ({ x: hash(i, 1, 70), y: hash(i, 2, 70), s: .6 + hash(i, 3, 70) * .8 })) };
}

export function camera(width: number, height: number, player: Point & { vx?: number; vy?: number }) {
  const scale = Math.min(1, Math.max(.5, width / 1450));
  const lead = (v = 0) => Math.max(-170, Math.min(170, v * .38));
  return { scale, x: player.x + lead(player.vx) - width / scale / 2, y: player.y + lead(player.vy) - height / scale / 2 };
}

function rand(seed: number) { return hash(seed, 17, 91); }
let serial = 0;
const next = () => rand(++serial);

function spray(scene: Scene, x: number, y: number, count: number, color: string, speed: number, kind: Particle["kind"] = "spark",
  life = .6, size = 3, direction?: number) {
  for (let i = 0; i < count; i++) {
    const a = direction === undefined ? next() * tau : direction + (next() - .5) * 1.1;
    const v = speed * (.3 + next() * .9);
    scene.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life * (.6 + next() * .7), max: life,
      size: size * (.6 + next() * .8), color, kind, spin: (next() - .5) * 8, angle: next() * tau });
  }
}
const ring = (scene: Scene, x: number, y: number, from: number, to: number, color: string, max = .6, width = 3) =>
  scene.rings.push({ x, y, from, to, life: max, max, color, width });
const flash = (scene: Scene, x: number, y: number, radius: number, color: string, max = .25) =>
  scene.flashes.push({ x, y, radius, color, life: max, max });
const label = (scene: Scene, x: number, y: number, text: string, color: string, big = false) =>
  scene.labels.push({ x, y, text, color, life: big ? 1.8 : 1.2, max: big ? 1.8 : 1.2, big });
export function announce(scene: Scene, title: string, sub: string, tone: "good" | "warn" | "info" = "info") {
  scene.announce = { title, sub, life: 2.6, tone };
}

function explode(scene: Scene, x: number, y: number, size: number) {
  flash(scene, x, y, 150 * size, "#ffb35c", .32);
  spray(scene, x, y, Math.round(26 * size), "#ffcb6b", 260 * size, "ember", .8, 3.2);
  spray(scene, x, y, Math.round(14 * size), "#ff7a45", 160 * size, "spark", .5, 3);
  spray(scene, x, y, Math.round(12 * size), "#3a3036", 70 * size, "smoke", 1.6, 18 * size);
  spray(scene, x, y, Math.round(9 * size), "#4a3527", 210 * size, "debris", 1.4, 7);
  ring(scene, x, y, 10, 120 * size, "#ffd29a", .55, 4);
  ring(scene, x, y, 20, 190 * size, "#9fd2dc", 1.1, 2);
}

/** Turns new simulation events into particles, labels and sound cues. */
export function absorb(scene: Scene, state: River, cue: (cue: RiverCue, near: boolean) => void) {
  const p = state.player;
  const fresh = state.effects.filter(effect => effect.frame > scene.seen);
  scene.seen = state.frame;
  for (const event of fresh) handle(scene, state, event, cue, distance(event, p) < 900);
  if (state.floodtide && state.floodtide.next > scene.gate) {
    scene.gate = state.floodtide.next;
    ring(scene, p.x, p.y, 30, 260, "#bfeaff", .9, 5);
    announce(scene, scene.gate === 2 ? "Both locks open" : "Lock gate open", scene.gate === 2 ? "Make for The Landing" : "Follow the next beacon", "good");
    cue("gate", true);
  }
  if (state.outcome && !scene.outcome) {
    scene.outcome = state.outcome;
    cue(state.outcome === "moored" ? "moor" : "bell", true);
  }
  const here = riverInfo(p.x, p.y).id;
  if (here !== scene.reach) {
    const before = scene.reach;
    scene.reach = here;
    if (before) {
      const danger = state.manifest.reaches.find(reach => reach.id === here)?.danger ?? 0;
      const cleared = state.broken.includes(here);
      announce(scene, reaches[here].name, danger && !cleared ? "Danger " + danger + " · pirates about" : "Lamps lit · safe water", danger && !cleared ? "warn" : "info");
    }
  }
}

function handle(scene: Scene, state: River, e: RiverEffect, cue: (cue: RiverCue, near: boolean) => void, near: boolean) {
  switch (e.kind) {
    case "shot":
      flash(scene, e.x, e.y, 46, "#ffd38a", .09);
      spray(scene, e.x, e.y, 5, "#ffe2a8", 220, "spark", .18, 2, e.amount);
      spray(scene, e.x, e.y, 2, "#59565c", 40, "smoke", .7, 8, e.amount);
      cue("cannon", true); break;
    case "eshot":
      flash(scene, e.x, e.y, e.heavy ? 56 : 38, "#ff6a52", .1);
      spray(scene, e.x, e.y, 3, "#ff9a7a", 160, "spark", .16, 2, e.amount);
      cue("enemy", near); break;
    case "hit":
      if (e.target === "player") {
        spray(scene, e.x, e.y, 12, "#ff8a6a", 200, "spark", .4, 3);
        spray(scene, e.x, e.y, 4, "#4a3527", 120, "debris", .8, 5);
        scene.shake = Math.min(18, scene.shake + 9); scene.hurt = Math.min(1, scene.hurt + .55);
        cue("hurt", true);
      } else {
        spray(scene, e.x, e.y, 9, e.target === "boom" ? "#ffcf7a" : "#fff0c8", 180, "spark", .35, 2.4);
        ring(scene, e.x, e.y, 4, 34, "#ffd9a0", .25, 2);
        if (e.amount) label(scene, e.x + (next() - .5) * 20, e.y - 18, "-" + e.amount, "#ffd9a0");
        cue("hit", near);
      }
      break;
    case "splash":
      if (!onWater(e.x, e.y)) break;
      ring(scene, e.x, e.y, 3, 26, "#9fd2dc", .45, 1.6);
      spray(scene, e.x, e.y, 5, "#cdeef2", 70, "foam", .5, 2.4);
      cue("splash", near && distance(e, state.player) < 500); break;
    case "sink":
      explode(scene, e.x, e.y, e.heavy ? 1.35 : 1);
      if (near) scene.shake = Math.min(18, scene.shake + (e.heavy ? 11 : 6));
      label(scene, e.x, e.y - 40, e.heavy ? "Gunboat sunk!" : "Pirate sunk!", "#ffe1a6", true);
      cue("sink", near); break;
    case "boom":
      explode(scene, e.x, e.y, 1.6);
      scene.shake = Math.min(20, scene.shake + 14);
      announce(scene, "Boom broken!", "The shortcut is open for every barge tonight", "good");
      cue("boom", true); break;
    case "coin":
      label(scene, e.x + 30, e.y - 64, "+" + e.amount + " bounty", "#ffd36b", true);
      spray(scene, e.x, e.y, 8, "#ffd36b", 120, "glint", .7, 3);
      cue("coin", true); break;
    case "flare":
      flash(scene, e.x, e.y, 340, "#bff4ff", .55);
      ring(scene, e.x, e.y, 20, 265, "#c9f6ff", .7, 6);
      ring(scene, e.x, e.y, 10, 300, "#7fd9ea", 1.1, 2);
      spray(scene, e.x, e.y, 36, "#d2fbff", 330, "spark", .7, 2.6);
      scene.whiteout = Math.max(scene.whiteout, .32);
      cue("flare", true); break;
    case "pickup": {
      const text = ["+30 fuel", "+40 shot", "+30 hull"][e.amount ?? 0]!;
      const color = ["#ffb35c", "#ffe1a6", "#8fe3a8"][e.amount ?? 0]!;
      ring(scene, e.x, e.y, 10, 70, color, .6, 3);
      spray(scene, e.x, e.y, 12, color, 120, "glint", .7, 2.6);
      label(scene, e.x, e.y - 40, text, color, true);
      cue("pickup", true); break;
    }
    case "trade":
      label(scene, e.x, e.y - 60, (e.amount ?? 0) > 0 ? "+" + e.amount + " coins" : (e.amount ?? 0) + " coins",
        (e.amount ?? 0) > 0 ? "#ffd36b" : "#f1dcc4", true);
      cue("trade", true); break;
    case "spill":
      explode(scene, e.x, e.y, .9);
      spray(scene, e.x, e.y, 10, "#c7a36b", 160, "debris", 2, 8);
      announce(scene, "The barge is going down", "Recover the floating cargo, then call the tow", "warn");
      cue("sink", true); break;
  }
}

function glow(ctx: Ink, x: number, y: number, radius: number, color: string, alpha: number) {
  if (alpha <= 0 || radius <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.globalCompositeOperation = "lighter";
  const light = ctx.createRadialGradient(x, y, 1, x, y, radius);
  light.addColorStop(0, color); light.addColorStop(1, "#0000");
  ctx.fillStyle = light;
  ctx.beginPath(); ctx.arc(x, y, radius, 0, tau); ctx.fill();
  ctx.restore();
}
function dot(ctx: Ink, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, tau); ctx.fill();
}
/** A light's shimmering reflection on the water, stretched downstream. */
function reflection(ctx: Ink, x: number, y: number, color: string, alpha: number, time: number, length = 70) {
  if (!onWater(x, y + 20)) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = color; ctx.lineCap = "round";
  for (let i = 0; i < 6; i++) {
    const yy = y + 14 + i * length / 6, wobble = Math.sin(time * 3 + i * 1.7 + x * .01) * (4 + i * 1.5);
    ctx.globalAlpha = alpha * (1 - i / 6) * .55;
    ctx.lineWidth = 3.5 - i * .35;
    ctx.beginPath(); ctx.moveTo(x - 9 + wobble, yy); ctx.lineTo(x + 9 + wobble, yy); ctx.stroke();
  }
  ctx.restore();
}

function water(ctx: Ink, scene: Scene, view: { x: number; y: number; w: number; h: number }, low: boolean) {
  const step = low ? 150 : 105, t = scene.time;
  ctx.save();
  ctx.lineCap = "round";
  for (let gy = Math.floor(view.y / step) * step; gy < view.y + view.h; gy += step) {
    for (let gx = Math.floor(view.x / step) * step; gx < view.x + view.w; gx += step) {
      const h1 = hash(gx, gy, 3), x = gx + h1 * step, y = gy + hash(gx, gy, 4) * step;
      const info = riverInfo(x, y);
      if (info.d > info.w - 26) continue;
      const phase = (t * .45 + h1 * 7) % 1, drift = phase * 26;
      ctx.globalAlpha = Math.sin(phase * Math.PI) * (info.d > info.w - 120 ? .3 : .45);
      ctx.strokeStyle = h1 > .75 ? "#5c97a6" : "#2f6575";
      ctx.lineWidth = 1.6;
      const len = 14 + h1 * 22;
      ctx.beginPath(); ctx.moveTo(x - len / 2, y + drift); ctx.quadraticCurveTo(x, y + drift - 3, x + len / 2, y + drift); ctx.stroke();
    }
  }
  ctx.restore();
}

function fireflies(ctx: Ink, scene: Scene, view: { x: number; y: number; w: number; h: number }) {
  const cell = 380;
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  for (let gy = Math.floor(view.y / cell) * cell; gy < view.y + view.h; gy += cell) {
    for (let gx = Math.floor(view.x / cell) * cell; gx < view.x + view.w; gx += cell) {
      for (let k = 0; k < 2; k++) {
        const h = hash(gx, gy, 40 + k);
        const x = gx + h * cell + Math.sin(scene.time * .7 + h * 9) * 30, y = gy + hash(gx, gy, 50 + k) * cell + Math.cos(scene.time * .5 + h * 5) * 22;
        const blink = Math.max(0, Math.sin(scene.time * (1.4 + h) + h * 20));
        if (blink < .2) continue;
        ctx.globalAlpha = blink * .8;
        dot(ctx, x, y, 1.8, "#fff1a6");
        glow(ctx, x, y, 16, "#f6e27a", blink * .35);
      }
    }
  }
  ctx.restore();
}

function lampPosts(ctx: Ink, scene: Scene, state: River, view: { x: number; y: number; w: number; h: number }) {
  for (const reach of state.manifest.reaches) {
    const id = reach.id as ReachId, { from, to } = reaches[id];
    const length = distance(from, to), dir = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
    const normal = { x: -dir.y, y: dir.x };
    const lit = 5 - (state.broken.includes(id) ? 0 : reach.danger);
    let index = 0;
    for (let s = 260; s < length - 200; s += 470) {
      for (const side of [-1, 1]) {
        index++;
        const w = bankWidth(id, s, side) + 16;
        const x = from.x + dir.x * s + normal.x * w * side, y = from.y + dir.y * s + normal.y * w * side;
        if (x < view.x - 120 || x > view.x + view.w + 120 || y < view.y - 120 || y > view.y + view.h + 160) continue;
        if (onWater(x, y, -6)) continue;
        const on = index % 5 < lit;
        dot(ctx, x + 4, y + 6, 7, "#05060a");
        ctx.fillStyle = "#2b2420"; ctx.fillRect(x - 3, y - 3, 6, 6);
        if (on) {
          const flicker = .82 + Math.sin(scene.time * 7 + index * 3.1) * .07 + Math.sin(scene.time * 13 + index) * .05;
          glow(ctx, x, y, 120, "#ffb86b", .3 * flicker);
          glow(ctx, x, y, 30, "#ffe1a8", .8 * flicker);
          dot(ctx, x, y, 4, "#fff0c6");
          reflection(ctx, x - normal.x * side * 50, y - normal.y * side * 50, "#ffc27e", .8 * flicker, scene.time);
        } else {
          dot(ctx, x, y, 4, "#3a3236");
          if (reach.danger >= 2 && index % 4 === 0) {
            ctx.fillStyle = "#7a2b2b"; ctx.fillRect(x + 5, y - 16, 12, 8);
          }
        }
      }
    }
  }
}

function village(ctx: Ink, scene: Scene, id: VillageId, band: keyof typeof bandLight) {
  const port = villages[id], light = bandLight[band];
  glow(ctx, port.x, port.y - 40, 520, port.color, .12 + light * .2);
  const houses = 8, lit = Math.round(light * houses);
  const fork = reaches.heron_reach.to, away = Math.atan2(port.y - fork.y, port.x - fork.x);
  for (let i = 0; i < houses; i++) {
    const a = away - 1.25 + i / (houses - 1) * 2.5;
    const x = port.x + Math.cos(a) * (500 + (i % 2) * 90), y = port.y + Math.sin(a) * (500 + (i % 2) * 90);
    ctx.fillStyle = "#06070a"; ctx.globalAlpha = .6; ctx.fillRect(x - 30, y - 8, 70, 60); ctx.globalAlpha = 1;
    ctx.fillStyle = "#1d1b22"; ctx.fillRect(x - 26, y - 22, 52, 46);
    ctx.fillStyle = i % 3 ? "#2c2430" : "#33262a";
    ctx.beginPath(); ctx.moveTo(x - 34, y - 20); ctx.lineTo(x, y - 48); ctx.lineTo(x + 34, y - 20); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#3a2b25";
    for (const sx of [-20, 16]) ctx.fillRect(x + sx, y + 24, 5, 18);
    const on = i < lit;
    for (const wx of [-13, 7]) {
      ctx.fillStyle = on ? port.color : "#14121a";
      ctx.fillRect(x + wx, y - 10, 8, 11);
    }
    if (on) {
      glow(ctx, x, y - 4, 60, port.color, .35);
      if ((i + Math.floor(scene.time)) % 3 === 0 && scene.smokeTimer <= 0) {
        scene.particles.push({ x: x + 12, y: y - 46, vx: 6 + next() * 8, vy: -12 - next() * 8, life: 3, max: 3, size: 10, color: "#4b4650", kind: "smoke" });
      }
    }
  }
  for (let i = 0; i < 7; i++) {
    const a = away - 1.1 + i / 6 * 2.2;
    const x = port.x + Math.cos(a) * 395, y = port.y + Math.sin(a) * 395;
    const on = i < 2 + light * 4;
    dot(ctx, x, y, 3.5, on ? "#ffd99a" : "#3a3236");
    if (on) { glow(ctx, x, y, 34, port.color, .5); reflection(ctx, x, y + 12, port.color, .55, scene.time, 50); }
  }
}

function landingLights(ctx: Ink, scene: Scene, state: River) {
  const g = state.manifest.glow;
  const horizon = ctx.createRadialGradient(landing.x, 8600, 100, landing.x, 8600, 1900);
  horizon.addColorStop(0, `rgba(255,170,96,${.25 + g * .35})`); horizon.addColorStop(1, "rgba(255,170,96,0)");
  ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = horizon;
  ctx.fillRect(landing.x - 2000, 6800, 4000, 1800); ctx.restore();
  for (let i = -6; i <= 6; i++) {
    const x = landing.x + i * 210, y = 8330 + (i % 2) * 30;
    const on = hash(i, 1, 55) < .35 + g * .6;
    if (on) { dot(ctx, x - 20, y, 4, "#ffd59b"); dot(ctx, x + 20, y, 4, "#ffd59b"); glow(ctx, x, y, 90, "#ffb76b", .35); }
  }
  for (let i = 0; i < 9; i++) {
    const x = landing.x - 170 + i * 42, y = landing.y + 52 + Math.sin(i * 1.3) * 5;
    const sway = Math.sin(scene.time * 1.6 + i) * 2;
    dot(ctx, x, y + sway, 4.5, ["#ffcf8a", "#f59f80", "#ffe4a6"][i % 3]!);
    glow(ctx, x, y + sway, 40, "#ffb46e", .45);
    reflection(ctx, x, y - 70, "#ffbf80", .5, scene.time, 50);
  }
}

function wake(ctx: Ink, scene: Scene, id: string, at: Point & { vx?: number; vy?: number }, angle: number, speed: number, beam: number) {
  let trail = scene.wakes.get(id);
  if (!trail) { trail = []; scene.wakes.set(id, trail); }
  if (speed > 25 && (!trail.length || distance(trail.at(-1)!, at) > 14)) trail.push({ x: at.x - Math.cos(angle) * 26, y: at.y - Math.sin(angle) * 26, t: scene.time });
  while (trail.length && scene.time - trail[0]!.t > 2.4) trail.shift();
  ctx.save(); ctx.lineCap = "round";
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1]!, b = trail[i]!, age = (scene.time - b.t) / 2.4;
    const spread = beam * (.3 + age * 1.6), heading = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
    ctx.globalAlpha = (1 - age) * .5;
    ctx.strokeStyle = "#cfeef2"; ctx.lineWidth = 2.2 * (1 - age) + .4;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(a.x + Math.cos(heading) * spread * side, a.y + Math.sin(heading) * spread * side);
      ctx.lineTo(b.x + Math.cos(heading) * spread * side, b.y + Math.sin(heading) * spread * side);
      ctx.stroke();
    }
    if (i % 3 === 0) { ctx.globalAlpha = (1 - age) * .18; dot(ctx, b.x, b.y, 6 + age * 10, "#a9dbe3"); }
  }
  ctx.restore();
}

function hull(ctx: Ink, length: number, beam: number, fill: string | CanvasGradient, rim: string) {
  ctx.beginPath();
  ctx.moveTo(length * .55, 0);
  ctx.quadraticCurveTo(length * .35, -beam, length * .05, -beam);
  ctx.lineTo(-length * .45, -beam * .92);
  ctx.quadraticCurveTo(-length * .52, 0, -length * .45, beam * .92);
  ctx.lineTo(length * .05, beam);
  ctx.quadraticCurveTo(length * .35, beam, length * .55, 0);
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = rim; ctx.lineWidth = 2; ctx.stroke();
}

function playerBarge(ctx: Ink, scene: Scene, state: River, reduced: boolean) {
  const p = state.player, speed = Math.hypot(p.vx, p.vy);
  ctx.save(); ctx.translate(p.x, p.y);
  ctx.globalAlpha = .45; ctx.fillStyle = "#03060a";
  ctx.beginPath(); ctx.ellipse(6, 10, 46, 24, p.angle, 0, tau); ctx.fill(); ctx.globalAlpha = 1;
  ctx.rotate(p.angle);
  if (p.invulnerable > 0 && Math.floor(scene.time * 12) % 2 && !reduced) ctx.globalAlpha = .55;
  const wood = ctx.createLinearGradient(0, -20, 0, 20);
  wood.addColorStop(0, "#5a3f2f"); wood.addColorStop(.5, "#3f2c22"); wood.addColorStop(1, "#2a1c16");
  hull(ctx, 78, 20, wood, trimFor(state.manifest).color);
  ctx.strokeStyle = "#2b1d17"; ctx.lineWidth = 1.2;
  for (const y of [-10, 0, 10]) { ctx.beginPath(); ctx.moveTo(-30, y); ctx.lineTo(30, y * .8); ctx.stroke(); }
  // Cargo on deck.
  const cargo = Object.entries(p.cargo).flatMap(([item, n]) => Array<string>(Math.max(0, n)).fill(item)).slice(0, 12);
  cargo.forEach((item, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const x = -14 + col * 9, y = -11 + row * 9;
    ctx.fillStyle = cargoColor[item] ?? "#c9b08a"; ctx.fillRect(x, y, 8, 8);
    ctx.strokeStyle = "#1d1410"; ctx.lineWidth = 1; ctx.strokeRect(x, y, 8, 8);
  });
  // Stern cabin with a lit window.
  ctx.fillStyle = "#2a2230"; ctx.fillRect(-36, -11, 16, 22);
  ctx.fillStyle = trimFor(state.manifest).color; ctx.fillRect(-38, -12, 20, 4);
  ctx.fillStyle = "#ffcf8a"; ctx.fillRect(-31, -4, 6, 8);
  ctx.restore();
  // Cannon turret.
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.turret);
  ctx.fillStyle = "#17161b"; ctx.fillRect(4, -3.5, 26, 7);
  ctx.fillStyle = "#b08a52"; ctx.fillRect(26, -4.5, 4, 9);
  dot(ctx, 0, 0, 9, "#25222a"); dot(ctx, 0, 0, 4, "#b08a52");
  ctx.restore();
  // Bow lantern and its beam across the water.
  const bow = { x: p.x + Math.cos(p.angle) * 40, y: p.y + Math.sin(p.angle) * 40 };
  ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.translate(bow.x, bow.y); ctx.rotate(p.angle);
  const beam = ctx.createLinearGradient(0, 0, 360, 0);
  beam.addColorStop(0, "rgba(255,206,140,.28)"); beam.addColorStop(1, "rgba(255,206,140,0)");
  ctx.fillStyle = beam; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(360, -120); ctx.lineTo(360, 120); ctx.closePath(); ctx.fill();
  ctx.restore();
  const pulse = .9 + Math.sin(scene.time * 5) * .06;
  glow(ctx, bow.x, bow.y, 230, "#ffb86b", .28 * pulse);
  glow(ctx, bow.x, bow.y, 40, "#fff0c8", .9);
  dot(ctx, bow.x, bow.y, 4.5, "#fff6dc");
  if (speed > 200 && !reduced) spray(scene, p.x - Math.cos(p.angle) * 38, p.y - Math.sin(p.angle) * 38, 1, "#d7f1f4", 60, "foam", .5, 3, p.angle + Math.PI);
  if (p.hp < p.maxHp * .4 && !reduced && next() < .3) spray(scene, p.x, p.y, 1, "#3e3a40", 30, "smoke", 1.4, 12, -Math.PI / 2);
}

function pirateBoat(ctx: Ink, scene: Scene, pirate: River["pirates"][number]) {
  const big = pirate.heavy, len = big ? 68 : 52, beam = big ? 17 : 11;
  ctx.save(); ctx.translate(pirate.x, pirate.y);
  ctx.globalAlpha = .4; ctx.fillStyle = "#03060a"; ctx.beginPath(); ctx.ellipse(5, 8, len * .55, beam * 1.4, pirate.angle, 0, tau); ctx.fill(); ctx.globalAlpha = 1;
  ctx.rotate(pirate.angle);
  hull(ctx, len, beam, big ? "#2a282e" : "#21171a", big ? "#6d6a72" : "#7a3a36");
  if (big) {
    ctx.fillStyle = "#3a383f";
    for (const x of [-18, -2, 14]) ctx.fillRect(x, -beam + 3, 11, beam * 2 - 6);
    ctx.fillStyle = "#17161b"; ctx.fillRect(10, -9, 26, 5); ctx.fillRect(10, 4, 26, 5);
  } else {
    ctx.fillStyle = "#5a1f24";
    ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(10, -18 - Math.sin(scene.time * 2 + pirate.id) * 2); ctx.lineTo(16, 0); ctx.closePath(); ctx.fill();
    dot(ctx, -14, -3, 3.4, "#0d0b0e"); dot(ctx, -14, 4, 3.4, "#0d0b0e");
    ctx.fillStyle = "#17161b"; ctx.fillRect(8, -2.5, 20, 5);
  }
  ctx.restore();
  const lamp = { x: pirate.x - Math.cos(pirate.angle) * len * .35, y: pirate.y - Math.sin(pirate.angle) * len * .35 };
  const flicker = .8 + Math.sin(scene.time * 9 + pirate.id) * .2;
  glow(ctx, lamp.x, lamp.y, big ? 150 : 110, "#ff4a3a", .32 * flicker);
  dot(ctx, lamp.x, lamp.y, big ? 4.5 : 3.5, "#ff7a63");
  reflection(ctx, lamp.x, lamp.y, "#ff6a52", .6 * flicker, scene.time, 44);
  if (pirate.stun > 0) {
    ctx.save(); ctx.strokeStyle = "#bff4ff"; ctx.lineWidth = 2; ctx.globalAlpha = .8;
    for (let i = 0; i < 4; i++) {
      const a = scene.time * 6 + i * tau / 4;
      ctx.beginPath(); ctx.moveTo(pirate.x + Math.cos(a) * 18, pirate.y + Math.sin(a) * 18);
      ctx.lineTo(pirate.x + Math.cos(a + .4) * 30, pirate.y + Math.sin(a + .4) * 30); ctx.stroke();
    }
    ctx.restore();
  }
  if (pirate.hp < pirate.maxHp) bar(ctx, pirate.x, pirate.y - (big ? 40 : 32), big ? 54 : 40, pirate.hp / pirate.maxHp, "#ff7a63");
}

function bar(ctx: Ink, x: number, y: number, width: number, fraction: number, color: string) {
  ctx.fillStyle = "#0b0d12cc"; ctx.fillRect(x - width / 2 - 1, y - 1, width + 2, 6);
  ctx.fillStyle = color; ctx.fillRect(x - width / 2, y, width * Math.max(0, Math.min(1, fraction)), 4);
}

function traderBoat(ctx: Ink, scene: Scene, state: River, boat: River["boats"][number]) {
  const escort = state.manifest.contract?.kind === "escort" && state.manifest.contract.haul === boat.id;
  const color = boat.ambient ? "#a8d9c0" : boat.name === "Freight" ? "#d9c7a8" : "#8fd3e6";
  ctx.save(); ctx.translate(boat.x, boat.y);
  ctx.globalAlpha = .4; ctx.fillStyle = "#03060a"; ctx.beginPath(); ctx.ellipse(5, 8, 34, 15, boat.angle, 0, tau); ctx.fill(); ctx.globalAlpha = 1;
  ctx.rotate(boat.angle);
  hull(ctx, boat.name === "Freight" ? 74 : 58, boat.name === "Freight" ? 17 : 13, "#2f2924", "#6e5a48");
  ctx.fillStyle = "#4a3a2c"; ctx.fillRect(-12, -7, 18, 14);
  ctx.restore();
  const bow = { x: boat.x + Math.cos(boat.angle) * 26, y: boat.y + Math.sin(boat.angle) * 26 };
  glow(ctx, bow.x, bow.y, 110, color, .3); dot(ctx, bow.x, bow.y, 3.5, color);
  reflection(ctx, bow.x, bow.y, color, .5, scene.time, 40);
  ctx.font = "600 15px Manrope, sans-serif"; ctx.textAlign = "center";
  ctx.fillStyle = "#0b0d12aa"; ctx.fillText(boat.name, boat.x + 1, boat.y - 29);
  ctx.fillStyle = escort ? "#ffe2a6" : "#d9e8e3"; ctx.fillText(boat.name, boat.x, boat.y - 30);
  if (escort) {
    const r = 46 + Math.sin(scene.time * 4) * 5;
    ctx.strokeStyle = "#ffd28d"; ctx.lineWidth = 2.5; ctx.setLineDash([9, 7]);
    ctx.beginPath(); ctx.arc(boat.x, boat.y, r, scene.time, scene.time + tau); ctx.stroke(); ctx.setLineDash([]);
  }
  if (boat.hp < 65) bar(ctx, boat.x, boat.y + 26, 40, boat.hp / 65, "#8fe3a8");
}

function boom(ctx: Ink, scene: Scene, entry: River["booms"][number]) {
  const { from, to } = reaches[entry.id];
  const angle = Math.atan2(to.y - from.y, to.x - from.x) + Math.PI / 2;
  ctx.save(); ctx.translate(entry.x, entry.y); ctx.rotate(angle);
  ctx.strokeStyle = "#5d4a40"; ctx.lineWidth = 5; ctx.setLineDash([7, 4]);
  ctx.beginPath();
  for (let x = -175; x <= 175; x += 10) ctx.lineTo(x, Math.sin(x * .05 + scene.time * 2) * 3);
  ctx.stroke(); ctx.setLineDash([]);
  for (let x = -150; x <= 150; x += 50) {
    const bob = Math.sin(scene.time * 2.4 + x) * 2;
    ctx.fillStyle = "#4a2e28"; ctx.beginPath(); ctx.ellipse(x, bob, 12, 8, 0, 0, tau); ctx.fill();
    ctx.strokeStyle = "#9a6a4c"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.strokeStyle = "#b4b2ba"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 6, bob - 10); ctx.lineTo(x - 2, bob - 4); ctx.moveTo(x + 6, bob - 10); ctx.lineTo(x + 2, bob - 4); ctx.stroke();
  }
  for (const end of [-185, 185]) {
    ctx.fillStyle = "#2a2226"; ctx.fillRect(end - 22, -22, 44, 44);
    ctx.strokeStyle = "#7a5a4a"; ctx.lineWidth = 2; ctx.strokeRect(end - 22, -22, 44, 44);
    ctx.fillStyle = "#17161b"; ctx.fillRect(end - 4, -30, 8, 18);
  }
  ctx.restore();
  for (const end of [-185, 185]) {
    const x = entry.x + Math.cos(angle) * end, y = entry.y + Math.sin(angle) * end;
    const blink = Math.sin(scene.time * 5 + end) > 0 ? 1 : .4;
    glow(ctx, x, y, 90, "#ff4a3a", .4 * blink); dot(ctx, x, y, 4, "#ff8a72");
  }
  bar(ctx, entry.x, entry.y - 52, 90, entry.hp / 76, "#ffb35c");
}

function floating(ctx: Ink, scene: Scene, state: River) {
  for (const drop of state.drops) {
    const bob = Math.sin(scene.time * 2.2 + drop.x) * 3;
    if (drop.cargo) {
      glow(ctx, drop.x, drop.y, 70, "#85ddcc", .45);
      for (let i = 0; i < 3; i++) { ctx.fillStyle = "#6b4a32"; ctx.fillRect(drop.x - 14 + i * 9, drop.y - 6 + bob + (i % 2) * 4, 9, 9); }
      ctx.strokeStyle = "#85ddcc"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(drop.x, drop.y, 22 + Math.sin(scene.time * 4) * 3, 0, tau); ctx.stroke();
    } else {
      glow(ctx, drop.x, drop.y, 40, "#ffe1a6", .3);
      ctx.fillStyle = "#8a6a3a"; ctx.fillRect(drop.x - 6, drop.y - 5 + bob, 12, 10);
    }
  }
  for (const barrel of state.barrels.filter(barrel => !barrel.taken)) {
    const bob = Math.sin(scene.time * 2 + barrel.id) * 3, color = barrel.kind === "fuel" ? "#ff9a4e" : barrel.kind === "ammo" ? "#ffe1a6" : "#8fe3a8";
    ctx.strokeStyle = "#9fd2dc"; ctx.globalAlpha = .35; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(barrel.x, barrel.y, 18 + (scene.time * 12 + barrel.id * 5) % 18, 0, tau); ctx.stroke(); ctx.globalAlpha = 1;
    glow(ctx, barrel.x, barrel.y, 46, color, .35);
    ctx.fillStyle = "#3d2a20"; ctx.beginPath(); ctx.ellipse(barrel.x, barrel.y + bob, 11, 14, .3, 0, tau); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(barrel.x, barrel.y + bob, 11, 14, .3, 0, tau); ctx.stroke();
    ctx.fillStyle = color; ctx.font = "700 12px Manrope, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(barrel.kind === "fuel" ? "F" : barrel.kind === "ammo" ? "A" : "+", barrel.x, barrel.y + bob + 4);
  }
}

function updateFx(scene: Scene, dt: number) {
  for (const p of scene.particles) {
    p.life -= dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    const drag = p.kind === "smoke" ? .9 : p.kind === "debris" ? 1.6 : 2.8;
    p.vx *= Math.exp(-drag * dt); p.vy *= Math.exp(-drag * dt);
    if (p.kind === "smoke") p.size += dt * 14;
    if (p.angle !== undefined) p.angle += (p.spin ?? 0) * dt;
  }
  scene.particles = scene.particles.filter(p => p.life > 0).slice(-700);
  for (const r of scene.rings) r.life -= dt;
  scene.rings = scene.rings.filter(r => r.life > 0);
  for (const l of scene.labels) { l.life -= dt; l.y -= dt * 34; }
  scene.labels = scene.labels.filter(l => l.life > 0);
  for (const f of scene.flashes) f.life -= dt;
  scene.flashes = scene.flashes.filter(f => f.life > 0);
  scene.shake = Math.max(0, scene.shake - dt * 40);
  scene.hurt = Math.max(0, scene.hurt - dt * 1.4);
  scene.whiteout = Math.max(0, scene.whiteout - dt * 1.2);
  scene.lightning = Math.max(0, scene.lightning - dt * 2.4);
  scene.smokeTimer -= dt;
  if (scene.announce) { scene.announce.life -= dt; if (scene.announce.life <= 0) scene.announce = undefined; }
}

function drawFx(ctx: Ink, scene: Scene) {
  for (const p of scene.particles.filter(p => p.kind === "smoke")) {
    ctx.globalAlpha = Math.max(0, p.life / p.max) * .45;
    dot(ctx, p.x, p.y, p.size, p.color);
  }
  ctx.globalAlpha = 1;
  for (const p of scene.particles.filter(p => p.kind === "debris")) {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle ?? 0);
    ctx.globalAlpha = Math.min(1, p.life / p.max * 2);
    ctx.fillStyle = p.color; ctx.fillRect(-p.size, -p.size / 3, p.size * 2, p.size * .66);
    ctx.restore();
  }
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  for (const p of scene.particles.filter(p => p.kind !== "smoke" && p.kind !== "debris")) {
    const fade = Math.max(0, p.life / p.max);
    ctx.globalAlpha = fade;
    if (p.kind === "spark" || p.kind === "ember") {
      ctx.strokeStyle = p.color; ctx.lineWidth = p.size * .7;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * .035, p.y - p.vy * .035); ctx.stroke();
    } else dot(ctx, p.x, p.y, p.size * (p.kind === "foam" ? 1 : fade + .3), p.color);
  }
  for (const f of scene.flashes) glow(ctx, f.x, f.y, f.radius, f.color, f.life / f.max);
  ctx.restore();
  for (const r of scene.rings) {
    const t = 1 - r.life / r.max;
    ctx.globalAlpha = r.life / r.max; ctx.strokeStyle = r.color; ctx.lineWidth = r.width;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.from + (r.to - r.from) * (1 - (1 - t) ** 2), 0, tau); ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.textAlign = "center";
  for (const l of scene.labels) {
    ctx.globalAlpha = Math.min(1, l.life / l.max * 2.2);
    ctx.font = (l.big ? "800 22px" : "700 15px") + " Manrope, sans-serif";
    ctx.fillStyle = "#0a0c10"; ctx.fillText(l.text, l.x + 1.5, l.y + 1.5);
    ctx.fillStyle = l.color; ctx.fillText(l.text, l.x, l.y);
  }
  ctx.globalAlpha = 1;
}

function floodtide(ctx: Ink, scene: Scene, state: River, width: number, height: number, reduced: boolean) {
  const flood = state.floodtide;
  if (!flood) return;
  ctx.fillStyle = "rgba(40,80,120,.18)"; ctx.fillRect(0, 0, width, height);
  if (!reduced) {
    ctx.strokeStyle = "rgba(190,220,240,.35)"; ctx.lineWidth = 1.2;
    for (const drop of scene.rain) {
      const y = (drop.y * height + scene.time * 900 * drop.s) % height, x = (drop.x * width + scene.time * 120 * drop.s) % width;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 7 * drop.s, y + 22 * drop.s); ctx.stroke();
    }
  }
  if (scene.lightning > 0 && !reduced) { ctx.fillStyle = `rgba(220,235,255,${scene.lightning * .4})`; ctx.fillRect(0, 0, width, height); }
}

function gates(ctx: Ink, scene: Scene, state: River) {
  const flood = state.floodtide;
  if (!flood) return;
  flood.gates.forEach((gate, i) => {
    const open = i < flood.next, current = i === flood.next;
    const color = open ? "#8fe3a8" : current ? "#bfeaff" : "#5d7a8a";
    glow(ctx, gate.x, gate.y, current ? 220 : 120, color, current ? .45 + Math.sin(scene.time * 4) * .1 : .2);
    ctx.strokeStyle = color; ctx.lineWidth = current ? 5 : 3;
    ctx.beginPath(); ctx.arc(gate.x, gate.y, 86, 0, tau); ctx.stroke();
    ctx.font = "800 18px Manrope, sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = color;
    ctx.fillText(open ? "LOCK " + (i + 1) + " ✓" : "LOCK " + (i + 1), gate.x, gate.y - 100);
  });
}

function indicators(ctx: Ink, state: River, view: { x: number; y: number; scale: number }, width: number, height: number) {
  const p = state.player, target = objective(state);
  const toScreen = (pt: Point) => ({ x: (pt.x - view.x) * view.scale, y: (pt.y - view.y) * view.scale });
  const edge = (pt: Point, color: string, text?: string, size = 14) => {
    const s = toScreen(pt);
    if (s.x > 40 && s.x < width - 40 && s.y > 40 && s.y < height - 40) return;
    const cx = width / 2, cy = height / 2, a = Math.atan2(s.y - cy, s.x - cx);
    const r = Math.min((width / 2 - 46) / Math.abs(Math.cos(a) || 1e-3), (height / 2 - 46) / Math.abs(Math.sin(a) || 1e-3));
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(size, 0); ctx.lineTo(-size * .7, -size * .75); ctx.lineTo(-size * .3, 0); ctx.lineTo(-size * .7, size * .75); ctx.closePath(); ctx.fill();
    ctx.restore();
    if (text) {
      ctx.font = "700 13px Manrope, sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#0a0c10"; ctx.fillText(text, x - Math.cos(a) * 30 + 1, y - Math.sin(a) * 30 + 5);
      ctx.fillStyle = color; ctx.fillText(text, x - Math.cos(a) * 30, y - Math.sin(a) * 30 + 4);
    }
  };
  for (const pirate of state.pirates) if (distance(pirate, p) < 1100) edge(pirate, "#ff6a52", undefined, 10);
  for (const barrel of state.barrels) if (!barrel.taken && distance(barrel, p) < 900) edge(barrel, "#8fe3a8", undefined, 8);
  edge(target, "#ffd28d", Math.round(distance(target, p) / 100) * 100 + " m", 16);
}

/** Draws one frame of the River Run. Returns nothing; sound cues go through `cue` during `absorb`. */
export function drawRiver(ctx: Ink, scene: Scene, state: River, villageState: Snapshot["villages"], width: number, height: number,
  options: { reduced: boolean; low: boolean; dt: number }) {
  const { reduced, low } = options, p = state.player;
  scene.time += options.dt;
  updateFx(scene, options.dt);
  if (state.floodtide && !reduced) {
    scene.nextThunder -= options.dt;
    if (scene.nextThunder <= 0) { scene.lightning = 1; scene.nextThunder = 3.5 + hash(Math.floor(scene.time), 9, 3) * 4; }
  }
  const view = camera(width, height, p);
  if (scene.shake && !reduced) { view.x += (next() - .5) * scene.shake; view.y += (next() - .5) * scene.shake; }
  const world = { x: view.x, y: view.y, w: width / view.scale, h: height / view.scale };
  ctx.fillStyle = "#0d0e14"; ctx.fillRect(0, 0, width, height);
  ctx.save(); ctx.scale(view.scale, view.scale); ctx.translate(-view.x, -view.y);
  drawTerrain(ctx, scene.terrain, world, 2);
  water(ctx, scene, world, low);
  landingLights(ctx, scene, state);
  for (const id of Object.keys(villages) as VillageId[]) {
    if (distance(villages[id], p) < 2200) village(ctx, scene, id, (villageState[id]?.band ?? "healthy") as keyof typeof bandLight);
  }
  if (scene.smokeTimer <= 0) scene.smokeTimer = .9;
  lampPosts(ctx, scene, state, world);
  floating(ctx, scene, state);
  for (const b of state.boats.filter(b => b.active)) wake(ctx, scene, "b" + b.id, b, b.angle, 120, 10);
  for (const pirate of state.pirates) wake(ctx, scene, "p" + pirate.id, pirate, pirate.angle, 110, pirate.heavy ? 14 : 9);
  wake(ctx, scene, "player", p, p.angle, Math.hypot(p.vx, p.vy), 16);
  for (const entry of state.booms.filter(b => b.hp > 0)) boom(ctx, scene, entry);
  for (const b of state.boats.filter(b => b.active)) traderBoat(ctx, scene, state, b);
  for (const pirate of state.pirates) pirateBoat(ctx, scene, pirate);
  for (const bullet of state.bullets) {
    const color = bullet.friendly ? "#ffd691" : "#ff7a63";
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.globalAlpha = .8; ctx.beginPath(); ctx.moveTo(bullet.x, bullet.y); ctx.lineTo(bullet.x - bullet.vx * .03, bullet.y - bullet.vy * .03); ctx.stroke();
    ctx.restore();
    glow(ctx, bullet.x, bullet.y, 18, color, .6); dot(ctx, bullet.x, bullet.y, 2.6, "#fff6e0");
  }
  playerBarge(ctx, scene, state, reduced);
  gates(ctx, scene, state);
  if (!low && !reduced) fireflies(ctx, scene, world);
  drawFx(ctx, scene);
  const target = objective(state);
  if (distance(p, target) > 140) {
    const heading = Math.atan2(target.y - p.y, target.x - p.x), bob = Math.sin(scene.time * 4) * 4;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(heading);
    ctx.fillStyle = "#ffd28d"; ctx.globalAlpha = .9;
    ctx.beginPath(); ctx.moveTo(104 + bob, 0); ctx.lineTo(84 + bob, -10); ctx.lineTo(89 + bob, 0); ctx.lineTo(84 + bob, 10); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // Screen-space atmosphere.
  if (!low) {
    const mist = ctx.createRadialGradient(width / 2, height / 2, height * .2, width / 2, height / 2, Math.max(width, height) * .75);
    mist.addColorStop(0, "rgba(10,12,20,0)"); mist.addColorStop(1, "rgba(6,7,12,.78)");
    ctx.fillStyle = mist; ctx.fillRect(0, 0, width, height);
  }
  floodtide(ctx, scene, state, width, height, reduced);
  const danger = p.hp < p.maxHp * .35 ? .35 + Math.sin(scene.time * 6) * .12 : 0;
  const red = Math.max(scene.hurt * .55, danger);
  if (red > 0) {
    const pain = ctx.createRadialGradient(width / 2, height / 2, height * .3, width / 2, height / 2, Math.max(width, height) * .7);
    pain.addColorStop(0, "rgba(160,30,30,0)"); pain.addColorStop(1, `rgba(170,32,32,${red})`);
    ctx.fillStyle = pain; ctx.fillRect(0, 0, width, height);
  }
  if (scene.whiteout > 0 && !reduced) { ctx.fillStyle = `rgba(214,247,255,${scene.whiteout})`; ctx.fillRect(0, 0, width, height); }
  indicators(ctx, state, view, width, height);
}

export function drawMap(ctx: Ink, state: River, villageState: Snapshot["villages"], width: number, height: number, labels: boolean) {
  ctx.fillStyle = "#0b1119"; ctx.fillRect(0, 0, width, height);
  const scale = Math.min(width / bounds.width, height / bounds.height) * (labels ? .94 : 1);
  const ox = (width - bounds.width * scale) / 2, oy = (height - bounds.height * scale) / 2;
  const x = (value: number) => ox + value * scale, y = (value: number) => oy + value * scale;
  ctx.lineCap = "round";
  for (const reach of state.manifest.reaches) {
    const path = reaches[reach.id as ReachId];
    const unsafe = reach.danger && !state.broken.includes(reach.id as ReachId);
    ctx.strokeStyle = "#16303a"; ctx.lineWidth = Math.max(4, 760 * scale);
    ctx.beginPath(); ctx.moveTo(x(path.from.x), y(path.from.y)); ctx.lineTo(x(path.to.x), y(path.to.y)); ctx.stroke();
    ctx.strokeStyle = unsafe ? "#9b4a44" : "#3f7f88"; ctx.lineWidth = labels ? 3 : 1.5;
    ctx.beginPath(); ctx.moveTo(x(path.from.x), y(path.from.y)); ctx.lineTo(x(path.to.x), y(path.to.y)); ctx.stroke();
    if (reach.boom && !state.broken.includes(reach.id as ReachId)) {
      const b = state.booms.find(entry => entry.id === reach.id);
      if (b) { ctx.strokeStyle = "#ff8a6a"; ctx.lineWidth = 2; const s = labels ? 7 : 4;
        ctx.beginPath(); ctx.moveTo(x(b.x) - s, y(b.y) - s); ctx.lineTo(x(b.x) + s, y(b.y) + s); ctx.moveTo(x(b.x) + s, y(b.y) - s); ctx.lineTo(x(b.x) - s, y(b.y) + s); ctx.stroke(); }
    }
    if (labels) {
      ctx.textAlign = "center"; ctx.font = "600 12px Manrope, sans-serif"; ctx.fillStyle = unsafe ? "#f0a090" : "#a8d6dc";
      ctx.fillText(path.name + (unsafe ? " · danger " + reach.danger : " · safe"), x((path.from.x + path.to.x) / 2) + 14, y((path.from.y + path.to.y) / 2) - 12);
    }
  }
  for (const [id, port] of Object.entries(villages)) {
    const band = villageState[id]?.band ?? "healthy";
    dot(ctx, x(port.x), y(port.y), labels ? 7 : 3.5, port.color);
    if (labels) {
      ctx.fillStyle = "#ffe1b3"; ctx.textAlign = "center"; ctx.font = "700 13px Manrope, sans-serif";
      ctx.fillText(port.name, x(port.x), y(port.y) - 14);
      ctx.font = "11px Manrope, sans-serif"; ctx.fillStyle = "#cdb9a6";
      ctx.fillText(band + " · " + Object.keys(port.goods).map(item => items[item as ItemId].name).join(", "), x(port.x), y(port.y) + 22);
    }
  }
  dot(ctx, x(landing.x), y(landing.y), labels ? 7 : 3.5, "#ffb46e");
  if (labels) { ctx.fillStyle = "#ffe1b3"; ctx.fillText("The Landing", x(landing.x), y(landing.y) + 22); }
  for (const boat of state.boats.filter(b => b.active)) dot(ctx, x(boat.x), y(boat.y), labels ? 3.5 : 2, "#8fd3e6");
  for (const pirate of state.pirates) if (distance(pirate, state.player) < 1600) dot(ctx, x(pirate.x), y(pirate.y), labels ? 3.5 : 2, "#ff6a52");
  for (const barrel of state.barrels) if (!barrel.taken) dot(ctx, x(barrel.x), y(barrel.y), labels ? 2.5 : 1.3, "#8fe3a8");
  const target = objective(state);
  ctx.strokeStyle = "#ffd28d"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x(target.x), y(target.y), labels ? 11 : 6, 0, tau); ctx.stroke();
  const p = state.player;
  ctx.save(); ctx.translate(x(p.x), y(p.y)); ctx.rotate(p.angle);
  ctx.fillStyle = "#fff6d0"; const s = labels ? 8 : 5;
  ctx.beginPath(); ctx.moveTo(s, 0); ctx.lineTo(-s * .7, -s * .6); ctx.lineTo(-s * .7, s * .6); ctx.closePath(); ctx.fill();
  ctx.restore();
}

export { reflection, glow };
