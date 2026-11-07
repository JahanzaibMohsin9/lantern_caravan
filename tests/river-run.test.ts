import "fake-indexeddb/auto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { LocalBackend } from "../apps/web/src/backend/local";
import { pack } from "../apps/web/src/backend/saves";
import { addTrader, advanceClock, closeNight, commit, commitFor, createWorld, newNight, openNight, quote, quoteFor, snapshotFor } from "@lantern/game-core";
import type { Intent, RunManifest, RunReport } from "@lantern/protocol";
import { apply } from "../packages/game-core/src/ledger";
import { get, merchantIds, mint, move, player, shop, stockTargets, type World } from "../packages/game-core/src/model";
import { advanceRiver, harvest, refreshContracts, refreshRelief, scheduleFreight, startRivalHaul } from "../packages/game-core/src/river";
import { tradePrice } from "../packages/game-core/src/pricing";
import { items, merchants } from "@lantern/content";
import { decodeWorld, encodeWorld } from "@lantern/game-core/codec";
import { almanacEvents, almanacFor, harvestTarget, stopPlan, villageGoods, type BargeTrimId } from "@lantern/content/river";

test.each<BargeTrimId>(["balanced", "runner", "ironclad", "gunner"])("%s is free, manifest-bound, saved across nights, and conserves goods", trim => {
  const world = createWorld("endless");
  const totals = (state: World) => Object.fromEntries(Object.keys(items).map(item =>
    [item, Object.values(state.ledger).reduce((sum, account) => sum + (account[item] ?? 0), 0)]));
  const started = submit(world, { type: "start_run", barge_plan: [], trim }, "trim-run");
  const run = snapshotFor(started, "test").river.myRun!.manifest;
  expect(run.trim).toBe(trim);
  expect(totals(started)).toEqual(totals(world));
  expect(get(started, player, "coin")).toBe(get(world, player, "coin"));
  const restored = decodeWorld(encodeWorld(started));
  expect(snapshotFor(restored, "test").river.myRun!.manifest.trim).toBe(trim);
  expect(() => submit(started, { type: "start_run", barge_plan: [], trim: "balanced" }, "refit")).toThrow("already upriver");
  const home = submit(restored, { type: "finish_run", run_id: run.id, report: empty(run) }, "trim-home", 40_000);
  expect(totals(home)).toEqual(totals(world));
  const next = newNight(closeNight(openNight(home)));
  expect(snapshotFor(next, "test").barge.trim).toBe(trim);
  const refit = submit(next, { type: "start_run", barge_plan: [], trim: "balanced" }, "refit");
  expect(snapshotFor(refit, "test").river.myRun!.manifest.trim).toBe("balanced");
  expect(totals(refit)).toEqual(totals(next));
});

test("old saves use Balanced; unknown trims and early campaign refits are rejected", () => {
  const old = decodeWorld(encodeWorld(createWorld("endless")));
  expect(snapshotFor(old, "test").barge.trim).toBe("balanced");
  expect(() => submit(prepared(), { type: "start_run", barge_plan: [], trim: "runner" }, "early")).toThrow("RIVER_TRIM_LOCKED");
  for (const trim of ["unknown", "__proto__", "constructor"]) {
    expect(() => submit(old, { type: "start_run", barge_plan: [], trim } as Intent, "bad")).toThrow();
  }
});

test("role bounties transfer from sys:bounty, conserve goods, and reject forged mixes", () => {
  const world = createWorld("endless");
  world.river.reaches.heron_reach.danger = 3;
  const started = submit(world, { type: "start_run", barge_plan: [] }, "roles");
  const run = snapshotFor(started, "test").river.myRun!.manifest;
  const report: RunReport = { ...empty(run), durationMs: 40_000,
    pirates: [{ reach: "heron_reach", count: 3, roles: { skiff: 1, raider: 1, gunboat: 1 } }] };
  const deal = quote(started, { type: "finish_run", run_id: run.id, report }, "bounty", 40_000);
  expect(deal.effects).toContainEqual(move("sys:bounty", player, "coin", 28, "River bounty"));
  expect(deal.effects.every(op => op.op === "transfer")).toBe(true);
  const home = commit(started, deal, 40_000);
  expect(get(home, player, "coin") - get(world, player, "coin")).toBe(28);
  expect(get(world, "sys:bounty", "coin") - get(home, "sys:bounty", "coin")).toBe(28);
  const depleted = { ...started, ledger: apply(started.ledger, [
    move("sys:bounty", "sys:fixture", "coin", get(started, "sys:bounty", "coin") - 5, "Another runner's bounty"),
  ]) };
  const capped = quote(depleted, { type: "finish_run", run_id: run.id, report }, "capped", 40_000);
  expect(capped.effects).toContainEqual(move("sys:bounty", player, "coin", 5, "River bounty"));
  for (const item of Object.keys(items)) {
    const total = (state: World) => Object.values(state.ledger).reduce((sum, account) => sum + (account[item] ?? 0), 0);
    expect(total(home)).toBe(total(world));
  }
  for (const roles of [{ skiff: 0, raider: 0, gunboat: 3 }, { skiff: 1, raider: 1, gunboat: 0 }]) {
    expect(() => quote(started, { type: "finish_run", run_id: run.id,
      report: { ...report, pirates: [{ reach: "heron_reach", count: 3, roles }] } }, "forged", 40_000)).toThrow("RIVER_COMBAT");
  }
});

