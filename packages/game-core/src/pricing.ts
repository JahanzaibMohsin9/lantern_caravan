/**
 * Merchant pricing rules. Every price on the Row comes from this file: the stall's stock against its target picks a
 * band, the band and the stall's strategy scale the good's base price, and the result is clamped to 2..3× base.
 *
 * | Stock vs target | Band      | Multiplier |
 * | --------------- | --------- | ---------- |
 * | under 25%       | Scarce    | ×2.0       |
 * | 25% to 74%      | Low stock | ×1.2       |
 * | 75% to 125%     | Normal    | ×1.0       |
 * | over 125%       | Flooded   | ×0.6       |
 *
 * Merchants buy at 70% of their ask, except a river good they are short of, which they buy at the full ask. A unit
 * you sell is priced as if it were already on the shelf (stock + 1), so selling a flood drives each price lower.
 */
function band(stock: number, target: number) {
  // Compare whole numbers so exact threshold boundaries stay predictable.
  const percent = stock * 100;
  return percent < target * 25 ? { multiplier: 20000, label: "Scarce" }
    : percent < target * 75 ? { multiplier: 12000, label: "Low stock" }
    : percent <= target * 125 ? { multiplier: 10000, label: "Normal" } : { multiplier: 6000, label: "Flooded" };
}

export function ask(base: number, stock: number, target: number, strategy = 10000) {
  const { multiplier, label } = band(stock, target);
  const price = Math.min(3 * base, Math.max(2, Math.ceil(base * multiplier * strategy / 10000 ** 2)));
  return { price, label };
}

const times = (basisPoints: number) => "×" + (basisPoints / 10000).toFixed(basisPoints % 1000 ? 2 : 1);

/** The merchant's reasoning for one good, in words, from the same rules `ask` and `tradePrice` use. */
export function explainPrice(base: number, stock: number, target: number, strategy = 10000, haul = false) {
  const { multiplier, label } = band(stock, target);
  const { price } = ask(base, stock, target, strategy);
  const raw = Math.ceil(base * multiplier * strategy / 10000 ** 2);
  const clamp = raw > 3 * base ? " (capped at 3× base)" : raw < 2 ? " (floor of 2)" : "";
  const pays = tradePrice("sell", base, stock, target, strategy, 1, haul);
  const buys = `Pays ${pays} for your next unit (${haul && stock < target ? "full price while short" : "70% of its ask"}, priced at stock ${stock + 1})`;
  return `${label}: ${stock} of ${target} in stock, ${times(multiplier)}. Strategy ${times(strategy)}. ` +
    `Base ${base} → asks ${price}${clamp}. ${buys}.`;
}

/**
 * `haul` marks a merchant buying a river good it stocks. While the merchant is short of it (below its target
 * stock) it pays a hauler its full asking price; once stocked it pays the usual 70%. That makes bringing a
 * merchant what it lacks the way to profit, and a full stall a poor buyer.
 */
export function tradePrice(side: "buy" | "sell", base: number, stock: number, target: number, strategy: number, quantity: number, haul = false) {
  let total = 0;
  for (let unit = 0; unit < quantity; unit++) {
    // Sellers are priced against stock after their unit is added.
    const nextStock = side === "buy" ? stock - unit : stock + unit + 1;
    const price = ask(base, nextStock, target, strategy).price;
    const short = haul && stock + unit < target;
    total += side === "buy" || short ? price : Math.max(1, Math.floor(price * 70 / 100));
  }
  return total;
}

/** Cumulative manifest cost makes whole-coin discounts independent of purchase splitting. */
export function villagePurchaseCost(lot: { prices: number[]; discount: boolean; trusted?: boolean }, quantity: number) {
  const base = lot.prices.slice(0, quantity).reduce((a, b) => a + b, 0);
  return base - (lot.trusted ? Math.floor(base / 10) : Number(lot.discount && quantity >= 4));
}
