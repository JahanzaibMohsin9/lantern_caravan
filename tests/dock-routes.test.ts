import { expect, test } from "vitest";
import { createWorld, snapshotFor } from "@lantern/game-core";
import { runOptions } from "../apps/web/src/river/routes";

const risk = (option: { danger: number; boom: boolean }) => option.danger + (option.boom ? 2 : 0);

test("Night 1 offers one clear run, sized to the captain's coins, with its profit and danger", () => {
  const options = runOptions(snapshotFor(createWorld("campaign"), "test"));
  expect(options).toHaveLength(1);
  expect(options[0]).toMatchObject({ village: "ember_falls", item: "oil", stall: "oil_wharf", recommended: true });
  const [run] = options;
  expect(run!.units).toBe(Math.min(12, Math.floor(30 / run!.buy)));
  expect(run!.profit).toBe(run!.units * (run!.sell - run!.buy));
  expect(run!.danger).toBeGreaterThanOrEqual(0);
});

test("when the richest run is riskier, the Dock offers it beside a safer one and recommends one of them", () => {
  const snapshot = snapshotFor(createWorld("endless"), "test");
  // Both buyers are short, and the oil route is dangerous while the paper route is calm.
  // A short stall pays a hauler its full ask, so the snapshot's sell prices rise with the shortage.
  snapshot.merchants.paper_mill!.stock.paper = "0";
  snapshot.merchants.paper_mill!.prices.paper!.sell = "4";
  snapshot.merchants.oil_wharf!.stock.oil = "0";
  snapshot.merchants.oil_wharf!.prices.oil!.sell = "7";
  snapshot.coins = "60";
  for (const reach of snapshot.river.reaches) reach.danger = reach.id === "ember_cut" ? 5 : 0;
  const options = runOptions(snapshot);
  expect(options).toHaveLength(2);
  const safer = options.find(option => option.tag === "safer")!;
  const bigger = options.find(option => option.tag === "bigger")!;
  expect(risk(safer)).toBeLessThan(risk(bigger));
  expect(bigger.profit).toBeGreaterThan(safer.profit);
  expect(bigger.village).toBe("ember_falls");
  expect(options.filter(option => option.recommended)).toHaveLength(1);
});

test("nothing is offered when no buyer is short or the captain can't afford any cargo", () => {
  const snapshot = snapshotFor(createWorld("campaign"), "test");
  snapshot.coins = "0";
  expect(runOptions(snapshot)).toEqual([]);
});

test("a delivery's effect is read from the market before and after, and a run keeps the first and latest values", async () => {
  const { deliveryEffects, mergeEffects } = await import("../apps/web/src/river/routes");
  const before = snapshotFor(createWorld("campaign"), "test");
  const mid = structuredClone(before), after = structuredClone(before);
  before.merchants.oil_wharf!.stock.oil = "2"; before.merchants.oil_wharf!.prices.oil!.sell = "6";
  before.merchants.oil_wharf!.band = "dark";
  mid.merchants.oil_wharf!.stock.oil = "6"; mid.merchants.oil_wharf!.prices.oil!.sell = "5";
  after.merchants.oil_wharf!.stock.oil = "9"; after.merchants.oil_wharf!.prices.oil!.sell = "4";
  const first = deliveryEffects(before, mid);
  expect(first).toEqual([{ stall: "oil_wharf", item: "oil", fromStock: 2, toStock: 6, target: Number(mid.merchants.oil_wharf!.prices.oil!.target),
    fromPay: 6, toPay: 5, relit: true }]);
  const run = mergeEffects(mergeEffects([], first), deliveryEffects(mid, after));
  expect(run).toHaveLength(1);
  expect(run[0]).toMatchObject({ fromStock: 2, toStock: 9, fromPay: 6, toPay: 4, relit: true });
  // Stock that fell (a merchant selling) is not a delivery.
  expect(deliveryEffects(after, before)).toEqual([]);
});