test("LocalBackend confirms a trim with departure and preserves it after reload", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const backend = new LocalBackend(), slot = "slot-3";
  await backend.createSession({ slot, mode: "endless" });
  const night = backend.view().night_id;
  const deal = await backend.getQuote(slot, night, { type: "start_run", barge_plan: [], trim: "runner" });
  expect(backend.view().barge.trim).toBe("balanced");
  const receipt = await backend.submitAction(slot, night, deal.quote_id, "runner");
  expect(receipt.state).toBe("confirmed");
  expect(await backend.getActionStatus(slot, night, "runner")).toEqual(receipt);
  expect(backend.view().river.myRun!.manifest.trim).toBe("runner");
  const restored = new LocalBackend();
  await restored.restore(slot);
  expect(restored.view().barge.trim).toBe("runner");
  expect(restored.view().river.myRun).toBeUndefined();
});

test("a run reservation and empty return conserve every good", () => {
  const world = prepared();
  const supply = (state: World) => Object.fromEntries(Object.keys(items).map(item =>
    [item, Object.values(state.ledger).reduce((total, account) => total + (account[item] ?? 0), 0)]));
  const before = supply(world);
  const started = submit(world, { type: "start_run", barge_plan: [] }, "conservation");
  expect(supply(started)).toEqual(before);
  const run = snapshotFor(started, "test").river.myRun!.manifest;
  const home = submit(started, { type: "finish_run", run_id: run.id, report: empty(run) }, "home", 40_000);
  expect(supply(home)).toEqual(before);
});

const empty = (run: RunManifest): RunReport => ({ run_id: run.id, seed: run.seed, durationMs: 40_000,
  bought: [], soldBack: [], delivered: {}, lost: {}, flaresUsed: 0, pirates: [], boomsBroken: [],
  outcome: "moored", inputLogHash: "test" });
const oilPlan = [{ village_id: "ember_falls", item_id: "oil", quantity: "8" }];
const prepared = () => newNight(closeNight(openNight(createWorld())));
function submit(world: World, intent: Intent, id: string, now = 0) {
  return commit(world, quote(world, intent, id, now), now);
}
function withOilShortage() {
  const world = harvest(createWorld("endless"));
  return { ...world, ledger: apply(world.ledger, [
    move(shop("oil_wharf"), "sys:fixture", "oil", 10, "Test shortage"),
    move("sys:crowd", shop("oil_wharf"), "coin", 20, "Test sales"),
  ]) };
}
afterEach(() => vi.useRealTimers());

test("Night 2's pledge plus oil haul pays its bonus from the dock fund without duplicate rescue credit", () => {
  let world = openNight(prepared());
  const offer = Object.values(world.offers).find(o => o.stall === "oil_wharf")!;
  world = submit(world, { type: "buy_offering", offering_id: offer.id, shares: "2" }, "pledge");
  const contract = Object.values(world.river.contracts).find(c => c.relief && c.stall === "oil_wharf")!;
  world = submit(world, { type: "start_run", contract_id: contract.id, barge_plan: [] }, "both-paths");
  const manifest = snapshotFor(world, "test").river.myRun!.manifest;
  const lot = manifest.items.find(lot => lot.item === "oil")!;
  const units = contract.qty;
  const report = { ...empty(manifest), bought: [{ village_id: "ember_falls", item_id: "oil", quantity: units,
    paid: lot.prices.slice(0, units).reduce((a, b) => a + b, 0) }], delivered: { oil: units } };
  const deal = quote(world, { type: "finish_run", run_id: manifest.id, report }, "home", 40000);
  expect(deal.effects).toContainEqual(move("sys:rescue", player, "coin", 2, "Wharf pledge and haul bonus dividend"));
  expect(deal.effects.every(effect => effect.op === "transfer")).toBe(true);
  const home = commit(world, deal, 40000);
  expect(home.traders[player]!.rescued).toBe(1);
  expect(home.traders[player]!.lifetimeDividends).toBe(2);
  for (const asset of [...Object.keys(items), "coin"]) {
    const total = (s: World) => Object.values(s.ledger).reduce((n, account) => n + (account[asset] ?? 0), 0);
    expect(total(home)).toBe(total(world));
  }
});

test("LocalBackend reserves real cargo, settles receipts exactly once, and sells hauled oil at a stall", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const backend = new LocalBackend(), slot = "slot-2";
  const world = prepared();
  await backend.importSave(slot, JSON.stringify(pack(world, world)));
  const night = backend.view().night_id;
  const deal = await backend.getQuote(slot, night, { type: "start_run", barge_plan: oilPlan });
  const before = Number(backend.view().villages.ember_falls!.stock.oil);
  // Every village good opens to the barge, up to a full 12-unit hold each.
  expect(deal.effects).toContainEqual(expect.objectContaining({ op: "transfer", asset: "oil", to: "esc:run:" + deal.quote_id, amount: "12" }));
  expect(deal.effects.map(effect => effect.asset).sort()).toEqual(["cord", "dye", "oil", "paper", "reed"]);
  expect(Number(backend.view().villages.ember_falls!.stock.oil)).toBe(before);
  await backend.submitAction(slot, night, deal.quote_id, "departure");
  const run = backend.view().river.myRun!.manifest;
  expect(Number(backend.view().villages.ember_falls!.stock.oil)).toBe(before - 12);
  expect(backend.view().elapsed).toBe(0);
  vi.setSystemTime(Date.now() + 44_000);
  const price = run.items.find(lot => lot.item === "oil")!.prices.slice(0, 6).reduce((a, b) => a + b, 0);
  const report = { ...empty(run), bought: [{ village_id: "ember_falls", item_id: "oil", quantity: 6, paid: price }], delivered: { oil: 6 } };
  const finish = await backend.getQuote(slot, night, { type: "finish_run", run_id: run.id, report });
  const receipt = await backend.submitAction(slot, night, finish.quote_id, "return");
  expect(await backend.getActionStatus(slot, night, "return")).toEqual(receipt);
  expect(await backend.submitAction(slot, night, finish.quote_id, "return")).toEqual(receipt);
  expect(backend.view().river.myRun).toBeUndefined();
  expect(backend.view().cargo.oil).toBe("8");
  expect(Number(backend.view().villages.ember_falls!.stock.oil)).toBe(before - 6);
  await backend.advancePhase(slot, "market");
  const sale = await backend.getQuote(slot, night, { type: "sell", stall_id: "paper_mill", item_id: "oil", quantity: "2" });
  await backend.submitAction(slot, night, sale.quote_id, "oil-sale");
  expect(backend.view().cargo.oil).toBe("6");
  expect(backend.view().merchants.paper_mill?.suppliedBy).toContainEqual({ name: "You", quantity: "2" });
  const restored = new LocalBackend();
  expect(await restored.restore(slot)).toBe(true);
  expect(restored.view().cargo.oil).toBe("6");
});

