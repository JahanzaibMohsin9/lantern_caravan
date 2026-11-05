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
/** Frames before the barge is towed home: the manifest may shorten a run that starts late in the night. */
export const limitFrames = (state: { manifest: RunManifest }) => (state.manifest.limitMs ?? runMs) / 1000 * hz;
export type Point = { x: number; y: number };
type Cargo = Record<string, number>;
type Player = Point & { vx: number; vy: number; angle: number; turret: number; hp: number; maxHp: number;
  fuel: number; ammo: number; wallet: number; cargo: Cargo; cooldown: number; invulnerable: number; visited: boolean };
type Pirate = Point & { id: number; reach: ReachId; hp: number; maxHp: number; heavy: boolean; phase: number; cooldown: number; angle: number; stun: number };
type Bullet = Point & { vx: number; vy: number; life: number; damage: number; friendly: boolean; hit?: boolean };
type Drop = Point & { life: number; ammo: number; cargo?: Cargo };
/** Floating supplies: drift in the shallows and refill fuel, ammo or hull when collected. */
export type Barrel = Point & { id: number; kind: "fuel" | "ammo" | "repair"; taken: boolean };
export type EffectKind = "shot" | "eshot" | "hit" | "splash" | "sink" | "boom" | "coin" | "flare" | "pickup" | "trade" | "spill";
export type RiverEffect = { kind: EffectKind; x: number; y: number; frame: number; amount?: number; target?: "player" | "pirate" | "boom" | "boat"; heavy?: boolean };
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
  effects: RiverEffect[]; barrels: Barrel[]; serial: number;
};

export function createRiver(manifest: RunManifest): River {
  const hp = 100 + bargeTier(manifest.upgrades, "hull") * 35;
  return { manifest, seed: manifest.seed, frame: 0, bounty: manifest.bounty,
    player: { ...landing, vx: 0, vy: 0, angle: -Math.PI / 2, turret: -Math.PI / 2, hp, maxHp: hp,
      fuel: 100, ammo: 100, wallet: manifest.wallet, cargo: {}, cooldown: 0, invulnerable: 0, visited: false },
    bought: {}, sold: {}, lost: {}, flaresUsed: 0, flareCooldown: 0, kills: {}, spawned: {},
    booms: createBooms(manifest), broken: [], pirates: [], bullets: [], drops: [], boats: createBoats(manifest),
    savedBoats: [], escort: "active", escortOutside: 0, escortJoined: false, notice: "", effects: [], log: [],
    barrels: createBarrels(manifest.seed), serial: 0 };
}

