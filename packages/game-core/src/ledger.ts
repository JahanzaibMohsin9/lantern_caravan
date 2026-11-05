import type { LedgerOp } from "@lantern/protocol";

export type Ledger = Record<string, Record<string, number>>;
export const balance = (ledger: Ledger, account: string, asset: string) =>
  Object.hasOwn(ledger, account) && Object.hasOwn(ledger[account]!, asset) ? ledger[account]![asset]! : 0;

export function apply(ledger: Ledger, effects: readonly LedgerOp[]): Ledger {
  const next = { ...ledger };
  function change(account: string, asset: string, delta: number) {
    const total = balance(next, account, asset) + delta;
    if (!Number.isSafeInteger(total) || total < 0) throw new Error("That balance is no longer available.");
    const wallet = { ...next[account] };
    if (total) wallet[asset] = total;
    else delete wallet[asset];
    if (Object.keys(wallet).length) next[account] = wallet;
    else delete next[account];
  }
  for (const effect of effects) {
    const amount = Number(effect.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Invalid ledger amount.");
    if (effect.op !== "mint") change(effect.from, effect.asset, -amount);
    if (effect.op !== "burn") change(effect.to, effect.asset, amount);
  }
  return next;
}
