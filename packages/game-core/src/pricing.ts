export function ask(base: number, stock: number, target: number, strategy = 10000) {
  // Compare whole numbers so exact threshold boundaries stay predictable.
  const percent = stock * 100;
  const [multiplier, label] = percent < target * 25 ? [20000, "Scarce"]
    : percent < target * 75 ? [12000, "Low stock"]
    : percent <= target * 125 ? [10000, "Normal"] : [6000, "Flooded"];
  const price = Math.min(3 * base, Math.max(2, Math.ceil(base * multiplier * strategy / 10000 ** 2)));
  return { price, label };
}

export function tradePrice(side: "buy" | "sell", base: number, stock: number, target: number, strategy: number, quantity: number) {
  let total = 0;
  for (let unit = 0; unit < quantity; unit++) {
    // Sellers are priced against stock after their unit is added.
    const nextStock = side === "buy" ? stock - unit : stock + unit + 1;
    const price = ask(base, nextStock, target, strategy).price;
    total += side === "buy" ? price : Math.max(1, Math.floor(price * 70 / 100));
  }
  return total;
}