test("invalid reports and restoring a mid-run save return the reservations", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const backend = new LocalBackend(), slot = "slot-2", world = prepared();
  await backend.importSave(slot, JSON.stringify(pack(world, world)));
  const night = backend.view().night_id, count = backend.view().villages.ember_falls!.stock.oil;
  async function start(serial: string) {
    const quote = await backend.getQuote(slot, night, { type: "start_run", barge_plan: oilPlan });
    await backend.submitAction(slot, night, quote.quote_id, serial);
    return backend.view().river.myRun!.manifest;
  }
  const run = await start("bad");
  await expect(backend.getQuote(slot, night, { type: "finish_run", run_id: run.id, report: empty(run) })).rejects.toThrow("RIVER_TIME");
  expect(backend.view().villages.ember_falls!.stock.oil).toBe(count);
  expect(backend.view().river.myRun).toBeUndefined();
  await start("reload");
  const resumed = new LocalBackend();
  await resumed.restore(slot);
  expect(resumed.view().river.myRun).toBeUndefined();
  expect(resumed.view().villages.ember_falls!.stock.oil).toBe(count);
});

test("Harbor Bell escrows a single accepted supply contract and pays only for delivery at The Landing", () => {
  const offered = refreshContracts(withOilShortage());
  const offer = Object.values(offered.river.contracts).find(contract => contract.item === "oil")!;
  expect(offer.qty).toBe(8);
  expect(get(offered, "esc:contract:" + offer.id, "coin")).toBe(offer.payout);
  const accepted = submit(offered, { type: "accept_contract", contract_id: offer.id }, "accept");
  const start = submit(accepted, { type: "start_run", barge_plan: [] }, "run");
  const run = snapshotFor(start, "test").river.myRun!.manifest;
  const paid = run.items.find(lot => lot.item === offer.item)!.prices.slice(0, offer.qty).reduce((a, b) => a + b, 0);
  const report = { ...empty(run), bought: [{ village_id: offer.village, item_id: offer.item, quantity: offer.qty, paid }],
    delivered: { oil: offer.qty } };
  const intent = { type: "finish_run", run_id: run.id, report } as const;
  const settled = submit(start, intent, "return", 45000);
  expect(get(settled, shop(offer.stall), offer.item)).toBe(10);
  expect(get(settled, player, "coin")).toBe(30 - paid + offer.payout);
  expect(settled.ledger["esc:contract:" + offer.id]).toBeUndefined();
  expect(settled.ledger["esc:run:" + run.id]).toBeUndefined();
  expect(() => submit(settled, intent, "again", 45000)).toThrow("RIVER_RUN_UNKNOWN");
  const expired = advanceClock(openNight(accepted), 300, false);
  expect(expired.ledger["esc:contract:" + offer.id]).toBeUndefined();
  expect(get(expired, shop(offer.stall), "coin")).toBe(60);
});

test("freight holds cargo until arrival and a seeded loss burns the real shipment", () => {
  let world = withOilShortage();
  world.river.reaches.heron_reach.danger = 5;
  world.river.random = 1972;
  // Remove the earlier ambient legs so the next roll belongs to the freight sailing.
  world = { ...world, river: { ...world.river, hauls: {} }, ledger: apply(world.ledger,
    [move(shop("paper_mill"), "sys:fixture", "oil", 4, "Test no wholesale stock")]) };
  const freight = scheduleFreight(world);
  const haul = Object.values(freight.river.hauls)[0]!;
  expect(haul.arrives - haul.departs).toBe(60);
  expect(get(freight, "r:freight", "oil")).toBeGreaterThan(0);
  expect(get(freight, shop("oil_wharf"), "oil")).toBe(2);
  const open = openNight(freight);
  expect(get(advanceClock(open, 59), "r:freight", "oil")).toBeGreaterThan(0);
  const arrival = advanceClock(open, 60);
  expect(get(arrival, "r:freight", "oil")).toBe(0);
  expect(arrival.activity.some(entry => entry.line.startsWith("Freight barge lost"))).toBe(true);
  expect(get(arrival, shop("oil_wharf"), "oil")).toBe(2);
});

test("a successful escort pays the reserved fee and guarantees the rival haul", () => {
  let world = withOilShortage();
  world = { ...world, ledger: apply(world.ledger, [move("sys:crowd", "r:juno", "coin", 30, "Test route budget")]) };
  world.river.reaches.heron_reach.danger = 3;
  const offered = startRivalHaul(refreshContracts(world), "r:juno", 12);
  const escort = Object.values(offered.river.contracts).find(contract => contract.kind === "escort")!;
  const started = submit(offered, { type: "start_run", escort_id: escort.id, barge_plan: [] }, "escort-run");
  const run = snapshotFor(started, "test").river.myRun!.manifest;
  const durationMs = Math.ceil(run.boats.find(boat => boat.id === escort.haul)!.arrives * 1000);
  const report = { ...empty(run), durationMs, escort: { id: escort.id, completed: true } };
  const home = submit(started, { type: "finish_run", run_id: run.id, report }, "escort-return", durationMs);
  expect(get(home, player, "coin")).toBe(30 + escort.payout);
  expect(get(home, shop("oil_wharf"), "oil")).toBe(10);
  expect(home.river.hauls[escort.haul!]).toBeUndefined();
  expect(home.ledger["esc:contract:" + escort.id]).toBeUndefined();
});

