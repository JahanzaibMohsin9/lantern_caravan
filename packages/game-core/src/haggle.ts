import type { HaggleOffer, HaggleResult } from "@lantern/protocol";
import { quote, snapshotFor, type World } from "./index";

export function haggle(state: World, offer: HaggleOffer, id: string, now: number): { state: World; result: HaggleResult } {
  const { stall_id, item_id, quantity, side } = offer;
  const retry = (state.cooldowns[stall_id] ?? -20000) + 20000 - now;
  if (retry > 0) throw new Error(`Try another offer in ${Math.ceil(retry / 1000)}s.`);
  const intent = { type: side, stall_id, item_id, quantity };
  const listed = quote(state, intent, id, now);
  const total = Number(listed.effects[1]!.amount);
  const hint = snapshotFor(state, "").merchants[stall_id]!.prices[item_id]!;
  const tolerance = side === "buy" && hint.label === "Scarce" ? 0
    : Math.min(1000, 500 + (stall_id === "reed_thread" ? 300 : stall_id === "paper_mill" ? -100 : 0)
      + (side === "buy" && hint.label === "Flooded" ? 500 : 0));
  const offered = Number(offer.price_per_unit) * Number(quantity);
  const difference = side === "buy" ? total - offered : offered - total;
  const distance = difference * 10000;
  const limit = tolerance * total;
  const next = { ...state, revision: state.revision + 1, cooldowns: { ...state.cooldowns, [stall_id]: now } };
  if (distance > limit * 2) {
    return { state: next, result: { outcome: "refuse", line: "I’d go hungry at that price.", retry_after_ms: 20000 } };
  }

  const outcome = distance > limit ? "counter" : "accept";
  // A good offer never charges the player more than taking the listed price.
  const adjustment = Math.min(Math.max(difference, 0), Math.floor(limit / 10000));
  const agreed = side === "buy" ? total - adjustment : total + adjustment;
  return { state: next, result: { outcome, quote: quote(next, intent, id, now, agreed),
    line: outcome === "accept" ? "You have a deal." : "I can meet you here.", retry_after_ms: 20000 } };
}