/** Barrel placement uses its own seeded stream, so it never shifts pirate spawns or replays. */
function createBarrels(seed: number): Barrel[] {
  let value = (seed ^ 0x9e3779b9) >>> 0;
  const next = () => (value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000;
  const ids: ReachId[] = ["heron_reach", "ember_cut", "mill_race", "marsh_bend"];
  const kinds: Barrel["kind"][] = ["fuel", "ammo", "repair", "fuel", "ammo"];
  return Array.from({ length: 10 }, (_, i) => {
    const at = along(ids[i % ids.length]!, .18 + next() * .64);
    const side = (next() - .5) * 360;
    return { id: i, x: at.x + side * .7, y: at.y + side * .4, kind: kinds[i % kinds.length]!, taken: false };
  }).map(barrel => { keepInChannel(barrel, 80); return barrel; });
}

const count = (cargo: Cargo) => Object.values(cargo).reduce((a, b) => a + b, 0);
function rng(state: River) {
  state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
  return state.seed / 0x100000000;
}
function effect(state: River, kind: EffectKind, at: Point, extra: Partial<RiverEffect> = {}) {
  state.effects.push({ kind, x: at.x, y: at.y, frame: state.frame, ...extra });
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
  effect(state, "trade", state.player, { amount: buy ? -quote.amount : quote.amount });
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
    const spawned = state.spawned[id] ?? 0;
    if (spawned >= cap) continue;
    const point = along(id, .22 + rng(state) * .58);
    // Dangerous reaches send an armored gunboat with every third crew.
    const heavy = reach.danger >= 3 && spawned % 3 === 2;
    const hp = heavy ? 96 : 42;
    state.pirates.push({ ...point, id: ++state.serial, reach: id, hp, maxHp: hp, heavy, cooldown: 1, phase: rng(state) * 6, angle: 0, stun: 0 });
    state.spawned[id] = spawned + 1;
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
    effect(state, "shot", { x: p.x + Math.cos(p.turret) * 26, y: p.y + Math.sin(p.turret) * 26 }, { amount: p.turret });
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
    const speed = (target ? range > 185 ? 100 : range < 115 ? -48 : 0 : 22) * (pirate.heavy ? .68 : 1);
    pirate.x += Math.cos(pirate.angle) * speed * dt; pirate.y += Math.sin(pirate.angle) * speed * dt;
    keepInChannel(pirate, 30);
    if (range < 360 && pirate.cooldown <= 0) {
      const spread = (rng(state) - .5) * .17;
      fire(state, pirate, pirate.angle + spread, false);
      if (pirate.heavy) fire(state, pirate, pirate.angle - spread - .16, false);
      effect(state, "eshot", pirate, { amount: pirate.angle, heavy: pirate.heavy });
      pirate.cooldown = (1.6 + rng(state) * .6) * (pirate.heavy ? 1.35 : 1);
    }
    const bargeSpeed = Math.hypot(p.vx, p.vy);
    if (distance(pirate, p) < (pirate.heavy ? 42 : 34) && bargeSpeed > 100) {
      pirate.hp -= dt * bargeSpeed * (pirate.heavy ? .22 : .4);
      if (!p.invulnerable) p.hp -= dt * (pirate.heavy ? 16 : 10);
    }
  }
  for (const boom of state.booms) {
    if (boom.hp <= 0) continue;
    boom.cooldown = Math.max(0, boom.cooldown - dt);
    if (boom.cooldown === 0 && distance(boom, p) < 370) {
      const angle = Math.atan2(p.y - boom.y, p.x - boom.x);
      fire(state, boom, angle, false);
      effect(state, "eshot", boom, { amount: angle });
      boom.cooldown = 2.6;
    }
  }
  for (const bullet of state.bullets) {
    bullet.x += bullet.vx * dt; bullet.y += bullet.vy * dt; bullet.life -= dt;
    const pirate = bullet.friendly ? state.pirates.find(pirate => pirate.hp > 0 && distance(bullet, pirate) < (pirate.heavy ? 30 : 23)) : undefined;
    const boom = bullet.friendly && !pirate ? state.booms.find(boom => boom.hp > 0 && distance(bullet, boom) < 37) : undefined;
    const barge = !bullet.friendly && p.invulnerable === 0 && distance(bullet, p) < 24 ? p : undefined;
    const boat = !bullet.friendly && !barge ? state.boats.find(boat => boat.active && distance(bullet, boat) < 20) : undefined;
    const target = pirate ?? boom ?? barge ?? boat;
    if (!target) {
      if (bullet.life <= 0) effect(state, "splash", bullet);
      continue;
    }
    target.hp -= bullet.damage * (target === p ? 1 - bargeTier(state.manifest.upgrades, "hull") * .13 : 1);
    bullet.life = 0;
    bullet.hit = true;
    effect(state, "hit", bullet, { target: pirate ? "pirate" : boom ? "boom" : barge ? "player" : "boat", amount: Math.round(bullet.damage) });
  }
  state.bullets = state.bullets.filter(bullet => bullet.life > 0);
  for (const pirate of state.pirates.filter(pirate => pirate.hp <= 0)) {
    for (const boat of state.boats) {
      if (boat.ambient && boat.active && distance(boat, pirate) < 330) boat.protected = true;
    }
    state.kills[pirate.reach] = (state.kills[pirate.reach] ?? 0) + 1;
    effect(state, "sink", pirate, { heavy: pirate.heavy, amount: pirate.angle });
    reward(state, pirate, 3, pirate.heavy ? 30 : 14);
  }
  state.pirates = state.pirates.filter(pirate => pirate.hp > 0);
  for (const boom of state.booms.filter(boom => boom.hp <= 0 && !state.broken.includes(boom.id))) {
    state.broken.push(boom.id);
    effect(state, "boom", boom);
    reward(state, boom, 4, 35);
  }
}

function reward(state: River, at: Point, coins: number, ammo: number) {
  const pay = Math.min(coins, state.bounty);
  state.bounty -= pay;
  state.player.wallet += pay;
  state.drops.push({ x: at.x, y: at.y, life: 90, ammo });
  if (pay) effect(state, "coin", at, { amount: pay });
}

function salvage(state: River) {
  const p = state.player;
  for (const barrel of state.barrels) {
    if (barrel.taken || distance(barrel, p) > 46) continue;
    barrel.taken = true;
    if (barrel.kind === "fuel") p.fuel = Math.min(100, p.fuel + 30);
    if (barrel.kind === "ammo") p.ammo = Math.min(200, p.ammo + 40);
    if (barrel.kind === "repair") p.hp = Math.min(p.maxHp, p.hp + 30);
    state.notice = barrel.kind === "fuel" ? "Fuel barrel · +30 fuel" : barrel.kind === "ammo" ? "Shot crate · +40 ammo" : "Patch kit · +30 hull";
    effect(state, "pickup", barrel, { amount: ["fuel", "ammo", "repair"].indexOf(barrel.kind) });
  }
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
  effect(state, "spill", p);
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
    if (!state.outcome && state.frame >= limitFrames(state)) state.outcome = "towed";
    return;
  }
  if (input.trade && state.rescueAt === undefined) trade(state, input.trade);
  if (nearVillage(state)) state.player.visited = true;
  if (input.moor && state.rescueAt === undefined && distance(state.player, landing) < harborRadius) {
    state.outcome = "moored"; return;
  }
  moveBarge(state, input);
  salvage(state);
  tickBoats(state, dt);
  combat(state, input);
  if (state.frame >= limitFrames(state)) state.outcome = state.rescueAt === undefined ? "towed" : "sunk";
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
