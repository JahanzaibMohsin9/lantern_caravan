import { z } from "zod";
import { amount, bargeTrimSchema, manifestSchema } from "@lantern/protocol";
import { bargeUpgrades, reachIds, villageIds } from "@lantern/content/river";
import { items } from "@lantern/content";
import { freshRiver, harvest } from "./river";
import type { World } from "./model";

const num = amount.transform(Number);
const signed = z.string().regex(/^-?(0|[1-9]\d*)$/).transform(Number).refine(Number.isSafeInteger);
const numbers = z.record(z.string(), num);
const textArrays = z.record(z.string(), z.array(z.string()));
const time = z.number().nonnegative().max(300);
const stall = z.enum(["paper_mill", "oil_wharf", "reed_thread", "indigo_atelier", "lantern_house"]);
const village = z.enum(villageIds);
const item = z.enum(Object.keys(items) as (keyof typeof items)[]);
const reach = z.enum(reachIds);
const natural = z.int().nonnegative();
const label = z.string().min(1).max(120);
const riverSchema = z.object({
  reaches: z.record(reach, z.object({ danger: natural.max(5), boom: z.boolean(), lamps: natural.max(5), kills: natural.max(2) })),
  bountyFund: natural, sailings: natural.max(2), serial: natural, random: natural.max(0xffffffff),
  supplied: z.partialRecord(stall, z.record(label, natural)),
  runs: z.record(label, z.object({ actor: label, started: natural, startedAt: time.optional(), manifest: manifestSchema })),
  contracts: z.record(label, z.object({ id: label, village, item, qty: natural.positive(), payout: natural.positive(),
    deadline: time, kind: z.enum(["supply", "escort"]), payer: label, stall, actor: label.optional(), haul: label.optional(), relief: z.boolean().optional() })),
  hauls: z.record(label, z.object({ id: label, actor: label, village, destination: village.optional(), departs: time, arrives: time,
    cargo: z.array(z.object({ item, qty: natural.positive(), paid: natural, stall: stall.optional(), unitPrices: z.array(natural.positive()).optional() })), contract: label.optional(),
    guaranteed: z.boolean().optional() })),
  wrecks: z.record(label, z.object({ id: label, reach, at: z.number().min(0).max(1), sank: z.int().positive(), by: label,
    claimedBy: label.optional() })).default({}),
});
const strategy = z.enum(["steady", "bold", "festival", "bargain"]);
const vote = z.partialRecord(stall, strategy);
const receipt = z.object({ id: z.string(), label: z.string(), url: z.string().optional() });
const trader = z.object({
  trim: bargeTrimSchema.optional(),
  name: z.string(), upgrades: z.array(z.enum(["cart_i", "cart_ii", "lantern_strings", ...(Object.keys(bargeUpgrades) as (keyof typeof bargeUpgrades)[])])),
  delivered: numbers, crafted: num, crowdSold: num, earned: num, spent: num, jobsDone: num,
  relationship: z.partialRecord(z.union([stall, village]), signed), fair: z.partialRecord(stall, num),
  refused: z.array(stall), cooldowns: z.partialRecord(stall, num),
  job: z.object({ id: z.string(), readyAt: z.number().nonnegative() }).optional(),
  lifetimeCrafted: num, lifetimeDividends: num, boatsHelped: num, rescued: num,
  rescuedTonight: z.array(stall), votes: vote, lastStop: z.string().optional(),
  dividends: z.partialRecord(stall, num),
});
const merchant = z.object({ strategy, profit: signed, unitsSold: num, drift: num, thinking: z.string(),
  lastSharePrice: num, dividendHistory: z.array(num).max(5), rescued: z.boolean(), offerCount: num, stockClosed: z.boolean().optional() });
const offer = z.object({ id: z.string(), stall, kind: z.enum(["rescue", "expansion"]),
  total: num, price: num, ends: time, contributions: numbers });
const listing = z.object({ id: z.string(), actor: z.string(), stall, shares: num, price: num });
const worldSchema = z.object({
  phase: z.enum(["preparation", "open", "results"]), mode: z.enum(["campaign", "endless", "live"]),
  night: z.int().positive(), seed: z.int().nonnegative(), revision: z.int().nonnegative(),
  ledger: z.record(z.string(), numbers), elapsed: time, tickAt: time,
  traders: z.record(z.string(), trader), market: z.record(stall, merchant), offers: z.record(z.string(), offer),
  listings: z.record(z.string(), listing), orderWishes: textArrays, orderContributors: textArrays, wishAuthors: textArrays.default({}),
  river: riverSchema.optional(),
  activity: z.array(z.object({ at: time, night: z.int().positive(), line: z.string(), actor: z.string().optional(), receipt: receipt.optional() })),
});

const numericMetadata = new Set(["night", "seed", "revision", "elapsed", "tickAt", "readyAt", "at", "ends"]);
export function encodeWorld(world: World): unknown {
  const { river, ...row } = world;
  return { ...JSON.parse(JSON.stringify(row, (key, value) =>
    typeof value === "number" && !numericMetadata.has(key) ? String(value) : value)), river };
}

export function decodeWorld(payload: unknown): World {
  const { river, ...world } = worldSchema.parse(payload);
  return river ? { ...world, river } : harvest({ ...world, river: freshRiver(world.seed) });
}
