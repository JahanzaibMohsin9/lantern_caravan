import { mkdir, writeFile } from "node:fs/promises";
import type { Intent, LedgerOp } from "@lantern/protocol";
import { runFixture, type Fixture } from "../tests/golden-runner";

const dir = "tests/golden";
await mkdir(dir, { recursive: true });
const cases = new Map<string, Fixture>();
const oil = (type: "buy" | "sell", quantity = "1") => ({ type, stall_id: "oil_wharf", item_id: "oil", quantity } as const);
const craft = (quantity = "1") => ({ type: "craft", recipe_id: "paper_lantern", quantity } as const);
const order = (order_id: string, quantity = "1", wish_id?: string) => ({ type: "fill_order", order_id, quantity, wish_id } as const);
const add = (name: string, intents: Intent[], setup?: LedgerOp[], scenario: Fixture["scenario"] = "first") =>
  cases.set(name, { seed: 42, scenario, setup, steps: intents.map(intent => ({ at: 0, intent })) });
for (const stock of [1, 2, 3, 8, 9, 15, 16, 22]) {
  const amount = String(Math.abs(stock - 12));
  const setup: LedgerOp = stock < 12 ? { op: "burn", from: "m:oil_wharf", asset: "oil", amount, memo: "Fixture stock" }
    : { op: "mint", to: "m:oil_wharf", asset: "oil", amount, memo: "Fixture stock" };
  add("oil-buy-stock-" + stock, [oil("buy")], [setup]);
  add("oil-sell-stock-" + stock, [oil("sell")], [setup]);
}
add("bulk-purchase", [oil("buy", "2")]);
add("out-of-stock", [oil("buy")], [{ op: "burn", from: "m:oil_wharf", asset: "oil", amount: "12", memo: "Fixture stock" }]);
add("insufficient-funds", [oil("buy")], [{ op: "burn", from: "p:guest", asset: "coin", amount: "30", memo: "Fixture money" }]);
add("cargo-full", [oil("buy", "3")]);
add("wrong-phase", [oil("buy")], undefined, "prepared");
add("night-closed", [oil("buy")], undefined, "closed");
add("recipe-locked", [{ type: "craft", recipe_id: "colored_lantern", quantity: "1" }]);
add("missing-ingredients", [craft("3")]);
add("wish-delivery", [craft(), order("heron", "1", "May the river be kind")]);
add("order-filled", [craft("2"), order("heron"), order("heron")]);
add("order-upcoming", [craft(), order("swallow")]);
add("invalid-wish", [craft(), order("heron", "1", "Custom text")]);
add("closed-stall", [oil("buy")], undefined, "dark");
add("rescue-success", [{ type: "buy_offering", offering_id: "2-oil_wharf-1", shares: "2" }, oil("buy")], undefined, "dark");
add("rescue-share-limit", [{ type: "buy_offering", offering_id: "2-oil_wharf-1", shares: "3" }], undefined, "dark");
add("rescue-expired", [{ type: "buy_offering", offering_id: "2-oil_wharf-404", shares: "2" }], undefined, "dark");
add("vote-no-shares", [{ type: "vote_strategy", stall_id: "oil_wharf", strategy_id: "festival" }], undefined, "prepared");
cases.set("quote-expired", { seed: 42, scenario: "first", steps: [{ at: 0, intent: craft(), commitAt: 15000 }] });
const offer = { side: "buy", stall_id: "oil_wharf", item_id: "oil", quantity: "1", price_per_unit: "5" } as const;
cases.set("haggle-accept", { seed: 42, scenario: "first", steps: [{ at: 0, offer, accept: true }] });
cases.set("haggle-cooldown", { seed: 42, scenario: "first", steps: [{ at: 0, offer: { ...offer, price_per_unit: "1" } }, { at: 5000, offer }] });

for (const [name, fixture] of cases) {
  await writeFile(dir + "/" + name + ".json", JSON.stringify({ fixture, expected: runFixture(fixture) }, null, 2) + "\n");
}
console.log(`Recorded ${cases.size} deterministic golden cases.`);
