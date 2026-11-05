import "fake-indexeddb/auto";
import { afterEach, expect, test, vi } from "vitest";
import { LocalBackend } from "../apps/web/src/backend/local";
import { pack } from "../apps/web/src/backend/saves";
import { addTrader, advanceClock, closeNight, commit, commitFor, createWorld, newNight, openNight, quote, quoteFor, snapshotFor } from "@lantern/game-core";
import type { Intent, RunManifest, RunReport } from "@lantern/protocol";
import { apply } from "../packages/game-core/src/ledger";
import { get, move, player, shop, type World } from "../packages/game-core/src/model";
import { harvest, refreshContracts, scheduleFreight, startRivalHaul } from "../packages/game-core/src/river";

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