test("a stock-starved stall reopens once a sale restores Tight stock", () => {
  const open = openNight(createWorld("endless"));
  const world = { ...open, ledger: apply(open.ledger, [
    move(shop("paper_mill"), "sys:fixture", "paper", 11, "Test shortage"),
    move(shop("paper_mill"), "sys:fixture", "oil", 4, "Test shortage"),
  ]) };
  const closed = submit(world, { type: "buy", stall_id: "paper_mill", item_id: "paper", quantity: "1" }, "last-paper");
  expect(snapshotFor(closed, "test").merchants.paper_mill).toMatchObject({ band: "dark", stockClosed: true });
  const offer = (quantity: string) => ({ type: "sell", stall_id: "paper_mill", item_id: "paper", quantity } as const);
  const partial = submit(closed, offer("1"), "one");
  expect(snapshotFor(partial, "test").merchants.paper_mill?.band).toBe("dark");
  const supplied = submit(partial, offer("2"), "two");
  expect(snapshotFor(supplied, "test").merchants.paper_mill).toMatchObject({ band: "healthy", stockClosed: false });
  expect(supplied.activity.at(-1)?.line).toBe("You relit Paper Mill with a haul.");
});

function reliefRun(world: World, now = 0) {
  const relief = Object.values(world.river.contracts).find(contract => contract.relief)!;
  const accepted = submit(world, { type: "accept_contract", contract_id: relief.id }, "relief-accept", now);
  const started = submit(accepted, { type: "start_run", barge_plan: [] }, "relief-run", now);
  const run = snapshotFor(started, "test").river.myRun!.manifest;
  const paid = run.items.find(lot => lot.item === relief.item)!.prices.slice(0, relief.qty).reduce((a, b) => a + b, 0);
  const report = { ...empty(run), bought: [{ village_id: relief.village, item_id: relief.item, quantity: relief.qty, paid }],
    delivered: { [relief.item]: relief.qty } };
  return { relief, started, run, report };
}

test("Night 2's dark wharf posts a harbor relief haul that relights it before the market opens", () => {
  const night2 = prepared();
  expect(snapshotFor(night2, "test").merchants.oil_wharf?.band).toBe("dark");
  const { relief, started, run, report } = reliefRun(night2);
  expect(relief).toMatchObject({ stall: "oil_wharf", item: "oil", payer: "sys:rescue", relief: true });
  expect(get(night2, "esc:contract:" + relief.id, "coin")).toBe(relief.payout);
  const home = submit(started, { type: "finish_run", run_id: run.id, report }, "relief-home", 45_000);
  const wharf = snapshotFor(home, "test").merchants.oil_wharf!;
  expect(wharf.band).not.toBe("dark");
  expect(get(home, shop("oil_wharf"), "coin")).toBe(20);
  expect(home.traders[player]!.rescuedTonight).toContain("oil_wharf");
  expect(home.activity.at(-1)?.line).toBe("You relit Oil Wharf with a relief haul!");
  const opened = openNight(home);
  expect(Object.values(opened.offers).some(offer => offer.stall === "oil_wharf" && offer.kind === "rescue")).toBe(false);
});

test("a relief haul during the night refunds the open rescue offering and relights the stall", () => {
  const open = openNight(prepared());
  const rescue = Object.values(open.offers).find(offer => offer.stall === "oil_wharf" && offer.kind === "rescue")!;
  expect(rescue.contributions["r:juno"]).toBe(2);
  const juno = get(open, "r:juno", "coin");
  const { started, run, report } = reliefRun(open, 0);
  const home = submit(started, { type: "finish_run", run_id: run.id, report }, "relief-home", 45_000);
  expect(home.offers[rescue.id]).toBeUndefined();
  expect(get(home, "r:juno", "coin")).toBe(juno + 10);
  expect(home.ledger["esc:offer:" + rescue.id]).toBeUndefined();
  expect(snapshotFor(home, "test").merchants.oil_wharf?.band).not.toBe("dark");
});

test("a local barge can leave during the open night: the Row clock waits, then moves on by the trip", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const backend = new LocalBackend(), slot = "slot-3", world = prepared();
  await backend.importSave(slot, JSON.stringify(pack(world, world)));
  const night = backend.view().night_id;
  await backend.advancePhase(slot, "open-market");
  await backend.tick(20);
  const quote = await backend.getQuote(slot, night, { type: "start_run", barge_plan: [] });
  await backend.submitAction(slot, night, quote.quote_id, "night-run");
  const run = backend.view().river.myRun!.manifest;
  expect(run.limitMs).toBe(150_000);
  await backend.tick(30);
  expect(backend.view().elapsed).toBe(20);
  vi.setSystemTime(Date.now() + 61_000);
  const report = { ...empty(run), durationMs: 60_000 };
  const finish = await backend.getQuote(slot, night, { type: "finish_run", run_id: run.id, report });
  await backend.submitAction(slot, night, finish.quote_id, "night-home");
  expect(backend.view().elapsed).toBe(80);
  expect(backend.view().phase).toBe("open");
});

test("late cast-offs are refused and a run that starts mid-night is shortened to end before closing", () => {
  const open = openNight(prepared());
  const late = { ...open, elapsed: 270 };
  expect(() => quote(late, { type: "start_run", barge_plan: [] }, "late", 0)).toThrow("RIVER_LATE");
  const evening = { ...open, elapsed: 200 };
  const started = submit(evening, { type: "start_run", barge_plan: [] }, "evening", 0);
  expect(snapshotFor(started, "test").river.myRun!.manifest.limitMs).toBe(95_000);
});

