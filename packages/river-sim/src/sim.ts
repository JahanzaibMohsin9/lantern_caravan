import { bargeTier, landing, pirateCap, runMs, villageStrategy, villages, type ReachId, type VillageId } from "@lantern/content/river";
import { items, type ItemId } from "@lantern/content";
import { tradePrice } from "@lantern/game-core/pricing";
import type { RunManifest, RunReport } from "@lantern/protocol";
import { createBoats, distance, tickBoats } from "./bell";
import { along, beginFloodtide, blockBoom, clamp, createBooms, flare, keepInChannel, tickFloodtide } from "./hazards";

export { distance, objective, escortRadius, abandonSeconds, routeLead } from "./bell";
export const hz = 60;
const dt = 1 / hz;
export const harborRadius = 190;
export type Point = { x: number; y: number };
type Cargo = Record<string, number>;
type Player = Point & { vx: number; vy: number; angle: number; turret: number; hp: number; maxHp: number;
  fuel: number; ammo: number; wallet: number; cargo: Cargo; cooldown: number; invulnerable: number; visited: boolean };
type Pirate = Point & { reach: ReachId; hp: number; phase: number; cooldown: number; angle: number; stun: number };
type Bullet = Point & { vx: number; vy: number; life: number; damage: number; friendly: boolean };
type Drop = Point & { life: number; ammo: number; cargo?: Cargo };
type Input = { x?: number; y?: number; boost?: boolean; fire?: boolean; aim?: Point; flare?: boolean; moor?: boolean; floodtide?: boolean;
  trade?: { village: string; item: string; side: "buy" | "sell"; quantity: number } };
export type RiverInput = Input;
export { beginFloodtide };
type Recorded = { frame: number; input: Input };

export type River = {
  manifest: RunManifest; seed: number; frame: number; player: Player; bounty: number;
  bought: Record<string, RunReport["bought"][number]>; sold: Record<string, RunReport["soldBack"][number]>;
  lost: Cargo; flaresUsed: number; flareCooldown: number; kills: Partial<Record<ReachId, number>>;
  spawned: Partial<Record<ReachId, number>>; booms: ReturnType<typeof createBooms>; broken: ReachId[];
  pirates: Pirate[]; bullets: Bullet[]; drops: Drop[]; boats: ReturnType<typeof createBoats>; savedBoats: string[];
  escort: "active" | "completed" | "failed"; escortOutside: number; escortJoined: boolean;
  floodtide?: { gates: Point[]; next: number; deadline: number };
  rescueAt?: number; outcome?: RunReport["outcome"]; notice: string; log: Recorded[];
  effects: { kind: "shot" | "hit" | "break" | "flare"; x: number; y: number; frame: number }[];
};

export function createRiver(manifest: RunManifest): River {
  const hp = 100 + bargeTier(manifest.upgrades, "hull") * 35;
  return { manifest, seed: manifest.seed, frame: 0, bounty: manifest.bounty,
    player: { ...landing, vx: 0, vy: 0, angle: -Math.PI / 2, turret: -Math.PI / 2, hp, maxHp: hp,
      fuel: 100, ammo: 100, wallet: manifest.wallet, cargo: {}, cooldown: 0, invulnerable: 0, visited: false },
    bought: {}, sold: {}, lost: {}, flaresUsed: 0, flareCooldown: 0, kills: {}, spawned: {},
    booms: createBooms(manifest), broken: [], pirates: [], bullets: [], drops: [], boats: createBoats(manifest),
    savedBoats: [], escort: "active", escortOutside: 0, escortJoined: false, notice: "", effects: [], log: [] };
}

const count = (cargo: Cargo) => Object.values(cargo).reduce((a, b) => a + b, 0);
function rng(state: River) {
  state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
  return state.seed / 0x100000000;
}
function effect(state: River, kind: River["effects"][number]["kind"], at: Point) {
  state.effects.push({ kind, x: at.x, y: at.y, frame: state.frame });
}
export function nearVillage(state: River) {
  return (Object.keys(villages) as VillageId[]).find(id => distance(state.player, villages[id]) < harborRadius);
}

