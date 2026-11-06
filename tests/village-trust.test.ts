import { expect, test } from "vitest";
import { items } from "@lantern/content";
import { closeNight, commit, createWorld, newNight, openNight, quote, snapshotFor } from "@lantern/game-core";
import { decodeWorld, encodeWorld } from "@lantern/game-core/codec";
import { villagePurchaseCost } from "@lantern/game-core/pricing";
import { get, player, supply } from "../packages/game-core/src/model";
import { createRiver, marketQuote } from "@lantern/river-sim";
import { reachVoyage } from "./campaign-river";

test("two paid supply contracts earn lasting village trust only for their hauler, with conserved discounted purchases", () => {
  let world = newNight(closeNight(openNight(newNight(closeNight(openNight(createWorld()))))));
  const totals = () => Object.fromEntries([...Object.keys(items), "coin"].map(item => [item, supply(world, item)]));
  const before = totals();
  const contracts = Object.values(world.river.contracts).filter(c => c.kind === "supply" && c.village === "reedmarsh");
  expect(contracts).toHaveLength(2);
  for (const [index, contract] of contracts.entries()) {
    world = commit(world, quote(world, { type: "start_run", contract_id: contract.id, barge_plan: [] }, "trust-" + index, 0), 0);
    const manifest = snapshotFor(world, "test").river.myRun!.manifest;
    const { report, replay } = reachVoyage(manifest);
    expect(replay).toEqual(report);
    world = commit(world, quote(world, { type: "finish_run", run_id: manifest.id, report }, "home-" + index, report.durationMs), report.durationMs);
    expect(snapshotFor(world, "test").villages.reedmarsh).toMatchObject({ contractsCompleted: index + 1, trusted: index === 1 });
    expect(totals()).toEqual(before);
  }
  expect(snapshotFor(world, "test", "r:juno").villages.reedmarsh?.trusted).toBe(false);
  expect(world.traders[player]!.relationship.reedmarsh).toBeGreaterThanOrEqual(3);
  const next = decodeWorld(encodeWorld(newNight(closeNight(openNight(world)))));
  expect(snapshotFor(next, "test").villages.reedmarsh?.trusted).toBe(true);
  world = decodeWorld(encodeWorld(world));
  expect(snapshotFor(world, "test").villages.reedmarsh?.trusted).toBe(true);
  world = commit(world, quote(world, { type: "start_run", barge_plan: [] }, "discount", 0), 0);
  const manifest = snapshotFor(world, "test").river.myRun!.manifest;
  const lot = manifest.items.find(lot => lot.item === "reed")!;
  expect(lot.trusted).toBe(true);
  const sim = createRiver(manifest), batch = marketQuote(sim, "reedmarsh", "reed", "buy", 4);
  expect(batch.quantity).toBe(4);
  expect(batch.amount).toBe(Math.ceil(lot.prices.slice(0, 4).reduce((a, b) => a + b, 0) * .9));
  let split = 0;
  for (let n = 0; n < 4; n++) {
    sim.bought.reed = { village_id: "reedmarsh", item_id: "reed", quantity: n, paid: split };
    split += marketQuote(sim, "reedmarsh", "reed", "buy", 1).amount;
  }
  expect(split).toBe(batch.amount);
  const beforeVillage = get(world, "v:reedmarsh", "coin"), beforePlayer = get(world, player, "coin"), beforeTrade = totals();
  const { report, replay } = reachVoyage(manifest, { item: "reed", quantity: 4 });
  expect(replay).toEqual(report);
  expect(report.bought.find(entry => entry.item_id === "reed")?.paid).toBe(batch.amount);
  const deal = quote(world, { type: "finish_run", run_id: manifest.id, report }, "discount-home", report.durationMs);
  expect(deal.effects.every(op => op.op === "transfer")).toBe(true);
  world = commit(world, deal, report.durationMs);
  expect(get(world, "v:reedmarsh", "coin") - beforeVillage).toBe(batch.amount);
  expect(beforePlayer - get(world, player, "coin")).toBe(batch.amount);
  expect(totals()).toEqual(beforeTrade);
});

test("ordinary friendship and unsuccessful contracts do not award trust; old saves keep their small batch discount", () => {
  let world = createWorld("endless");
  world.traders[player]!.relationship.reedmarsh = 10;
  const old = encodeWorld(world) as { traders: Record<string, Record<string, unknown>> };
  delete old.traders[player]!.villageContracts;
  world = decodeWorld(old);
  expect(snapshotFor(world, "test").villages.reedmarsh).toMatchObject({ contractsCompleted: 0, trusted: false });
  world = commit(world, quote(world, { type: "start_run", barge_plan: [] }, "friend", 0), 0);
  const lot = snapshotFor(world, "test").river.myRun!.manifest.items.find(lot => lot.item === "reed")!;
  expect(lot).toMatchObject({ discount: true, trusted: false });
  expect(villagePurchaseCost(lot, 4)).toBe(lot.prices.slice(0, 4).reduce((a, b) => a + b, 0) - 1);
});