test("shared rooms allow River Runs on wall-clock time and reserve only half of a village's stock", () => {
  let live = openNight(createWorld("live"));
  live = addTrader(live, "p:ari", "Ari");
  const stock = get(live, "v:ember_falls", "oil");
  const deal = quoteFor(live, "p:ari", { type: "start_run", barge_plan: [] }, "live-run", 1_000_000);
  expect(deal.effects).toContainEqual(expect.objectContaining({ asset: "oil", amount: String(Math.min(12, Math.ceil(stock / 2))) }));
  const started = commitFor(live, "p:ari", deal, 1_000_000);
  const run = snapshotFor(started, "test", "p:ari").river.myRun!.manifest;
  const early = quoteFor.bind(null, started, "p:ari", { type: "finish_run", run_id: run.id, report: { ...empty(run), durationMs: 50_000 } }, "early");
  expect(() => early(1_010_000)).toThrow("RIVER_TIME");
  expect(() => early(1_050_000)).not.toThrow();
});

describe("wrecks", () => {
  const supply = (state: World, item: string) => Object.values(state.ledger).reduce((sum, account) => sum + (account[item] ?? 0), 0);
  function sunk() {
    let world = withOilShortage();
    world.river.reaches.heron_reach.danger = 5;
    world.river.random = 1972;
    world = { ...world, river: { ...world.river, hauls: {} }, ledger: apply(world.ledger,
      [move(shop("paper_mill"), "sys:fixture", "oil", 4, "Test no wholesale stock")]) };
    const freight = scheduleFreight(world);
    return { freight, arrival: advanceClock(openNight(freight), 60) };
  }

  test("a lost haul sinks into an escrowed wreck that opens at the next dusk", () => {
    const { freight, arrival } = sunk();
    const view = snapshotFor(arrival, "test").river.wrecks;
    expect(view).toHaveLength(1);
    expect(view[0]).toMatchObject({ reach: "heron_reach", name: "the freight barge", open: false, nightsLeft: 3 });
    const units = Number(view[0]!.cargo.oil);
    expect(units).toBeGreaterThan(0);
    expect(get(arrival, "esc:wreck:" + view[0]!.id, "oil")).toBe(units);
    // Sinking is a transfer: the freight barge's whole oil load is now in the wreck.
    const shipped = Object.values(freight.river.hauls).flatMap(haul => haul.cargo).filter(leg => leg.item === "oil")
      .reduce((sum, leg) => sum + leg.qty, 0);
    expect(units).toBe(shipped);
    expect(get(arrival, "r:freight", "oil")).toBe(0);
    const started = submit(arrival, { type: "start_run", barge_plan: [] }, "too-early", 0);
    expect(snapshotFor(started, "test").river.myRun!.manifest.wrecks).toEqual([]);
  });

  test("salvage moves the wreck's goods to the barge exactly once and rejects forged reports", () => {
    const { arrival } = sunk();
    const next = newNight(closeNight(arrival));
    const [wreck] = snapshotFor(next, "test").river.wrecks;
    expect(wreck).toMatchObject({ open: true, nightsLeft: 2, claimed: false });
    const units = Number(wreck!.cargo.oil);
    const started = submit(next, { type: "start_run", barge_plan: [] }, "salvage-run");
    const run = snapshotFor(started, "test").river.myRun!.manifest;
    expect(run.wrecks).toEqual([expect.objectContaining({ id: wreck!.id, cargo: { oil: units } })]);
    expect(snapshotFor(started, "test").river.wrecks[0]!.claimed).toBe(true);
    const report: RunReport = { ...empty(run), salvaged: [{ wreck_id: wreck!.id, item_id: "oil", quantity: units }], delivered: { oil: units } };
    for (const forged of <RunReport[]>[
      { ...report, salvaged: [{ wreck_id: wreck!.id, item_id: "oil", quantity: units + 1 }], delivered: { oil: units + 1 } },
      { ...report, salvaged: [{ wreck_id: "wreck-9-99", item_id: "oil", quantity: 1 }], delivered: { oil: 1 } },
      { ...report, salvaged: [{ wreck_id: wreck!.id, item_id: "paper", quantity: 1 }], delivered: { paper: 1 } },
    ]) expect(() => quote(started, { type: "finish_run", run_id: run.id, report: forged }, "forged", 40_000)).toThrow("RIVER_SALVAGE");
    expect(() => quote(started, { type: "finish_run", run_id: run.id, report: { ...report, delivered: { oil: units + 2 } } },
      "unbalanced", 40_000)).toThrow("RIVER_CARGO");
    const home = submit(started, { type: "finish_run", run_id: run.id, report }, "salvage-home", 40_000);
    expect(get(home, player, "oil") - get(started, player, "oil")).toBe(units);
    expect(get(home, "esc:wreck:" + wreck!.id, "oil")).toBe(0);
    expect(snapshotFor(home, "test").river.wrecks).toEqual([]);
    expect(supply(home, "oil")).toBe(supply(started, "oil"));
    expect(home.activity.some(entry => /salvaged \d+ lamp oil from the wreck of the freight barge on Heron Reach/.test(entry.line))).toBe(true);
  });

  test("a partial salvage releases the claim and leaves the rest for the next barge, across a save", () => {
    const { arrival } = sunk();
    const next = newNight(closeNight(arrival));
    const [wreck] = snapshotFor(next, "test").river.wrecks;
    const started = submit(next, { type: "start_run", barge_plan: [] }, "partial-run");
    const run = snapshotFor(started, "test").river.myRun!.manifest;
    const home = submit(started, { type: "finish_run", run_id: run.id, report: { ...empty(run),
      salvaged: [{ wreck_id: wreck!.id, item_id: "oil", quantity: 1 }], delivered: { oil: 1 } } }, "partial-home", 40_000);
    expect(snapshotFor(home, "test").river.wrecks[0]).toMatchObject({ claimed: false, cargo: { oil: String(Number(wreck!.cargo.oil) - 1) } });
    const decoded = decodeWorld(encodeWorld(home));
    expect(snapshotFor(decoded, "test").river.wrecks).toEqual(snapshotFor(home, "test").river.wrecks);
  });

  test("unsalvaged wrecks break up after two nights and burn to the river", () => {
    const { arrival } = sunk();
    const id = snapshotFor(arrival, "test").river.wrecks[0]!.id;
    const units = get(arrival, "esc:wreck:" + id, "oil");
    const one = newNight(closeNight(arrival)), two = newNight(closeNight(openNight(one)));
    expect(get(two, "esc:wreck:" + id, "oil")).toBe(units);
    expect(snapshotFor(two, "test").river.wrecks[0]).toMatchObject({ open: true, nightsLeft: 1 });
    const three = newNight(closeNight(openNight(two)));
    expect(get(three, "esc:wreck:" + id, "oil")).toBe(0);
    expect(snapshotFor(three, "test").river.wrecks).toEqual([]);
    expect(three.activity.some(entry => entry.line === "The wreck of the freight barge on Heron Reach broke up.")).toBe(true);
  });
});

