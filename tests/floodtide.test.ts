import { tradePrice } from "@lantern/game-core/pricing";
import { villageStrategy } from "@lantern/content/river";
import { expect, test } from "vitest";
import { items } from "@lantern/content";
import { floodtideOpens } from "@lantern/content/nights";
import { landing, reaches, villages } from "@lantern/content/river";
import { advanceClock, cancelRun, closeNight, commit, createWorld, newNight, openNight, quote, snapshotFor } from "@lantern/game-core";
import { apply } from "../packages/game-core/src/ledger";
import { get, move, player, supply, type World } from "../packages/game-core/src/model";
import { createRiver, distance, replayRiver, stepRiver, type Point } from "@lantern/river-sim";
import { runReport, verifyRunReport } from "@lantern/river-sim/report";
import { riverLogSchema, type RunManifest } from "@lantern/protocol";

import { floodWorld, floodVoyage } from "./flood-river";

const totals = (world: World) => [...Object.keys(items), "coin"].map(item => supply(world, item));

test.each([true, false])("scheduled Floodtide success=%s replays, settles real rewards/buybacks and conserves every asset", succeed => {
  let world = floodWorld();
  const before = totals(world), payer = get(world, "m:indigo_atelier", "coin");
  world = commit(world, quote(world, { type: "start_run", contract_id: "flood-test", barge_plan: [] }, "flood-run", 0), 0);
  const manifest = snapshotFor(world, "test").river.myRun!.manifest;
  expect(manifest.floodtideAtMs).toBe(40000);
  expect(manifest.floodPremium).toBeGreaterThan(0);
  expect(get(world, "esc:flood:flood-run", "coin")).toBe(manifest.floodPremium);
  expect(payer - get(world, "m:indigo_atelier", "coin")).toBe(manifest.floodPremium);
  const { report, replay } = floodVoyage(manifest, succeed);
  expect(replay).toEqual(report);
  expect(verifyRunReport(manifest, report)).toEqual(JSON.parse(JSON.stringify(report)));
  expect(report.floodtide).toMatchObject({ completed: succeed, gates: succeed ? 2 : 0, returned: succeed ? {} : { dye: 3 } });
  const deal = quote(world, { type: "finish_run", run_id: manifest.id, report }, "flood-home", report.durationMs);
  expect(deal.effects.every(op => op.op === "transfer")).toBe(true);
  if (succeed) expect(deal.effects).toContainEqual(move("esc:flood:flood-run", player, "coin", manifest.floodPremium!, "Floodtide premium"));
  else {
    const lot = manifest.items.find(lot => lot.item === "dye")!;
    expect(deal.effects).toContainEqual(move("v:reedmarsh", player, "coin",
      tradePrice("sell", items.dye.price, lot.stock, lot.target, villageStrategy, 3), "Floodtide village buyback"));
    expect(deal.effects).toContainEqual(move(player, "v:reedmarsh", "dye", 3, "Floodtide cargo returned upriver"));
  }
  world = commit(world, deal, report.durationMs);
  expect(totals(world)).toEqual(before);
  expect(get(world, "esc:flood:flood-run", "coin")).toBe(0);
  expect(get(world, "esc:contract:flood-test", "coin")).toBe(0);
});

test("only festival nights schedule Floodtide, departures close at the final order, and cancellation refunds the premium", () => {
  expect([1, 2, 3].map(n => floodtideOpens(n, "campaign", 42))).toEqual([undefined, undefined, undefined]);
  expect(floodtideOpens(4, "campaign", 42)).toBe(70);
  expect(Array.from({ length: 8 }, (_, i) => floodtideOpens(i + 1, "live", 42)).some(at => at === undefined)).toBe(true);
  expect(Array.from({ length: 8 }, (_, i) => floodtideOpens(i + 1, "endless", 42)).some(at => at !== undefined)).toBe(true);
  const world = floodWorld(), before = totals(world);
  const started = commit(world, quote(world, { type: "start_run", contract_id: "flood-test", barge_plan: [] }, "cancel-flood", 0), 0);
  const home = cancelRun(started, player);
  expect(totals(home)).toEqual(before);
  expect(get(home, "esc:flood:cancel-flood", "coin")).toBe(0);
  expect(get(home, "esc:contract:flood-test", "coin")).toBe(0);
  expect(() => quote({ ...world, elapsed: 70 }, { type: "start_run", barge_plan: [] }, "late", 0)).toThrow("RIVER_FLOOD_CLOSED");
});


test("replay input logs reject oversized arrays, out-of-range controls, nonfinite aim and unrecognized actions", () => {
  expect(riverLogSchema.safeParse(Array.from({ length: 9001 }, (_, frame) => ({ frame, input: {} }))).success).toBe(false);
  for (const input of [{ x: 2 }, { aim: { x: Infinity, y: 0 } }, { trade: { village: "reedmarsh", item: "dye", side: "buy", quantity: 21 } }, { floodtide: true }]) {
    expect(riverLogSchema.safeParse([{ frame: 0, input }]).success).toBe(false);
  }
  const long = "a".repeat(120);
  const huge = Array.from({ length: 9000 }, (_, frame) => ({ frame, input: { salvage: long, stop: { id: long, choice: long } } }));
  expect(riverLogSchema.safeParse(huge).success).toBe(false);
});


test("the escrowed premium returns even if the supply contract expired before cancellation", () => {
  let world = floodWorld();
  world = commit(world, quote(world, { type: "start_run", contract_id: "flood-test", barge_plan: [] }, "expiry", 0), 0);
  const before = totals(world), premium = get(world, "esc:flood:expiry", "coin");
  // Expire the ordinary contract first, as advanceRiver does at closing.
  world = advanceClock(world, 300);
  world = cancelRun(world, player);
  expect(premium).toBeGreaterThan(0);
  expect(get(world, "esc:flood:expiry", "coin")).toBe(0);
  expect(Object.keys(world.river.runs)).toHaveLength(0);
  // Market crafting can burn inputs while advancing, so coin conservation is the invariant here.
  expect(supply(world, "coin")).toBe(before.at(-1));
});
