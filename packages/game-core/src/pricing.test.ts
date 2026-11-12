import { describe, expect, it } from "vitest";
import { createWorld, floodMarket, openNight, snapshotFor } from "./index";
import { ask, explainPrice, tradePrice } from "./pricing";

describe("explainPrice", () => {
  it("names the band, the multipliers and the same prices ask and tradePrice charge", () => {
    const line = explainPrice(4, 2, 12, 10000, true);
    expect(line).toContain("Scarce: 2 of 12 in stock, ×2.0");
    expect(line).toContain(`asks ${ask(4, 2, 12).price}`);
    expect(line).toContain(`Pays ${tradePrice("sell", 4, 2, 12, 10000, 1, true)} for your next unit (full price while short`);
  });

  it("explains a flooded stall buying at 70%", () => {
    const line = explainPrice(4, 20, 12, 10000, true);
    expect(line).toContain("Flooded");
    expect(line).toContain(`Pays ${tradePrice("sell", 4, 20, 12, 10000, 1, true)} for your next unit (70% of its ask`);
  });

  it("is attached to every merchant price in the snapshot", () => {
    const view = snapshotFor(openNight(createWorld("live", 42)), "test", "");
    for (const market of Object.values(view.merchants)) {
      for (const price of Object.values(market.prices)) expect(price.why).toMatch(/asks \d+/);
    }
  });
});

describe("floodMarket", () => {
  it("sells through the normal trade path and pushes the price down", () => {
    const world = openNight(createWorld("live", 42));
    const before = Number(snapshotFor(world, "test", "").merchants.oil_wharf!.prices.oil!.buy);
    const { world: after, sold, coins } = floodMarket(world, "oil_wharf", "oil", 12);
    const view = snapshotFor(after, "test", "");
    expect(sold).toBeGreaterThan(0);
    expect(coins).toBeGreaterThan(0);
    expect(Number(view.merchants.oil_wharf!.prices.oil!.buy)).toBeLessThan(before);
    expect(view.activity.at(-1)?.line).toContain("Flood:");
  });
});