describe("riverside stops", () => {
  function fisherRun() {
    for (let seed = 1; seed < 300; seed++) {
      const world = createWorld("endless", seed);
      const started = submit(world, { type: "start_run", barge_plan: [] }, "stop-run");
      const run = snapshotFor(started, "test").river.myRun!.manifest;
      const fisher = stopPlan(run.seed).find(stop => stop.kind === "fisher");
      if (fisher && run.items.some(lot => lot.item === "cord")) return { world, started, run, fisher };
    }
    throw new Error("No seed with a fisher stop.");
  }

  test("mending a net moves the cord to Millbrook and pays the bounty from the fund", () => {
    const { started, run, fisher } = fisherRun();
    const cord = run.items.find(lot => lot.item === "cord")!;
    const report: RunReport = { ...empty(run), bought: [{ village_id: "millbrook", item_id: "cord", quantity: 1, paid: cord.prices[0]! }],
      stops: [{ stop_id: fisher.id, choice: "mend" }] };
    const deal = quote(started, { type: "finish_run", run_id: run.id, report }, "mend", 40_000);
    expect(deal.effects).toContainEqual(move(player, "v:millbrook", "cord", 1, "Mended a fisher's net"));
    expect(deal.effects).toContainEqual(move("sys:bounty", player, "coin", 6, "River bounty"));
    const home = commit(started, deal, 40_000);
    expect(home.activity.some(entry => entry.line.endsWith("mended a stranded fisher's net."))).toBe(true);
    for (const item of Object.keys(items)) {
      const total = (state: World) => Object.values(state.ledger).reduce((sum, account) => sum + (account[item] ?? 0), 0);
      expect(total(home)).toBe(total(started));
    }
  });

  test("stops can't be repeated, invented or taken without the cord", () => {
    const { started, run, fisher } = fisherRun();
    const cord = run.items.find(lot => lot.item === "cord")!;
    const bought = [{ village_id: "millbrook", item_id: "cord", quantity: 1, paid: cord.prices[0]! }];
    const finish = (report: RunReport) => quote(started, { type: "finish_run", run_id: run.id, report }, "stop", 40_000);
    expect(() => finish({ ...empty(run), bought, stops: [{ stop_id: fisher.id, choice: "mend" }, { stop_id: fisher.id, choice: "strip" }] })).toThrow("RIVER_STOP");
    expect(() => finish({ ...empty(run), stops: [{ stop_id: "stop-9", choice: "mend" }] })).toThrow("RIVER_STOP");
    expect(() => finish({ ...empty(run), stops: [{ stop_id: fisher.id, choice: "fuel" }] })).toThrow("RIVER_STOP");
    expect(() => finish({ ...empty(run), stops: [{ stop_id: fisher.id, choice: "mend" }] })).toThrow("RIVER_CARGO");
  });
});

