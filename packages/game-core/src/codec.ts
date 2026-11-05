import { z } from "zod";
import { amount } from "@lantern/protocol";
import type { World } from "./model";

const num = amount.transform(Number);
const signed = z.string().regex(/^-?(0|[1-9]\d*)$/).transform(Number).refine(Number.isSafeInteger);
const numbers = z.record(z.string(), num);
const textArrays = z.record(z.string(), z.array(z.string()));
const time = z.number().nonnegative().max(300);
const stall = z.enum(["paper_mill", "oil_wharf", "reed_thread", "indigo_atelier", "lantern_house"]);
const strategy = z.enum(["steady", "bold", "festival", "bargain"]);
const vote = z.partialRecord(stall, strategy);
const receipt = z.object({ id: z.string(), label: z.string(), url: z.string().optional() });
const trader = z.object({
  name: z.string(), upgrades: z.array(z.enum(["cart_i", "cart_ii", "lantern_strings"])),
  delivered: numbers, crafted: num, crowdSold: num, earned: num, spent: num, jobsDone: num,
  relationship: z.partialRecord(stall, signed), fair: z.partialRecord(stall, num),
  refused: z.array(stall), cooldowns: z.partialRecord(stall, num),
  job: z.object({ id: z.string(), readyAt: z.number().nonnegative() }).optional(),
  lifetimeCrafted: num, lifetimeDividends: num, boatsHelped: num, rescued: num,
  rescuedTonight: z.array(stall), votes: vote, lastStop: z.string().optional(),
  dividends: z.partialRecord(stall, num),
});
const merchant = z.object({ strategy, profit: signed, unitsSold: num, drift: num, thinking: z.string(),
  lastSharePrice: num, dividendHistory: z.array(num).max(5), rescued: z.boolean(), offerCount: num });
const offer = z.object({ id: z.string(), stall, kind: z.enum(["rescue", "expansion"]),
  total: num, price: num, ends: time, contributions: numbers });
const listing = z.object({ id: z.string(), actor: z.string(), stall, shares: num, price: num });
const worldSchema = z.object({
  phase: z.enum(["preparation", "open", "results"]), mode: z.enum(["campaign", "endless", "live"]),
  night: z.int().positive(), seed: z.int().nonnegative(), revision: z.int().nonnegative(),
  ledger: z.record(z.string(), numbers), elapsed: time, tickAt: time,
  traders: z.record(z.string(), trader), market: z.record(stall, merchant), offers: z.record(z.string(), offer),
  listings: z.record(z.string(), listing), orderWishes: textArrays, orderContributors: textArrays, wishAuthors: textArrays.default({}),
  activity: z.array(z.object({ at: time, night: z.int().positive(), line: z.string(), actor: z.string().optional(), receipt: receipt.optional() })),
});

const numericMetadata = new Set(["night", "seed", "revision", "elapsed", "tickAt", "readyAt", "at", "ends"]);
export function encodeWorld(world: World): unknown {
  return JSON.parse(JSON.stringify(world, (key, value) =>
    typeof value === "number" && !numericMetadata.has(key) ? String(value) : value));
}

export function decodeWorld(payload: unknown): World {
  return worldSchema.parse(payload);
}
