import type { ItemId } from "./index";

export const villages = {
  millbrook: { name: "Millbrook", keeper: "Oda", color: "#ffcf8a", goods: { paper: 24, cord: 16 }, x: 900, y: 1400, reach: "mill_race" },
  ember_falls: { name: "Ember Falls", keeper: "Bram", color: "#f0a050", goods: { oil: 24 }, x: 4900, y: 950, reach: "ember_cut" },
  reedmarsh: { name: "Reedmarsh", keeper: "Lio", color: "#8fcf9a", goods: { reed: 20, dye: 14 }, x: 8850, y: 1500, reach: "marsh_bend" },
} as const;
export type VillageId = keyof typeof villages;
export const villageIds = Object.keys(villages) as VillageId[];
export const villageGoods = (id: VillageId): Partial<Record<ItemId, number>> => villages[id].goods;
export const sourceFor = (item: ItemId) => villageIds.find(id => villageGoods(id)[item] !== undefined);

export const landing = { x: 4900, y: 7800 };
const fork = { x: 4900, y: 5000 };
export const reaches = {
  heron_reach: { name: "Heron Reach", from: landing, to: fork },
  ember_cut: { name: "Ember Cut", from: fork, to: villages.ember_falls },
  mill_race: { name: "Mill Race", from: fork, to: villages.millbrook },
  marsh_bend: { name: "Marsh Bend", from: fork, to: villages.reedmarsh },
} as const;
export type ReachId = keyof typeof reaches;
export const reachIds = Object.keys(reaches) as ReachId[];
export const routeDistance = (village: VillageId) => 2800 + Math.hypot(villages[village].x - fork.x, villages[village].y - fork.y);
export const runMs = 150_000;
export const reachWidth = 660;
export const villageStrategy = 7000;
export const pirateCap = (danger: number, seconds: number) =>
  danger && seconds >= 2 ? Math.min(danger * 2, 1 + Math.floor((seconds - 2) / (20 - 2 * danger))) : 0;

export const bargeUpgrades = {
  hold_i: { name: "Hold I", price: 30 }, hold_ii: { name: "Hold II", price: 60 },
  hull_i: { name: "Hull I", price: 25 }, hull_ii: { name: "Hull II", price: 50 },
  cannon_i: { name: "Cannon I", price: 30 }, cannon_ii: { name: "Cannon II", price: 60 },
  engine_i: { name: "Engine I", price: 25 }, engine_ii: { name: "Engine II", price: 50 },
} as const;
export type BargeUpgradeId = keyof typeof bargeUpgrades;
export const bargeTier = (upgrades: readonly string[], kind: string) =>
  upgrades.includes(kind + "_ii") ? 2 : upgrades.includes(kind + "_i") ? 1 : 0;
export const bargeHold = (upgrades: readonly string[]) => 12 + bargeTier(upgrades, "hold") * 4;

export const bargeTrims = {
  balanced: { name: "Balanced", color: "#d9c69c", description: "Standard handling, armor and weapons.", speed: 1, turning: 1, damage: 1, incoming: 1, fireRate: 1, fuel: 1 },
  runner: { name: "Runner", color: "#8bdcd0", description: "+15% speed and turning; shots deal 15% less damage.", speed: 1.15, turning: 1.15, damage: .85, incoming: 1, fireRate: 1, fuel: 1 },
  ironclad: { name: "Ironclad", color: "#a9b96d", description: "Take 25% less damage; speed and turning drop 15%.", speed: .85, turning: .85, damage: 1, incoming: .75, fireRate: 1, fuel: 1 },
  gunner: { name: "Gunner", color: "#edb16c", description: "Fire 20% faster; burn 20% more fuel.", speed: 1, turning: 1, damage: 1, incoming: 1, fireRate: 1.2, fuel: 1.2 },
} as const;
export type BargeTrimId = keyof typeof bargeTrims;
export const trimFor = (manifest: { trim?: BargeTrimId }) => bargeTrims[manifest.trim ?? "balanced"];

export const pirateRoles = {
  skiff: { name: "Skiff", color: "#edb16c", hp: 40, bounty: 6, speed: 148, approach: 0, retreat: 0, range: 0 },
  raider: { name: "Raider", color: "#ee7967", hp: 57, bounty: 8, speed: 100, approach: 185, retreat: 115, range: 360 },
  gunboat: { name: "Gunboat", color: "#b7a0e8", hp: 96, bounty: 14, speed: 68, approach: 300, retreat: 230, range: 460 },
} as const;
export type PirateRole = keyof typeof pirateRoles;
export const pirateRoleAt = (danger: number, index: number): PirateRole =>
  danger >= 3 && index % 3 === 2 ? "gunboat" : danger >= 2 && index % 3 === 1 ? "skiff" : "raider";
/**
 * Harbor almanac: village events that change one night's harvest. Each is announced the night before it acts,
 * so merchants and players can stock up or wait.
 */