describe("harbor almanac", () => {
  test("the campaign scripts Night 3's pressing strike; shared rooms get one rotating event every two nights", () => {
    expect([1, 2, 3, 4].map(night => almanacFor("campaign", night, 42))).toEqual([undefined, undefined, "pressing_strike", undefined]);
    for (const seed of [17, 42, 93, 166, 271]) {
      let previous: string | undefined;
      for (let night = 1; night <= 200; night++) {
        const id = almanacFor("live", night, seed);
        expect(id).toBe(almanacFor("live", night, seed));
        expect(id === undefined).toBe(night < 3 || night % 2 === 0);
        if (!id) continue;
        expect(almanacEvents[id].village).not.toBe(previous);
        previous = almanacEvents[id].village;
      }
    }
  });

  test("an event changes only that good's harvest", () => {
    const world = createWorld("endless", 42);
    const night = [3, 5, 7, 9, 11].find(n => almanacFor("endless", n, 42))!;
    const id = almanacFor("endless", night, 42)!, { village, item } = almanacEvents[id];
    const drained = { ...world, ledger: apply(world.ledger, [move("v:" + village, "sys:fixture", item, get(world, "v:" + village, item), "Test drain")]) };
    const event = harvest({ ...drained, night }), plain = harvest({ ...drained, night: night + 1 });
    const target = villageGoods(village)[item]!;
    expect(get(event, "v:" + village, item)).toBe(harvestTarget(id, village, item, target));
    expect(get(plain, "v:" + village, item)).toBe(target);
    const strip = (state: World) => ({ ...state.ledger, ["v:" + village]: { ...state.ledger["v:" + village], [item]: 0 } });
    expect(strip(event)).toEqual(strip(plain));
  });

  test("the almanac announces Night 3's strike on Night 2, and it halves Ember Falls' harvest", () => {
    const two = prepared();
    expect(snapshotFor(two, "test").river.almanac).toEqual({ tomorrow: expect.objectContaining({ id: "pressing_strike", village: "ember_falls" }) });
    expect(two.activity.some(entry => entry.line.startsWith("Harbor almanac: Pressing strike at Ember Falls tomorrow night."))).toBe(true);
    // The strike changes how much is pressed, not what's already in the store: drain it to see the harvest itself.
    const closed = closeNight(openNight(two));
    const three = newNight({ ...closed, ledger: apply(closed.ledger, [move("v:ember_falls", "sys:fixture", "oil", get(closed, "v:ember_falls", "oil"), "Test drain")]) });
    expect(snapshotFor(three, "test").river.almanac.tonight?.id).toBe("pressing_strike");
    expect(get(three, "v:ember_falls", "oil")).toBeLessThanOrEqual(12);
  });

  test("merchants restock early when tomorrow brings a shortage, and log why", () => {
    for (const seed of [17, 42, 93, 166, 271, 7, 8, 9]) {
      const id = almanacFor("endless", 3, seed);
      if (!id || almanacEvents[id].factor >= 1) continue;
      const { item } = almanacEvents[id];
      const stall = merchantIds.find(entry => (stockTargets(entry)[item] ?? 0) >= 8)!;
      const target = stockTargets(stall)[item]!;
      const base = createWorld("endless", seed);
      const ready = { ...base, river: { ...base.river, contracts: {} }, ledger: apply(base.ledger, [
        ...(get(base, shop(stall), item) > Math.floor(target * .8)
          ? [move(shop(stall), "sys:fixture", item, get(base, shop(stall), item) - Math.floor(target * .8), "Test stock")] : []),
        mint(shop(stall), "coin", 200, "Test sales"),
      ]) };
      const warned = refreshContracts({ ...ready, night: 2 }), calm = refreshContracts({ ...ready, night: 4 });
      const posted = (state: World) => Object.values(state.river.contracts).some(contract => contract.stall === stall && contract.item === item);
      expect(posted(warned)).toBe(true);
      expect(posted(calm)).toBe(false);
      expect(warned.activity.some(entry => entry.line.startsWith(merchants[stall].name + " is stocking up on " + items[item].name.toLowerCase()))).toBe(true);
      return;
    }
    throw new Error("No seed with a Night 3 shortage.");
  });
});

