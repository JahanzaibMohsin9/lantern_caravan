import type { LedgerOp } from "@lantern/protocol";
import { balance, type Ledger } from "./ledger";
import { burn, mint, move } from "./model";

export function netEffects(before: Ledger, after: Ledger): LedgerOp[] {
  const accounts = new Set([...Object.keys(before), ...Object.keys(after)]);
  const assets = new Set([...accounts].flatMap(account => [...Object.keys(before[account] ?? {}), ...Object.keys(after[account] ?? {})]));
  const effects: LedgerOp[] = [];
  for (const asset of assets) {
    const deltas = [...accounts].map(account => ({ account, amount: balance(after, account, asset) - balance(before, account, asset) }));
    const sources = deltas.filter(delta => delta.amount < 0);
    const destinations = deltas.filter(delta => delta.amount > 0);
    const memo = "Net market settlement";
    for (const destination of destinations) {
      for (const source of sources) {
        const quantity = Math.min(destination.amount, -source.amount);
        if (!quantity) continue;
        effects.push(move(source.account, destination.account, asset, quantity, memo));
        source.amount += quantity;
        destination.amount -= quantity;
      }
      if (destination.amount) effects.push(mint(destination.account, asset, destination.amount, memo));
    }
    for (const source of sources) if (source.amount) effects.push(burn(source.account, asset, -source.amount, memo));
  }
  return effects;
}
