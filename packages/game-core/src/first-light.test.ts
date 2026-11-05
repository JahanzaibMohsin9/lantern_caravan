import { describe, expect, test } from "vitest";
import type { Intent } from "@lantern/protocol";
import { advanceClock, commit, createWorld, quote, snapshotFor, type World } from "./index";
import { apply } from "./ledger";
import { haggle } from "./haggle";
import { ask, tradePrice } from "./pricing";

const begin = (): World => ({ ...createWorld(), phase: "open" });
const execute = (state: World, intent: Intent) => commit(state, quote(state, intent, "quote", 0), 1);
const totals = (state: World, asset: string) => Object.values(state.ledger).reduce((total, account) => total + (account[asset] ?? 0), 0);

describe("scarcity pricing", () => {
  test.each([[2, 8], [3, 5], [8, 5], [9, 4], [15, 4], [16, 3]])("prices oil with %i stock", (stock, price) => {
    expect(ask(4, stock, 12).price).toBe(price);
  });

  test("quotes batches unit by unit through a stock threshold", () => {
    expect(tradePrice("buy", 4, 4, 12, 10000, 3)).toBe(5 + 5 + 8);
    expect(tradePrice("sell", 4, 2, 12, 10000, 3)).toBe(3 + 3 + 3);
  });

  test("a round trip loses even with maximum haggle tolerance on each side", () => {
    for (const base of [2, 3, 4]) for (const target of [4, 12]) for (const strategy of [9500, 10000, 10500]) {
      for (let stock = 1; stock <= 24; stock++) {
        for (let quantity = 1; quantity <= Math.min(6, stock); quantity++) {
          const cost = tradePrice("buy", base, stock, target, strategy, quantity);
          const proceeds = tradePrice("sell", base, stock - quantity, target, strategy, quantity);
          expect(cost - Math.floor(cost / 10)).toBeGreaterThan(proceeds + Math.floor(proceeds / 10));
        }
      }
    }
  });
});

describe("first light", () => {
  test("the starting grant funds a full night using confirmed deliveries", () => {
    let state = begin();
    const startingCoins = totals(state, "coin");
    const act = (intent: Intent) => {
      const deal = quote(state, intent, "quote", 0);
      const before = new Map(deal.effects.map(effect => [effect.asset, totals(state, effect.asset)]));
      state = commit(state, deal, 1);
      for (const balances of Object.values(state.ledger)) {
        for (const amount of Object.values(balances)) {
          expect(Number.isSafeInteger(amount)).toBe(true);
          expect(amount).toBeGreaterThanOrEqual(0);
        }
      }
      for (const [asset, amount] of before) {
        const delta = deal.effects.filter(effect => effect.asset === asset).reduce((sum, effect) =>
          sum + (effect.op === "mint" ? Number(effect.amount) : effect.op === "burn" ? -Number(effect.amount) : 0), 0);
        expect(totals(state, asset)).toBe(amount + delta);
      }
    };
    act({ type: "craft", recipe_id: "paper_lantern", quantity: "2" });
    act({ type: "fill_order", order_id: "heron", quantity: "1", wish_id: "May the river be kind" });
    act({ type: "buy", stall_id: "paper_mill", item_id: "paper", quantity: "1" });
    act({ type: "buy", stall_id: "oil_wharf", item_id: "oil", quantity: "1" });
    act({ type: "craft", recipe_id: "paper_lantern", quantity: "1" });
    act({ type: "fill_order", order_id: "kingfisher", quantity: "2" });

    const snapshot = snapshotFor(state, "test");
    expect(snapshot.delivered).toBe("3");
    expect(snapshot.orders.filter(order => order.state === "filled").map(order => order.name)).toEqual(["The Heron", "The Kingfisher"]);
    expect(snapshot.orders[0]!.wishes).toEqual(["May the river be kind"]);
    expect(snapshot.coins).toBe("53");
    expect(totals(state, "coin")).toBe(startingCoins);
  });

  test("enforces cart capacity, ingredient requirements, and unopened orders", () => {
    const state = begin();
    expect(() => quote(state, { type: "buy", stall_id: "paper_mill", item_id: "paper", quantity: "3" }, "id", 0)).toThrow("cart is full");
    expect(() => quote(state, { type: "craft", recipe_id: "paper_lantern", quantity: "3" }, "id", 0)).toThrow("need paper and oil");
    expect(() => quote(state, { type: "fill_order", order_id: "swallow", quantity: "1" }, "id", 0)).toThrow("hasn’t opened");
  });

  test("rejects expired quotes and new actions after closing", () => {
    const state = begin();
    const intent = { type: "craft", recipe_id: "paper_lantern", quantity: "1" } as const;
    const deal = quote(state, intent, "id", 0);
    expect(() => commit(state, deal, 15000)).toThrow("Quote expired");
    expect(() => quote(advanceClock(state, 300), intent, "id", 0)).toThrow("market is closed");
  });

  test("a bad batch leaves the original ledger unchanged", () => {
    const { ledger } = begin();
    expect(() => apply(ledger, [
      { op: "mint", to: "p:guest", asset: "coin", amount: "5", memo: "test" },
      { op: "burn", from: "p:guest", asset: "oil", amount: "3", memo: "test" },
    ])).toThrow();
    expect(ledger["p:guest"]!.coin).toBe(30);
    expect(ledger["p:guest"]!.oil).toBe(2);
  });

  test("crowd sales use their own budget and do not count toward the goal", () => {
    const state = execute(execute(begin(), { type: "craft", recipe_id: "paper_lantern", quantity: "2" }),
      { type: "sell_crowd", item_id: "lantern_paper", quantity: "2" });
    expect(snapshotFor(state, "test")).toMatchObject({ coins: "44", crowdBudget: "106", delivered: "0" });
    expect(totals(state, "lantern_paper")).toBe(0);
  });

  test("haggles at a whole-unit price and enforces the cooldown", () => {
    const state = begin();
    const offer = { stall_id: "oil_wharf", item_id: "oil", side: "buy", quantity: "1" } as const;
    const refused = haggle(state, { ...offer, price_per_unit: "1" }, "no", 0);
    expect(refused.result.outcome).toBe("refuse");
    expect(() => haggle(refused.state, { ...offer, price_per_unit: "5" }, "early", 19999)).toThrow("1s");
    const accepted = haggle(refused.state, { ...offer, price_per_unit: "5" }, "yes", 20000);
    expect(accepted.result.outcome).toBe("accept");
    expect(accepted.result.quote?.effects[1]?.amount).toBe("5");
  });
});
