import { items, merchants, type ItemId, type StallId } from "@lantern/content";
import type { Intent } from "@lantern/protocol";

type Leg = { asset: string; amount: string };

const good = (item: string, quantity: string | number) =>
  quantity + " " + (items[item as ItemId]?.name ?? item).toLowerCase();
const stallName = (stall: string) => merchants[stall as StallId]?.name ?? stall;
const coins = (effects: readonly Leg[]) =>
  effects.filter(effect => effect.asset === "coin").reduce((sum, effect) => sum + Number(effect.amount), 0);
const plural = (count: number) => count + (count === 1 ? " coin" : " coins");

/** One plain sentence for a confirmed trade, such as "Sold 2 lamp oil to Paper Mill for 14 coins". */
export function describeTrade(intent: Intent, effects: readonly Leg[]): string | undefined {
  if (intent.type === "sell") return `Sold ${good(intent.item_id, intent.quantity)} to ${stallName(intent.stall_id)} for ${plural(coins(effects))}`;
  if (intent.type === "buy") return `Bought ${good(intent.item_id, intent.quantity)} from ${stallName(intent.stall_id)} for ${plural(coins(effects))}`;
  if (intent.type === "finish_run") return "Haul settled at the Landing";
  if (intent.type === "start_run") return "Cast off upriver";
  if (intent.type === "accept_contract") return "Took a Harbor Bell job";
  return undefined;
}
