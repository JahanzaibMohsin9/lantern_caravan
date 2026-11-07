export function ask(base: number, stock: number, target: number, strategy = 10000) {
  // Compare whole numbers so exact threshold boundaries stay predictable.
  const percent = stock * 100;
  const [multiplier, label] = percent < target * 25 ? [20000, "Scarce"]
    : percent < target * 75 ? [12000, "Low stock"]
    : percent <= target * 125 ? [10000, "Normal"] : [6000, "Flooded"];
  const price = Math.min(3 * base, Math.max(2, Math.ceil(base * multiplier * strategy / 10000 ** 2)));
  return { price, label };
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