export const almanacEvents = {
  oil_glut: { name: "Oil glut", village: "ember_falls", item: "oil", factor: 1.5, bonus: 0,
    detail: "The Ember Falls presses run all night: the oil harvest is half again as large." },
  pressing_strike: { name: "Pressing strike", village: "ember_falls", item: "oil", factor: .5, bonus: 0,
    detail: "The Ember Falls pressers strike: the oil harvest is halved." },
  mill_flood: { name: "Mill flood", village: "millbrook", item: "paper", factor: .5, bonus: 0,
    detail: "The Mill Race floods the paper mill: the paper harvest is halved. Cord is unaffected." },
  dye_bloom: { name: "Dye bloom", village: "reedmarsh", item: "dye", factor: 1, bonus: 6,
    detail: "Indigo blooms in the Reedmarsh pools: 6 extra dye." },
  reed_blight: { name: "Reed blight", village: "reedmarsh", item: "reed", factor: .5, bonus: 0,
    detail: "Blight in the reed beds: the reed harvest is halved." },
} as const satisfies Record<string, { name: string; village: VillageId; item: ItemId; factor: number; bonus: number; detail: string }>;
export type AlmanacId = keyof typeof almanacEvents;
const almanacIds = Object.keys(almanacEvents) as AlmanacId[];

/**
 * The event acting on a night's harvest, if any. The campaign scripts Night 3's pressing strike (announced on
 * Night 2). Endless and live rooms have one event every two nights from Night 3, seeded from the room seed;
 * the village rotates, so the same village never has two events in a row.
 */
export function almanacFor(mode: "campaign" | "endless" | "live", night: number, seed: number): AlmanacId | undefined {
  if (mode === "campaign") return night === 3 ? "pressing_strike" : undefined;
  if (night < 3 || night % 2 === 0) return undefined;
  const mix = (value: number) => { value = Math.imul(value ^ (value >>> 16), 0x45d9f3b); return (value ^ (value >>> 16)) >>> 0; };
  const order = Object.keys(villages) as VillageId[];
  const village = order[(mix(seed) + (night - 3) / 2) % order.length]!;
  const options = almanacIds.filter(id => almanacEvents[id].village === village);
  return options[mix(seed ^ Math.imul(night, 0x9e3779b1)) % options.length];
}
/** Harvest target for one good tonight, after any almanac event. */
export function harvestTarget(event: AlmanacId | undefined, village: VillageId, item: ItemId, target: number) {
  const entry = event && almanacEvents[event];
  return entry && entry.village === village && entry.item === item ? Math.round(target * entry.factor) + entry.bonus : target;
}

/** Player Bell orders: a player escrows coins and rival haulers decide whether to fetch the goods. */
export const bellOrderLimits = { quantity: 12, minPrice: 3, maxPrice: 20, haulUnits: 6 } as const;

/** A sunk haul becomes salvageable at the next dusk and breaks up after this many nights. */
export const wreckNights = 2;

type StopChoice = { id: string; label: string; cost?: Partial<Record<ItemId, number>>; coins?: number; hull?: number; fuel?: number; ammo?: number };
export const riverStops = {
  fisher: { name: "Stranded fisher", description: "A fisher is drifting with a torn net. Mend it and they'll patch your hull and share the catch money, or strip their wrecked skiff for shot.",
    choices: [
      { id: "mend", label: "Give 1 cord: +25 hull and a 6-coin bounty", cost: { cord: 1 }, hull: 25, coins: 6 },
      { id: "strip", label: "Strip the skiff: +30 ammo", ammo: 30 },
    ] as StopChoice[] },
  shed: { name: "Lock keeper's shed", description: "The keeper is away. One store cupboard is unlocked; the other is rusted shut once you open the first.",
    choices: [
      { id: "fuel", label: "Take the fuel cans: +18 fuel", fuel: 18 },
      { id: "ammo", label: "Take the shot crate: +30 ammo", ammo: 30 },
    ] as StopChoice[] },
  punt: { name: "Overturned punt", description: "A capsized punt is caught on the reeds. There's time to strip one thing before it slides under.",
    choices: [
      { id: "patch", label: "Cut its planks for a patch: +25 hull", hull: 25 },
      { id: "supplies", label: "Grab its stores: +20 fuel and +15 ammo", fuel: 20, ammo: 15 },
    ] as StopChoice[] },
};
export type StopKind = keyof typeof riverStops;
export type StopPlan = { id: string; kind: StopKind; reach: ReachId; at: number; side: number };
export const stopChoice = (kind: StopKind, choice: string) => riverStops[kind].choices.find(entry => entry.id === choice);

/** Two or three optional riverside stops, placed from the run seed on their own stream so pirates and replays never shift. */
export function stopPlan(seed: number, layout?: "campaign_reach"): StopPlan[] {
  if (layout === "campaign_reach") return [
    { id: "stop-0", kind: "shed", reach: "heron_reach", at: .25, side: .25 },
    { id: "stop-1", kind: "punt", reach: "heron_reach", at: .78, side: -.25 },
  ];
  let value = (seed ^ 0x51ed2701) >>> 0;
  const next = () => (value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000;
  const kinds: StopKind[] = ["fisher", "shed", "punt"];
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j]!, kinds[i]!];
  }
  const count = next() < .5 ? 2 : 3;
  const branches: ReachId[] = ["ember_cut", "mill_race", "marsh_bend"];
  const first = branches[Math.floor(next() * branches.length)]!;
  const route: ReachId[] = ["heron_reach", first, branches[(branches.indexOf(first) + 1) % branches.length]!];
  return kinds.slice(0, count).map((kind, i) => ({ id: "stop-" + i, kind, reach: route[i]!,
    at: .3 + next() * .45, side: next() < .5 ? -1 : 1 }));
}

export function pirateRoleCaps(danger: number, seconds: number): Record<PirateRole, number> {
  const roles = { skiff: 0, raider: 0, gunboat: 0 };
  for (let i = 0; i < pirateCap(danger, seconds); i++) roles[pirateRoleAt(danger, i)]++;
  return roles;
}