export function marketQuote(state: River, village: string, item: string, side: "buy" | "sell", quantity: number) {
  const lot = state.manifest.items.find(lot => lot.village === village && lot.item === item);
  if (!lot || !Number.isInteger(quantity) || quantity < 1) return { quantity: 0, amount: 0 };
  const bought = state.bought[item]?.quantity ?? 0, sold = state.sold[item]?.quantity ?? 0;
  const buy = side === "buy";
  const limit = buy ? Math.min(quantity, lot.prices.length - bought, state.manifest.hold - count(state.player.cargo)) :
    Math.min(quantity, state.player.cargo[item] ?? 0);
  const budget = buy ? state.player.wallet : lot.coins + (state.bought[item]?.paid ?? 0) - (state.sold[item]?.received ?? 0);
  let total = 0, units = 0;
  while (units < limit) {
    const next = buy
      ? lot.prices.slice(bought, bought + units + 1).reduce((a, b) => a + b, 0)
        - Number(lot.discount && bought + units + 1 >= 4) + Number(lot.discount && bought >= 4)
      : tradePrice("sell", items[item as ItemId].price, lot.stock + sold, lot.target, villageStrategy, units + 1);
    if (next > budget) break;
    total = next;
    units++;
  }
  return { quantity: units, amount: total };
}

function trade(state: River, order: NonNullable<Input["trade"]>) {
  const { village, item, side, quantity } = order;
  if (nearVillage(state) !== village) return;
  const quote = marketQuote(state, village, item, side, quantity);
  if (!quote.quantity) { state.notice = "No units available at that price."; return; }
  const p = state.player, buy = side === "buy";
  p.wallet += (buy ? -1 : 1) * quote.amount;
  p.cargo[item] = (p.cargo[item] ?? 0) + (buy ? 1 : -1) * quote.quantity;
  if (buy) {
    const old = state.bought[item];
    state.bought[item] = { village_id: village, item_id: item, quantity: (old?.quantity ?? 0) + quote.quantity, paid: (old?.paid ?? 0) + quote.amount };
  } else {
    const old = state.sold[item];
    state.sold[item] = { village_id: village, item_id: item, quantity: (old?.quantity ?? 0) + quote.quantity, received: (old?.received ?? 0) + quote.amount };
  }
  state.notice = (buy ? "Loaded " : "Sold ") + quote.quantity + " " + items[item as ItemId].name + " · " + quote.amount + " coins";
}

function moveBarge(state: River, input: Input) {
  const p = state.player, previous = { x: p.x, y: p.y };
  let x = clamp(input.x ?? 0, -1, 1), y = clamp(input.y ?? 0, -1, 1);
  const magnitude = Math.hypot(x, y);
  if (magnitude > 1) { x /= magnitude; y /= magnitude; }
  const powered = p.fuel > 0, boost = input.boost && powered;
  const max = (boost ? 345 : 235) + bargeTier(state.manifest.upgrades, "engine") * 35;
  const acceleration = powered ? (boost ? 1350 : 1020) : 55;
  const drag = Math.exp(-(magnitude > 0 ? powered ? 3.1 : 2.5 : 4.5) * dt);
  p.vx = (p.vx + x * acceleration * dt) * drag;
  p.vy = (p.vy + y * acceleration * dt) * drag;
  const speed = Math.hypot(p.vx, p.vy);
  if (speed > max) { p.vx *= max / speed; p.vy *= max / speed; }
  p.x += p.vx * dt; p.y += p.vy * dt;
  keepInChannel(p);
  blockBoom(state, previous);
  if (speed > 5) {
    const delta = Math.atan2(p.vy, p.vx) - p.angle;
    p.angle += Math.atan2(Math.sin(delta), Math.cos(delta)) * dt * 10;
    p.fuel = Math.max(0, p.fuel - dt * (boost ? .23 : .095) * Math.min(1, speed / 120));
  }
  p.cooldown = Math.max(0, p.cooldown - dt);
  p.invulnerable = Math.max(0, p.invulnerable - dt);
}

