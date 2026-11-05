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
export function pirateRoleCaps(danger: number, seconds: number): Record<PirateRole, number> {
  const roles = { skiff: 0, raider: 0, gunboat: 0 };
  for (let i = 0; i < pirateCap(danger, seconds); i++) roles[pirateRoleAt(danger, i)]++;
  return roles;
}
