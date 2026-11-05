import type { StallId } from "@lantern/content";
import { strategies } from "@lantern/content/nights";
import { haggleOfferSchema, type HaggleOffer, type HaggleResult } from "@lantern/protocol";
import { quoteFor, snapshotFor, type World } from "./index";
import { getTrader, player } from "./model";

export function haggle(state: World, raw: HaggleOffer, id: string, now: number, actor = player): { state: World; result: HaggleResult } {
  const { stall_id, item_id, quantity, side, price_per_unit } = haggleOfferSchema.parse(raw);
  const trader = getTrader(state, actor);
  const stall = stall_id as StallId;
  const retry = (trader.cooldowns[stall] ?? -20000) + 20000 - now;
  if (retry > 0) throw new Error(`Try another offer in ${Math.ceil(retry / 1000)}s.`);
  const intent = { type: side, stall_id, item_id, quantity };
  const listed = quoteFor(state, actor, intent, id, now);
  const total = Number(listed.effects[1]!.amount);
  const hint = snapshotFor(state, "", actor).merchants[stall]!.prices[item_id]!;
  const reputation = trader.relationship[stall] ?? 0;
  const bonus = reputation < 0 ? reputation * 60 : reputation * 50;
  const tolerance = side === "buy" && hint.label === "Scarce" ? 0
    : Math.max(0, Math.min(1000, 500 + strategies[state.market[stall].strategy].tolerance + bonus
      + (side === "buy" && hint.label === "Flooded" ? 500 : 0)));
  // The listed unit price is always under 20. Capping comparisons keeps huge offers safe.
  const offered = Math.min(Number(price_per_unit), 1000) * Number(quantity);
  const difference = side === "buy" ? total - offered : offered - total;
  const distance = difference * 10000;
  const limit = tolerance * total;
  const refused = distance > limit * 2;
  const memory = refused && !trader.refused.includes(stall);
  const next = { ...state, revision: state.revision + 1, traders: { ...state.traders, [actor]: {
    ...trader, cooldowns: { ...trader.cooldowns, [stall]: now },
    refused: memory ? [...trader.refused, stall] : trader.refused,
    relationship: memory ? { ...trader.relationship, [stall]: Math.max(-5, reputation - 1) } : trader.relationship,
  } } };
  if (refused) {
    return { state: next, result: { outcome: "refuse", line: "I’d go hungry at that price.", retry_after_ms: 20000 } };
  }

  const outcome = distance > limit ? "counter" : "accept";
  const adjustment = Math.min(Math.max(difference, 0), Math.floor(limit / 10000));
  const agreed = side === "buy" ? total - adjustment : total + adjustment;
  return { state: next, result: { outcome, quote: quoteFor(next, actor, intent, id, now, agreed),
    line: outcome === "accept" ? "You have a deal." : "I can meet you here.", retry_after_ms: 20000 } };
}