function fire(state: River, point: Point, angle: number, friendly: boolean) {
  const speed = friendly ? 650 : 330;
  state.bullets.push({ x: point.x + Math.cos(angle) * 24, y: point.y + Math.sin(angle) * 24,
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: friendly ? .85 : 1.6, friendly,
    damage: friendly ? 19 + bargeTier(state.manifest.upgrades, "cannon") * 7 : 5.5 });
}

function combat(state: River, input: Input) {
  const p = state.player;
  for (const reach of state.manifest.reaches) {
    const id = reach.id as ReachId;
    const cap = pirateCap(reach.danger, state.frame / hz);
    if ((state.spawned[id] ?? 0) >= cap) continue;
    const point = along(id, .22 + rng(state) * .58);
    state.pirates.push({ ...point, reach: id, hp: 42, cooldown: 1, phase: rng(state) * 6, angle: 0, stun: 0 });
    state.spawned[id] = (state.spawned[id] ?? 0) + 1;
  }
  state.flareCooldown = Math.max(0, state.flareCooldown - dt);
  if (input.flare && flare(state)) effect(state, "flare", p);
  const aim = input.aim ?? [...state.pirates, ...state.booms]
    .filter(target => target.hp > 0 && distance(target, p) < 540)
    .sort((a, b) => distance(a, p) - distance(b, p))[0];
  p.turret = aim ? Math.atan2(aim.y - p.y, aim.x - p.x) : p.angle;
  if (input.fire && aim && p.cooldown === 0 && p.ammo) {
    fire(state, p, p.turret, true);
    p.ammo--;
    p.cooldown = .23 - bargeTier(state.manifest.upgrades, "cannon") * .035;
    effect(state, "shot", p);
  }
  for (const pirate of state.pirates) {
    if (pirate.hp <= 0) continue;
    pirate.stun = Math.max(0, pirate.stun - dt);
    if (pirate.stun > 0) continue;
    pirate.cooldown -= dt;
    pirate.phase += dt;
    const boat = state.boats.filter(boat => boat.active && distance(boat, pirate) < 330)
      .sort((a, b) => distance(a, pirate) - distance(b, pirate))[0];
    const target = distance(pirate, p) < 650 ? p : boat;
    const range = target ? distance(pirate, target) : Infinity;
    pirate.angle = target ? Math.atan2(target.y - pirate.y, target.x - pirate.x) : pirate.phase * .3;
    const speed = target ? range > 185 ? 100 : range < 115 ? -48 : 0 : 22;
    pirate.x += Math.cos(pirate.angle) * speed * dt; pirate.y += Math.sin(pirate.angle) * speed * dt;
    if (range < 360 && pirate.cooldown <= 0) {
      fire(state, pirate, pirate.angle + (rng(state) - .5) * .17, false);
      pirate.cooldown = 1.6 + rng(state) * .6;
    }
    const bargeSpeed = Math.hypot(p.vx, p.vy);
    if (distance(pirate, p) < 34 && bargeSpeed > 100) {
      pirate.hp -= dt * bargeSpeed * .4;
      if (!p.invulnerable) p.hp -= dt * 10;
    }
  }
  for (const boom of state.booms) {
    if (boom.hp <= 0) continue;
    boom.cooldown = Math.max(0, boom.cooldown - dt);
    if (boom.cooldown === 0 && distance(boom, p) < 370) {
      fire(state, boom, Math.atan2(p.y - boom.y, p.x - boom.x), false);
      boom.cooldown = 2.6;
    }
  }
  for (const bullet of state.bullets) {
    bullet.x += bullet.vx * dt; bullet.y += bullet.vy * dt; bullet.life -= dt;
    const target = bullet.friendly
      ? state.pirates.find(pirate => pirate.hp > 0 && distance(bullet, pirate) < 23)
        ?? state.booms.find(boom => boom.hp > 0 && distance(bullet, boom) < 37)
      : p.invulnerable === 0 && distance(bullet, p) < 24 ? p
        : state.boats.find(boat => boat.active && distance(bullet, boat) < 20);
    if (!target) continue;
    target.hp -= bullet.damage * (target === p ? 1 - bargeTier(state.manifest.upgrades, "hull") * .13 : 1);
    bullet.life = 0;
    effect(state, "hit", target);
  }
  state.bullets = state.bullets.filter(bullet => bullet.life > 0);
  for (const pirate of state.pirates.filter(pirate => pirate.hp <= 0)) {
    for (const boat of state.boats) {
      if (boat.ambient && boat.active && distance(boat, pirate) < 330) boat.protected = true;
    }
    state.kills[pirate.reach] = (state.kills[pirate.reach] ?? 0) + 1;
    reward(state, pirate, 3, 14);
  }
  state.pirates = state.pirates.filter(pirate => pirate.hp > 0);
  for (const boom of state.booms.filter(boom => boom.hp <= 0 && !state.broken.includes(boom.id))) {
    state.broken.push(boom.id);
    reward(state, boom, 4, 35);
  }
}

