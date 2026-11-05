import { landing, reaches, villages, type ReachId, type VillageId } from "@lantern/content/river";
import type { RunManifest } from "@lantern/protocol";
import type { Point, River } from "./sim";

export const escortRadius = 530;
export const abandonSeconds = 14;
const fork = reaches.heron_reach.to;
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function riverLeg(id: ReachId, blocked: boolean): Point[] {
  const { from, to } = reaches[id];
  if (!blocked) return [from, to];
  const length = distance(from, to);
  const offset = { x: (to.y - from.y) * 235 / length, y: (from.x - to.x) * 235 / length };
  const via = [.38, .67].map(t => ({
    x: from.x + (to.x - from.x) * t + offset.x, y: from.y + (to.y - from.y) * t + offset.y,
  }));
  return [from, ...via, to];
}

export function boatRoute(from: VillageId, to?: VillageId, blocked: readonly string[] = []) {
  const upstream = villages[from].reach;
  const downstream = to ? villages[to].reach : "heron_reach";
  return [...riverLeg(upstream, blocked.includes(upstream)).reverse(),
    ...(to ? riverLeg(downstream, blocked.includes(downstream)) : riverLeg(downstream, blocked.includes(downstream)).reverse()).slice(1)];
}

export function routePoint(route: Point[], fraction: number): Point {
  const lengths = route.slice(1).map((point, i) => distance(route[i]!, point));
  let remaining = Math.max(0, Math.min(1, fraction)) * lengths.reduce((a, b) => a + b, 0);
  for (const [i, length] of lengths.entries()) {
    if (length > 0 && remaining <= length) {
      const from = route[i]!, to = route[i + 1]!, t = remaining / length;
      return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    }
    remaining -= length;
  }
  return route.at(-1)!;
}

export function createBoats(manifest: RunManifest) {
  return manifest.boats.map(boat => {
    const route = boatRoute(boat.village as VillageId, boat.destination as VillageId | undefined,
      manifest.reaches.filter(reach => reach.boom).map(reach => reach.id));
    return { ...boat, route, ...routePoint(route, 0), angle: 0, hp: 65, active: false, protected: false };
  });
}

export function tickBoats(state: River, dt: number) {
  const time = state.frame / 60;
  for (const boat of state.boats) {
    const fraction = (time - boat.departs) / Math.max(1, boat.arrives - boat.departs);
    const next = routePoint(boat.route, fraction);
    if (distance(boat, next) > 0) boat.angle = Math.atan2(next.y - boat.y, next.x - boat.x);
    Object.assign(boat, next);
    boat.active = fraction >= 0 && fraction <= 1 && boat.hp > 0;
    if (boat.ambient && fraction >= 1 && boat.hp > 0 && boat.protected &&
      !state.savedBoats.includes(boat.id)) {
      state.savedBoats.push(boat.id);
      const pay = Math.min(1, state.bounty);
      state.bounty -= pay;
      state.player.wallet += pay;
    }
    if (state.manifest.contract?.haul !== boat.id || state.escort !== "active" || fraction < 0) continue;
    const close = distance(boat, state.player) <= escortRadius;
    if (close) {
      state.escortJoined = true;
      state.escortOutside = 0;
    } else if (state.escortJoined) state.escortOutside += dt;
    if (boat.hp <= 0 || state.escortOutside >= abandonSeconds || (!state.escortJoined && time - boat.departs >= 20))
      state.escort = "failed";
    else if (fraction >= 1) state.escort = close && state.escortJoined ? "completed" : "failed";
  }
}

export function objective(state: River): Point & { name: string } {
  const flood = state.floodtide;
  if (flood) return flood.gates[flood.next] ? { ...flood.gates[flood.next]!, name: "Lock gate " + (flood.next + 1) + " / 2" }
    : { ...landing, name: "The Landing" };
  const contract = state.manifest.contract;
  if (contract?.kind === "escort" && state.escort === "active") {
    const boat = state.boats.find(boat => boat.id === contract.haul);
    if (boat) return { ...boat, name: "Escort " + boat.name };
  }
  const next = state.manifest.items.find(item => (state.bought[item.item]?.quantity ?? 0) < item.prices.length);
  const village = contract?.kind === "supply"
    ? ((state.player.cargo[contract.item] ?? 0) < contract.quantity ? contract.village : undefined)
    : state.player.visited ? undefined : next?.village;
  const port = village ? villages[village as VillageId] : undefined;
  if (port && state.player.y > reaches.heron_reach.to.y + 280)
    return { ...fork, name: port.name + " via the fork" };
  if (!port && state.player.y < fork.y - 280 && Math.abs(state.player.x - fork.x) > 420)
    return { ...fork, name: "The Landing via the fork" };
  return port ?? { ...landing, name: "The Landing" };
}

export function routeLead(sell: number, buy: number, length: number, risk: number) {
  return (sell - buy) / (1 + length / 1800 + risk);
}