describe("player Bell orders", () => {
  const post = (world: World, quantity = 10, unit_price = 9, item_id = "oil") =>
    submit(world, { type: "post_bell_order", item_id, quantity, unit_price }, "bell-order");
  const legs = (world: World) => Object.values(world.river.hauls).flatMap(haul => haul.cargo.filter(leg => leg.order).map(leg => ({ haul, leg })));
  const funded = () => { const world = createWorld("endless"); return { ...world, ledger: apply(world.ledger, [mint(player, "coin", 200, "Test savings")]) }; };
  function runUntilHauled(world: World) {
    let state = openNight(world);
    for (let at = 10; at <= 280 && !legs(state).length; at += 10) state = advanceClock(state, at);
    return state;
  }

  test("posting escrows the full price, haulers fill it in partial loads, and the night's end refunds the rest", () => {
    const world = funded();
    const coins = get(world, player, "coin"), oil = get(world, player, "oil");
    const posted = post(world);
    expect(get(posted, player, "coin")).toBe(coins - 90);
    expect(get(posted, "esc:bell:bell-order", "coin")).toBe(90);
    expect(snapshotFor(posted, "test").river.myOrder).toMatchObject({ quantity: 10, waiting: 10, delivered: 0, escrow: "90" });
    const hauled = runUntilHauled(posted);
    const { haul, leg } = legs(hauled)[0]!;
    expect(leg.qty).toBeLessThanOrEqual(6);
    const view = snapshotFor(hauled, "test").river.myOrder!;
    expect(view.hauling).toEqual([{ name: hauled.traders[haul.actor]!.name, quantity: leg.qty, eta: haul.arrives - hauled.elapsed }]);
    expect(view.waiting).toBe(10 - leg.qty);
    expect(hauled.activity.some(entry => entry.line.includes("took You’s Bell order") || entry.line.includes("Bell order:"))).toBe(true);
    const closed = advanceClock(hauled, 300);
    const delivered = get(closed, player, "oil") - oil;
    expect(delivered).toBeGreaterThan(0);
    // Every coin the player gave up paid for a delivered unit; the rest came back at the night's end.
    expect(get(closed, player, "coin")).toBe(coins - delivered * 9);
    expect(get(closed, "esc:bell:bell-order", "coin")).toBe(0);
    expect(snapshotFor(closed, "test").river.myOrder).toBeUndefined();
  });

  test("a hauler sunk on the way reopens the units without touching the escrow, and the cargo becomes a wreck", () => {
    const hauled = runUntilHauled(post(funded()));
    const { haul, leg } = legs(hauled)[0]!;
    // Pick a river roll that sinks this haul.
    let random = 1;
    for (; random < 100000; random++) if (((Math.imul(random, 1664525) + 1013904223) >>> 0) / 0x100000000 < .01) break;
    const risky = { ...hauled, elapsed: haul.arrives, river: { ...hauled.river, random,
      reaches: Object.fromEntries(Object.entries(hauled.river.reaches).map(([id, reach]) => [id, { ...reach, danger: 5 }])) as World["river"]["reaches"] } };
    const sunk = advanceRiver(risky);
    const order = snapshotFor(sunk, "test").river.myOrder!;
    expect(order.waiting).toBe(snapshotFor(hauled, "test").river.myOrder!.waiting + leg.qty);
    expect(order.hauling).toEqual([]);
    expect(order.news).toMatch(/sank on .* with \d+ lamp oil\. The wreck can be salvaged tomorrow\. The order is open again\./);
    expect(get(sunk, "esc:bell:bell-order", "coin")).toBe(90);
    expect(snapshotFor(sunk, "test").river.wrecks.some(wreck => Number(wreck.cargo.oil) === leg.qty)).toBe(true);
  });

  test("cancelling refunds the waiting units at once; a haul already under way still delivers and is paid", () => {
    const hauled = runUntilHauled(post(funded()));
    const { haul, leg } = legs(hauled)[0]!;
    const waiting = 10 - leg.qty, before = get(hauled, player, "coin");
    const deal = quote(hauled, { type: "cancel_bell_order", order_id: "bell-order" }, "cancel", 0);
    expect(deal.effects).toEqual([move("esc:bell:bell-order", player, "coin", waiting * 9, "Bell order refund")]);
    const cancelled = commit(hauled, deal, 0);
    expect(get(cancelled, player, "coin")).toBe(before + waiting * 9);
    expect(snapshotFor(cancelled, "test").river.myOrder).toMatchObject({ cancelled: true, waiting: 0 });
    expect(() => quote(cancelled, { type: "cancel_bell_order", order_id: "bell-order" }, "again", 0)).toThrow("BELL_ORDER_UNKNOWN");
    const arrived = advanceRiver({ ...cancelled, elapsed: haul.arrives, river: { ...cancelled.river, reaches: Object.fromEntries(
      Object.entries(cancelled.river.reaches).map(([id, reach]) => [id, { ...reach, danger: 0 }])) as World["river"]["reaches"] } });
    expect(get(arrived, "esc:bell:bell-order", "coin")).toBe(0);
    expect(get(arrived, haul.actor, "coin") - get(cancelled, haul.actor, "coin")).toBe(leg.qty * 9);
    expect(snapshotFor(arrived, "test").river.myOrder).toBeUndefined();
  });

  test("no hauler takes a losing job, and posting then selling back upriver never pays", () => {
    let state = openNight(post(funded(), 10, 3));
    for (let at = 10; at <= 290; at += 10) state = advanceClock(state, at);
    expect(legs(state)).toEqual([]);
    expect(state.activity.some(entry => entry.line.includes("Bell order:"))).toBe(false);
    // The cheapest order a hauler will accept pays more per unit than the village's buyback, so the loop always loses.
    const world = createWorld("endless");
    for (const item of ["paper", "cord", "oil", "reed", "dye"] as const) {
      const id = Object.entries({ paper: "millbrook", cord: "millbrook", oil: "ember_falls", reed: "reedmarsh", dye: "reedmarsh" }).find(([key]) => key === item)![1];
      const stock = get(world, "v:" + id, item), target = villageGoods(id as never)[item]!;
      const cheapest = tradePrice("buy", items[item].price, stock, target, 7000, 1) + 1;
      expect(tradePrice("sell", items[item].price, stock, target, 7000, 1)).toBeLessThan(cheapest);
    }
  });

  test("orders are validated: one per player, funded, village goods only, Night 4 in the campaign, and saved", () => {
    const world = funded();
    const posted = post(world, 2, 9);
    expect(() => post(posted, 1, 9, "paper")).toThrow("BELL_ORDER_LIMIT");
    expect(() => post(createWorld("endless"), 12, 20)).toThrow("BELL_ORDER_FUNDS");
    expect(() => post(world, 1, 9, "lantern_paper")).toThrow("BELL_ORDER");
    expect(() => post(world, 13, 9)).toThrow();
    expect(() => post(prepared(), 2, 9)).toThrow("BELL_ORDER_LOCKED");
    const decoded = decodeWorld(encodeWorld(posted));
    expect(snapshotFor(decoded, "test").river.myOrder).toEqual(snapshotFor(posted, "test").river.myOrder);
  });
});

test("the harbor withdraws a relief bell its village can no longer supply and rings for a good that is in stock", () => {
  const base = createWorld("endless");
  const closed = { ...base, river: { ...base.river, contracts: {} },
    market: { ...base.market, indigo_atelier: { ...base.market.indigo_atelier, stockClosed: true } },
    ledger: apply(base.ledger, [
      move(shop("indigo_atelier"), "sys:fixture", "dye", get(base, shop("indigo_atelier"), "dye"), "Test sold out"),
      move(shop("indigo_atelier"), "sys:fixture", "paper", get(base, shop("indigo_atelier"), "paper"), "Test sold out"),
    ]) };
  const rung = refreshRelief(closed);
  const first = Object.values(rung.river.contracts).find(contract => contract.relief && contract.stall === "indigo_atelier")!;
  expect(first.item).toBe("dye");
  const fund = get(rung, "sys:rescue", "coin");
  // Every dye at Reedmarsh sinks before anyone takes the relief haul.
  const drained = { ...rung, ledger: apply(rung.ledger, [move("v:reedmarsh", "sys:fixture", "dye", get(rung, "v:reedmarsh", "dye"), "Test sunk")]) };
  const again = refreshRelief(drained);
  const relief = Object.values(again.river.contracts).filter(contract => contract.relief && contract.stall === "indigo_atelier");
  expect(relief).toHaveLength(1);
  expect(relief[0]).toMatchObject({ item: "paper", village: "millbrook" });
  expect(get(again, "sys:rescue", "coin")).toBe(fund + first.payout - relief[0]!.payout);
});