function reward(state: River, at: Point, coins: number, ammo: number) {
  const pay = Math.min(coins, state.bounty);
  state.bounty -= pay;
  state.player.wallet += pay;
  state.drops.push({ x: at.x, y: at.y, life: 90, ammo });
  effect(state, "break", at);
}

function recover(state: River, input: Input) {
  const p = state.player;
  if (state.rescueAt !== undefined && (state.frame >= state.rescueAt || input.moor)) state.outcome = "sunk";
  for (const drop of state.drops) {
    drop.life -= dt;
    if (!state.outcome && drop.life > 0 && distance(drop, p) < 47) {
      p.ammo = Math.min(200, p.ammo + drop.ammo);
      for (const [item, units] of Object.entries(drop.cargo ?? {})) p.cargo[item] = (p.cargo[item] ?? 0) + units;
      if (drop.cargo) state.notice = "Cargo recovered. Press E to call the tow.";
      drop.cargo = undefined;
      drop.life = 0;
    }
    if (drop.cargo && (drop.life <= 0 || state.outcome)) {
      for (const [item, units] of Object.entries(drop.cargo)) state.lost[item] = (state.lost[item] ?? 0) + units;
    }
  }
  state.drops = state.drops.filter(drop => drop.life > 0);
  if (p.hp > 0 || state.rescueAt !== undefined) return;
  state.drops.push({ x: p.x, y: p.y, life: 20, ammo: 0, cargo: p.cargo });
  state.rescueAt = state.frame + 20 * hz;
  p.cargo = {};
  const angle = p.angle + Math.PI;
  p.x += Math.cos(angle) * 95; p.y += Math.sin(angle) * 95;
  Object.assign(p, { hp: p.maxHp, invulnerable: 25, vx: 0, vy: 0 });
  keepInChannel(p);
  state.notice = "Barge sinking. Recover the floating cargo within 20 seconds, then press E for a tow.";
}

export function stepRiver(state: River, input: Input = {}, record = true) {
  if (state.outcome) return;
  if (record && JSON.stringify(state.log.at(-1)?.input) !== JSON.stringify(input)) state.log.push({ frame: state.frame, input: structuredClone(input) });
  state.frame++;
  state.effects = state.effects.filter(entry => state.frame - entry.frame < 32);
  if (input.floodtide) beginFloodtide(state);
  if (state.floodtide) {
    moveBarge(state, input);
    tickFloodtide(state, dt);
    if (!state.outcome && state.frame >= runMs / 1000 * hz) state.outcome = "towed";
    return;
  }
  if (input.trade && state.rescueAt === undefined) trade(state, input.trade);
  if (nearVillage(state)) state.player.visited = true;
  if (input.moor && state.rescueAt === undefined && distance(state.player, landing) < harborRadius) {
    state.outcome = "moored"; return;
  }
  moveBarge(state, input);
  tickBoats(state, dt);
  combat(state, input);
  if (state.frame >= runMs / 1000 * hz) state.outcome = state.rescueAt === undefined ? "towed" : "sunk";
  recover(state, input);
}

export function replayRiver(manifest: RunManifest, log: readonly Recorded[], frames: number) {
  const state = createRiver(manifest);
  let index = 0, input: Input = {};
  for (let frame = 0; frame < frames && !state.outcome; frame++) {
    if (log[index]?.frame === frame) input = log[index++]!.input;
    stepRiver(state, input, false);
  }
  state.log = log.map(entry => structuredClone(entry));
  return state;
}
