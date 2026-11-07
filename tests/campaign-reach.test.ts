import { expect, test } from "vitest";
import { items } from "@lantern/content";
import { stopPlan } from "@lantern/content/river";
import { closeNight, commit, createWorld, newNight, openNight, quote, snapshotFor } from "@lantern/game-core";
import { decodeWorld, encodeWorld } from "@lantern/game-core/codec";
import { get, player, supply } from "../packages/game-core/src/model";
import { reachVoyage } from "./campaign-river";

test("a pre-W6 festival save migrates from Night 3 to 4 without changing its ledger", () => {
  let festival = createWorld();
  for (let i = 0; i < 3; i++) festival = newNight(closeNight(openNight(festival)));
  const old = encodeWorld(festival) as { night: number; traders: Record<string, Record<string, unknown>> };
  old.night = 3;
  for (const trader of Object.values(old.traders)) {
    delete trader.boomsTonight; delete trader.contractsTonight; delete trader.wharfBonus;
  }
  const restored = decodeWorld(old);
  expect(restored.night).toBe(4);
  expect(restored.ledger).toEqual(festival.ledger);
  expect(snapshotFor(restored, "test").nightName).toBe("Festival of Lights");
});

test("the reach night funds real cargo and rewards, replays both stops and persists only the actor's nightly credit", () => {
  let world = newNight(closeNight(openNight(newNight(closeNight(openNight(createWorld()))))));
  const before = Object.fromEntries(Object.keys(items).map(item => [item, supply(world, item)]));
  const coins = supply(world, "coin");
  const contract = Object.values(world.river.contracts).find(c => c.kind === "supply" && c.item === "dye")!;
  expect(get(world, "esc:contract:" + contract.id, "coin")).toBe(contract.payout);
  expect(world.river.reaches.marsh_bend).toMatchObject({ danger: 3, boom: true });
  expect(Object.values(world.river.contracts).some(c => c.kind === "escort" && c.payer === "r:juno")).toBe(true);
  world = commit(world, quote(world, { type: "start_run", contract_id: contract.id, barge_plan: [] }, "reach", 0), 0);
  const manifest = snapshotFor(world, "test").river.myRun!.manifest;
  expect(stopPlan(manifest.seed, manifest.stopLayout)).toMatchObject([{ reach: "heron_reach" }, { reach: "heron_reach" }]);
  const { report, replay } = reachVoyage(manifest);
  expect(replay).toEqual(report);
  expect(report.boomsBroken).toEqual(["marsh_bend"]);
  expect(report.stops).toHaveLength(2);
  const deal = quote(world, { type: "finish_run", run_id: manifest.id, report }, "home", report.durationMs);
  expect(deal.effects.every(op => op.op === "transfer")).toBe(true);
  world = commit(world, deal, report.durationMs);
  expect(Object.fromEntries(Object.keys(items).map(item => [item, supply(world, item)]))).toEqual(before);
  expect(supply(world, "coin")).toBe(coins);
  expect(world.traders[player]).toMatchObject({ boomsTonight: 1, contractsTonight: 1 });
  expect(world.traders["r:juno"]).toMatchObject({ boomsTonight: 0, contractsTonight: 0 });
  world = decodeWorld(encodeWorld(world));
  // River-first: breaking the boom and filling a contract clears the reach.
  expect(snapshotFor(world, "test").objective.steps.map(s => s.count)).toEqual(["1", "1"]);
  expect(snapshotFor(world, "test").objective.complete).toBe(true);
  expect(() => quote(world, { type: "finish_run", run_id: manifest.id, report }, "twice", report.durationMs)).toThrow("RIVER_RUN_UNKNOWN");
  const next = newNight(closeNight(openNight(world)));
  expect(next.traders[player]).toMatchObject({ boomsTonight: 0, contractsTonight: 0 });
  const legacy = encodeWorld(world) as { traders: Record<string, Record<string, unknown>> };
  delete legacy.traders[player]!.boomsTonight; delete legacy.traders[player]!.contractsTonight;
  expect(decodeWorld(legacy).traders[player]).toMatchObject({ boomsTonight: 0, contractsTonight: 0 });
});

test("an unsuccessful contract cannot earn Night 3 credit", () => {
  let world = newNight(closeNight(openNight(newNight(closeNight(openNight(createWorld()))))));
  const contract = Object.values(world.river.contracts).find(c => c.kind === "supply")!;
  world = commit(world, quote(world, { type: "start_run", contract_id: contract.id, barge_plan: [] }, "empty", 0), 0);
  const manifest = snapshotFor(world, "test").river.myRun!.manifest;
  const report = { run_id: manifest.id, seed: manifest.seed, durationMs: 0, bought: [], soldBack: [], delivered: {}, lost: {},
    flaresUsed: 0, pirates: [], boomsBroken: [], outcome: "moored" as const, inputLogHash: "empty" };
  world = commit(world, quote(world, { type: "finish_run", run_id: manifest.id, report }, "home", 0), 0);
  expect(world.traders[player]).toMatchObject({ boomsTonight: 0, contractsTonight: 0 });
  expect(get(world, "esc:contract:" + contract.id, "coin")).toBe(0);
  expect(world.traders[player]!.villageContracts).toEqual({});
});
