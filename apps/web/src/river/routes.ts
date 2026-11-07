import { villages, type VillageId } from "@lantern/content/river";
import type { Snapshot } from "@lantern/protocol";
import { routeLeads } from "./Landing";

/** One run the Dock can offer: what to buy where, who pays for it, about how much it makes and how dangerous the way is. */
export type RunOption = {
  village: string; port: string; item: string; stall: string;
  buy: number; sell: number; units: number; profit: number;
  /** The worst danger (0 to 5) on the reaches between the Landing and the village. */
  danger: number; boom: boolean; tag?: "safer" | "bigger";
  /** The Dock's pick after weighing margin against distance and danger; selected by default. */
  recommended: boolean;
};

/**
 * The Dock's run choices: the best run to each village, sized to the barge's hold, the captain's coins, the village's stock
 * and the buyer's shortage. Beside the recommended run it offers one alternative with a different risk and reward.
 */
export function runOptions(snapshot: Snapshot): RunOption[] {
  const reach = new Map(snapshot.river.reaches.map(entry => [entry.id, entry]));
  const coins = Number(snapshot.coins);
  const best = new Map<string, RunOption & { score: number }>();
  for (const lead of routeLeads(snapshot)) {
    const village = snapshot.villages[lead.village];
    const market = snapshot.merchants[lead.stall];
    if (!village || !market) continue;
    const short = Number(market.prices[lead.item]?.target ?? 0) - Number(market.stock[lead.item] ?? 0);
    const units = Math.max(0, Math.min(Number(snapshot.barge.hold), lead.buy > 0 ? Math.floor(coins / lead.buy) : 0,
      Number(village.stock[lead.item] ?? 0), short));
    const profit = units * (lead.sell - lead.buy);
    // A run worth a coin or two isn't worth recommending.
    if (units <= 0 || profit < 3) continue;
    const route = ["heron_reach", villages[lead.village as VillageId].reach].map(id => reach.get(id)).filter(entry => !!entry);
    const option = { recommended: false, village: lead.village, port: lead.port, item: lead.item, stall: lead.stall, buy: lead.buy, sell: lead.sell,
      units, profit, danger: Math.max(0, ...route.map(entry => entry.danger)), boom: route.some(entry => entry.boom), score: lead.score };
    const prior = best.get(lead.village);
    if (!prior || option.score > prior.score) best.set(lead.village, option);
  }
  const ranked = [...best.values()].sort((a, b) => b.score - a.score);
  if (!ranked.length) return [];
  const strip = ({ score: _score, ...option }: RunOption & { score: number }) => option;
  const risk = (option: RunOption) => option.danger + (option.boom ? 2 : 0);
  const pick = ranked[0]!;
  // Offer one real alternative: more coins for more danger, or failing that, a safer run for fewer coins.
  const bigger = ranked.filter(option => option.profit > pick.profit && risk(option) > risk(pick)).sort((a, b) => b.profit - a.profit)[0];
  const safer = bigger ? undefined : ranked.filter(option => risk(option) < risk(pick)).sort((a, b) => risk(a) - risk(b) || b.profit - a.profit)[0];
  if (bigger) return [{ ...strip(pick), recommended: true, tag: "safer" }, { ...strip(bigger), recommended: false, tag: "bigger" }];
  if (safer) return [{ ...strip(safer), recommended: false, tag: "safer" }, { ...strip(pick), recommended: true, tag: "bigger" }];
  return [{ ...strip(pick), recommended: true }];
}

/** What one delivery did to a stall: its stock of the good before and after, what it paid before and pays now, and whether it relit. */
export type ShortageEffect = { stall: string; item: string; fromStock: number; toStock: number; target: number;
  fromPay: number; toPay: number; relit: boolean };

/** The stalls whose stock of a good rose between two views of the market: the shortages a sale or delivery eased. */
export function deliveryEffects(before: Snapshot, after: Snapshot): ShortageEffect[] {
  return Object.entries(after.merchants).flatMap(([stall, market]) => {
    const prior = before.merchants[stall];
    if (!prior) return [];
    const relit = prior.band === "dark" && market.band !== "dark";
    return Object.keys(market.stock).filter(item => Number(market.stock[item]) > Number(prior.stock[item] ?? 0) && market.prices[item])
      .map(item => ({ stall, item, fromStock: Number(prior.stock[item] ?? 0), toStock: Number(market.stock[item]),
        target: Number(market.prices[item]!.target), fromPay: Number(prior.prices[item]?.sell ?? market.prices[item]!.sell),
        toPay: Number(market.prices[item]!.sell), relit }));
  });
}

/** Folds new effects into a run's list: the first sale sets where a stall started, the latest sets where it ended. */
export function mergeEffects(list: ShortageEffect[] = [], fresh: ShortageEffect[]): ShortageEffect[] {
  const merged = [...list];
  for (const effect of fresh) {
    const at = merged.findIndex(entry => entry.stall === effect.stall && entry.item === effect.item);
    if (at < 0) merged.push(effect);
    else merged[at] = { ...merged[at]!, toStock: effect.toStock, toPay: effect.toPay, target: effect.target,
      relit: merged[at]!.relit || effect.relit };
  }
  return merged;
}
