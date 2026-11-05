import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import { bargeCosmetics, defaultBargeLook, type BargeCosmeticId } from "@lantern/content/river";
import { closeNight, commit, createWorld, newNight, openNight, quote, snapshotFor } from "@lantern/game-core";
import { decodeWorld, encodeWorld } from "@lantern/game-core/codec";
import { createRiver, replayRiver, stepRiver } from "@lantern/river-sim";
import { runReport } from "../packages/river-sim/src/report";
import { apply } from "../packages/game-core/src/ledger";
import { get, move, player, type World } from "../packages/game-core/src/model";
import type { Intent } from "@lantern/protocol";
import { LocalBackend } from "../apps/web/src/backend/local";

const act = (world: World, intent: Intent, id = "look") => commit(world, quote(world, intent, id, 0), 0);
const totals = (world: World) => Object.values(world.ledger).reduce((totals, wallet) => {
  for (const [asset, n] of Object.entries(wallet)) totals[asset] = (totals[asset] ?? 0) + n;
  return totals;
}, {} as Record<string, number>);

test.each(Object.keys(bargeCosmetics) as BargeCosmeticId[])("%s conserves supply, funds relief, persists and has no physics effects", id => {
  const entry = bargeCosmetics[id];
  let world = createWorld("endless");
  world = { ...world, ledger: apply(world.ledger, [move("sys:crowd", player, "coin", 20, "Fixture savings")]) };
  const before = world;
  world = act(world, { type: entry.price ? "buy_barge_cosmetic" : "fit_barge_cosmetic", cosmetic_id: id });
  expect(totals(world)).toEqual(totals(before));
  expect(get(world, "sys:rescue", "coin") - get(before, "sys:rescue", "coin")).toBe(entry.price);
  expect(get(before, player, "coin") - get(world, player, "coin")).toBe(entry.price);
  if (entry.price) expect(() => act(world, { type: "buy_barge_cosmetic", cosmetic_id: id })).toThrow("BARGE_COSMETIC_OWNED");
  world = act(world, { type: "fit_barge_cosmetic", cosmetic_id: defaultBargeLook[entry.category] });
  world = act(world, { type: "fit_barge_cosmetic", cosmetic_id: id });
  expect(totals(world)).toEqual(totals(before));
  world = decodeWorld(encodeWorld(newNight(closeNight(openNight(world)))));
  expect(snapshotFor(world, "test").barge.look[entry.category]).toBe(id);
  world = act(world, { type: "start_run", barge_plan: [] }, "cast");
  const manifest = snapshotFor(world, "test").river.myRun!.manifest;
  expect(manifest.look?.[entry.category]).toBe(id);
  expect(() => act(world, { type: "fit_barge_cosmetic", cosmetic_id: "wood" })).toThrow("already upriver");
  const styled = createRiver(manifest), base = createRiver({ ...manifest, look: undefined });
  for (let i = 0; i < 200; i++) {
    const input = { y: i < 100 ? -1 : 1, boost: true, fire: true };
    stepRiver(styled, input); stepRiver(base, input);
  }
  stepRiver(styled, { moor: true }); stepRiver(base, { moor: true });
  expect(styled.player).toEqual(base.player);
  expect(runReport(styled)).toEqual(runReport(base));
  expect(runReport(replayRiver(manifest, styled.log, styled.frame))).toEqual(runReport(styled));
});

test("unowned, unknown and unaffordable looks are rejected; old saves keep free defaults", () => {
  const world = createWorld("endless");
  expect(() => act(world, { type: "fit_barge_cosmetic", cosmetic_id: "carp" })).toThrow("BARGE_COSMETIC_OWNERSHIP");
  expect(() => act(world, { type: "buy_barge_cosmetic", cosmetic_id: "carp" })).toThrow("BARGE_COSMETIC_FUNDS");
  for (const cosmetic_id of ["__proto__", "constructor", "missing"]) {
    expect(() => act(world, { type: "buy_barge_cosmetic", cosmetic_id })).toThrow("BARGE_COSMETIC");
  }
  const old = encodeWorld(world) as { traders: Record<string, Record<string, unknown>> };
  delete old.traders[player]!.cosmetics; delete old.traders[player]!.look;
  expect(snapshotFor(decodeWorld(old), "test").barge).toMatchObject({ look: defaultBargeLook, cosmetics: [] });
});

test("LocalBackend purchases once, restores ownership and refits free", async () => {
  const backend = new LocalBackend(), slot = "slot-3";
  await backend.createSession({ slot, mode: "endless" });
  const night = backend.view().night_id;
  const deal = await backend.getQuote(slot, night, { type: "buy_barge_cosmetic", cosmetic_id: "jade" });
  expect(backend.view().barge.look.lantern).toBe("amber");
  await backend.submitAction(slot, night, deal.quote_id, "buy-jade");
  await backend.submitAction(slot, night, deal.quote_id, "buy-jade");
  const restored = new LocalBackend();
  await restored.restore(slot);
  expect(restored.view().coins).toBe("15");
  expect(restored.view().barge).toMatchObject({ look: { lantern: "jade" }, cosmetics: ["jade"] });
  const fit = await restored.getQuote(slot, night, { type: "fit_barge_cosmetic", cosmetic_id: "amber" });
  await restored.submitAction(slot, night, fit.quote_id, "fit-amber");
  expect(restored.view().coins).toBe("15");
});
