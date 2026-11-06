/**
 * Turns a batch of net agent activity into ops that keep the chain of custody.
 *
 * The game nets a stretch of market activity into per-account deltas. Netting loses where goods came from: a
 * village that harvests 10 oil and sells 3 to a player would show as 7 oil minted to the village and 3 minted
 * to the player. Goods are only ever harvested at their source village, so any new supply of a good is minted
 * there first (tagged `source: "sys:harvest"`) and then moved on with transfers. Lanterns are crafted, not
 * harvested, and coins come from the game's funds; both keep plain net mints.
 */
import { items, type ItemId } from "@lantern/content";
import { sourceFor } from "@lantern/content/river";
import type { LedgerOp } from "@lantern/protocol";

type Delta = Map<string, Map<string, number>>;

export function deltas(effects: readonly LedgerOp[]): Delta {
  const delta: Delta = new Map();
  const add = (account: string, asset: string, amount: number) => {
    const assets = delta.get(asset) ?? new Map<string, number>();
    assets.set(account, (assets.get(account) ?? 0) + amount);
    delta.set(asset, assets);
  };
  for (const effect of effects) {
    const amount = Number(effect.amount);
    if (effect.op !== "mint") add(effect.from, effect.asset, -amount);
    if (effect.op !== "burn") add(effect.to, effect.asset, amount);
  }
  return delta;
}

const harvested = (asset: string) => Object.hasOwn(items, asset) ? sourceFor(asset as ItemId) : undefined;

/** Ops in a fixed order (all mints, then transfers, then burns) so any prefix of them can be applied on its own. */
export function custodyOps(effects: readonly LedgerOp[], memo = "Net market settlement"): LedgerOp[] {
  const mints: LedgerOp[] = [], transfers: LedgerOp[] = [], burns: LedgerOp[] = [];
  for (const [asset, accounts] of [...deltas(effects)].sort(([a], [b]) => a < b ? -1 : 1)) {
    const entries = [...accounts].filter(([, amount]) => amount).sort(([a], [b]) => a < b ? -1 : 1);
    const supply = entries.reduce((sum, [, amount]) => sum + amount, 0);
    const village = harvested(asset);
    const balance = new Map(entries);
    if (village && supply > 0) {
      const source = "v:" + village;
      mints.push({ op: "mint", asset, amount: String(supply), to: source, memo: "Harvest", source: "sys:harvest" });
      balance.set(source, (balance.get(source) ?? 0) - supply);
    }
    const sources = [...balance].filter(([, amount]) => amount < 0).map(([account, amount]) => ({ account, amount: -amount }));
    const destinations = [...balance].filter(([, amount]) => amount > 0).map(([account, amount]) => ({ account, amount }));
    for (const destination of destinations) {
      for (const source of sources) {
        const quantity = Math.min(destination.amount, source.amount);
        if (!quantity) continue;
        transfers.push({ op: "transfer", asset, amount: String(quantity), from: source.account, to: destination.account, memo });
        source.amount -= quantity;
        destination.amount -= quantity;
      }
      if (destination.amount) mints.push({ op: "mint", asset, amount: String(destination.amount), to: destination.account, memo });
    }
    for (const source of sources) {
      if (source.amount) burns.push({ op: "burn", asset, amount: String(source.amount), from: source.account, memo });
    }
  }
  return [...mints, ...transfers, ...burns];
}

export function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}
