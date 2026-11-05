import { landing, reachIds, reaches, reachWidth, trimFor, type ReachId } from "@lantern/content/river";
import { distance, routePoint } from "./bell";
import type { Point, River } from "./sim";

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const along = (id: ReachId, t: number) => {
  const { from, to } = reaches[id];
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
};
function project(point: Point, id: ReachId) {
  const { from, to } = reaches[id];
  const dx = to.x - from.x, dy = to.y - from.y;
  return along(id, clamp(((point.x - from.x) * dx + (point.y - from.y) * dy) / (dx * dx + dy * dy), 0, 1));
}
/** Nearest point on the channel centerline, used by both the barge's collision and the renderer. */
export function channelCenter(point: Point) {
  return reachIds.map(id => ({ id, at: project(point, id) }))
    .reduce((a, b) => distance(a.at, point) <= distance(b.at, point) ? a : b);
}
export function keepInChannel(player: Point & { vx?: number; vy?: number }, margin = 22) {
  const center = channelCenter(player).at;
  const offset = distance(center, player);
  if (offset <= reachWidth / 2 - margin) return;
  const scale = (reachWidth / 2 - margin) / offset;
  player.x = center.x + (player.x - center.x) * scale;
  player.y = center.y + (player.y - center.y) * scale;
  if (player.vx !== undefined) player.vx *= .65;
  if (player.vy !== undefined) player.vy *= .65;
}

export const createBooms = (manifest: River["manifest"]) => manifest.reaches.filter(reach => reach.boom)
  .map(reach => ({ id: reach.id as ReachId, ...along(reach.id as ReachId, .53), hp: 76, cooldown: 0 }));

export function blockBoom(state: River, previous: Point) {
  const p = state.player;
  for (const boom of state.booms) {
    if (boom.hp <= 0) continue;
    const { from, to } = reaches[boom.id];
    const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
    const axial = (point: Point) => ((point.x - boom.x) * dx + (point.y - boom.y) * dy) / length;
    const lateral = Math.abs((p.x - boom.x) * dy - (p.y - boom.y) * dx) / length;
    if (lateral > 175 || Math.abs(axial(p)) > 40 || Math.abs(axial(p)) >= Math.abs(axial(previous))) continue;
    Object.assign(p, previous, { vx: 0, vy: 0 });
  }
}

export function flare(state: River) {
  if (state.flareCooldown > 0 || (state.player.cargo.oil ?? 0) <= 0) return false;
  state.player.cargo.oil!--;
  state.flaresUsed++;
  state.flareCooldown = 10;
  for (const pirate of state.pirates.filter(pirate => distance(pirate, state.player) <= 265)) {
    pirate.stun = 3;
    pirate.hp -= 15;
    state.effects.push({ kind: "hit", target: "pirate", x: pirate.x, y: pirate.y, frame: state.frame });
  }
  for (const boom of state.booms.filter(boom => boom.hp > 0 && distance(boom, state.player) <= 265)) {
    boom.cooldown = 4;
    boom.hp -= 19;
  }
  state.bullets = state.bullets.filter(bullet => bullet.friendly || distance(bullet, state.player) > 265);
  return true;
}

export function beginFloodtide(state: River) {
  if (state.outcome || state.floodtide || state.rescueAt !== undefined) return;
  const player = state.player, fork = reaches.heron_reach.to;
  const route = player.y < fork.y ? [player, fork, landing] : [player, landing];
  state.floodtide = { gates: [.37, .73].map(fraction => routePoint(route, fraction)), next: 0, deadline: state.frame + 60 * 60 };
  state.bullets = [];
  player.fuel = Math.max(14, player.fuel);
  state.notice = "Floodtide. Pass both lock gates, then reach The Landing.";
}

export function tickFloodtide(state: River, dt: number) {
  const flood = state.floodtide!, p = state.player;
  const remaining = (flood.deadline - state.frame) / 60;
  if (distance(p, landing) > 168) {
    p.hp = Math.max(0, p.hp - dt * (Math.hypot(p.vx, p.vy) > 120 ? .65 : 1.7) * trimFor(state.manifest).incoming);
    p.vx += Math.sin(remaining * 1.7) * dt * 85;
    p.vy -= Math.cos(remaining * 1.2) * dt * 70;
  }
  if (p.hp <= 0 || remaining <= 0) {
    state.outcome = p.hp <= 0 ? "sunk" : "towed";
    return;
  }
  const gate = flood.gates[flood.next];
  if (gate && distance(p, gate) <= 86) {
    flood.next++;
    state.notice = flood.next === 2 ? "Both locks open. Reach The Landing." : "First lock open. Follow the next beacon.";
  }
  if (!gate && distance(p, landing) <= 120) state.outcome = "moored";
}
