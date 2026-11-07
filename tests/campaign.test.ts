import "fake-indexeddb/auto";
import { expect, test, vi } from "vitest";
import { reachVoyage } from "./campaign-river";
import { LocalBackend } from "../apps/web/src/backend/local";
import type { Intent, RunManifest, RunReport } from "@lantern/protocol";
import type { ItemId } from "@lantern/content";
import { sourceFor } from "@lantern/content/river";

const empty = (run: RunManifest): RunReport => ({ run_id: run.id, seed: run.seed, durationMs: 40_000,
  bought: [], soldBack: [], delivered: {}, lost: {}, flaresUsed: 0, pirates: [], boomsBroken: [],
  outcome: "moored", inputLogHash: "test" });
import { addTrader, advanceClock, closeNight, commit, commitFor, createWorld, newNight, openNight, quote, quoteFor, snapshotFor } from "@lantern/game-core";
import { apply } from "../packages/game-core/src/ledger";

test("a guest hauls through all four river nights on the local backend and reopens the save", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const backend = new LocalBackend();
    const slot = "slot-3";
    let serial = 0;
    const id = () => "test-" + ++serial;
    const phase = () => backend.advancePhase(slot, id());
    const act = async (intent: Intent) => {
      const view = backend.view();
      const deal = await backend.getQuote(slot, view.night_id, intent);
      const actionId = id();
      const status = await backend.submitAction(slot, view.night_id, deal.quote_id, actionId);
      expect(status.state).toBe("confirmed");
      return { actionId, quoteId: deal.quote_id, night: view.night_id };
    };
    const run = async (contract_id?: string) => {
      await act({ type: "start_run", barge_plan: [], ...(contract_id ? { contract_id } : {}) });
      return backend.view().river.myRun!.manifest;
    };
    const finish = async (manifest: RunManifest, report: RunReport) => {
      vi.setSystemTime(Date.now() + report.durationMs);
      await act({ type: "finish_run", run_id: manifest.id, report });
      expect(backend.view().river.myRun).toBeUndefined();
    };
    /** Buy every unit of one good the run offers and bring it all home. */
    const haul = (manifest: RunManifest, item: string, quantity = 6): RunReport => {
      const lot = manifest.items.find(lot => lot.item === item)!;
      const units = Math.min(quantity, lot.prices.length);
      return { ...empty(manifest), bought: [{ village_id: lot.village, item_id: item, quantity: units,
        paid: lot.prices.slice(0, units).reduce((a, b) => a + b, 0) }], delivered: { [item]: units } };
    };
    /** Sell river goods one at a time to whichever open stall pays most. */
    const sellGoods = async (count: number) => {
      for (let sold = 0; sold < count;) {
        const view = backend.view();
        const offers = Object.entries(view.cargo).filter(([item, n]) => Number(n) > 0 && sourceFor(item as ItemId))
          .flatMap(([item]) => Object.entries(view.merchants).filter(([, m]) => m.band !== "dark" && m.prices[item] &&
            Number(m.coins) >= Number(m.prices[item]!.sell)).map(([stall, m]) => ({ item, stall, price: Number(m.prices[item]!.sell) })))
          .sort((a, b) => b.price - a.price);
        expect(offers.length).toBeGreaterThan(0);
        await act({ type: "sell", stall_id: offers[0]!.stall, item_id: offers[0]!.item, quantity: "1" });
        sold++;
      }
    };
    const step = (label: string) => backend.view().objective.steps.find(s => s.label === label)!.count;

    // Night 1: the barge is ready from the start. One run, then sell six goods to the Row.
    await backend.createSession({ slot });
    expect(backend.view()).toMatchObject({ night: 1, phase: "preparation" });
    const first = await run();
    await finish(first, haul(first, "oil"));
    expect(step("River run")).toBe("1");
    await phase();
    expect(backend.view().phase).toBe("open");
    const coins = Number(backend.view().coins);
    const sale = await act({ type: "sell", stall_id: "oil_wharf", item_id: "oil", quantity: "1" });
    const afterSale = backend.view().coins;
    await backend.submitAction(slot, sale.night, sale.quoteId, sale.actionId);
    expect(backend.view().coins).toBe(afterSale);
    expect(Number(afterSale)).toBeGreaterThan(coins);
    await sellGoods(5);
    expect(step("Goods sold to the Row")).toBe("6");
    expect(backend.view().objective.complete).toBe(true);
    await phase();
    await phase();

    // Night 2: the wharf is dark until a relief haul relights it.
    expect(backend.view()).toMatchObject({ night: 2, phase: "preparation" });
    expect(backend.view().merchants.oil_wharf?.band).toBe("dark");
    const relief = backend.view().river.contracts.find(c => c.relief)!;
    await act({ type: "accept_contract", contract_id: relief.id });
    const second = await run();
    await finish(second, haul(second, relief.item, Number(relief.quantity)));
    expect(backend.view().merchants.oil_wharf?.band).not.toBe("dark");
    expect(backend.view().objective.complete).toBe(true);
    await phase();
    await phase();
    await phase();

    // Night 3: break the boom on the reach and deliver a Harbor Bell contract.
    expect(backend.view()).toMatchObject({ night: 3, mode: "campaign" });
    const contract = backend.view().river.contracts.find(c => c.kind === "supply" && c.item === "dye")!;
    await act({ type: "accept_contract", contract_id: contract.id });
    const third = await run();
    const voyage = reachVoyage(third);
    expect(voyage.replay).toEqual(voyage.report);
    expect(voyage.report.boomsBroken).toEqual(["marsh_bend"]);
    await finish(third, voyage.report);
    expect(backend.view().objective.complete).toBe(true);
    const night3Reload = new LocalBackend();
    expect(await night3Reload.restore(slot)).toBe(true);
    expect(night3Reload.view().objective.complete).toBe(true);
    while (backend.view().night === 3) await phase();

    // Night 4: ride the Floodtide home during the open night, then sell eight goods.
    expect(backend.view()).toMatchObject({ night: 4, mode: "campaign" });
    await phase();
    expect(backend.view().phase).toBe("open");
    const fourth = await run();
    expect(fourth.floodtideAtMs).toBeGreaterThan(0);
    const report = { ...haul(fourth, "paper", 8), durationMs: fourth.floodtideAtMs! + 20_000,
      floodtide: { gates: 2, completed: true, returned: {} } };
    await finish(fourth, report);
    expect(step("Home through Floodtide")).toBe("1");
    await sellGoods(8);
    expect(backend.view().objective.complete).toBe(true);
    await phase();
    expect(backend.view().titles).toContain("Master of the Row");
    const restored = new LocalBackend();
    expect(await restored.restore(slot)).toBe(true);
    expect(restored.view().objective.complete).toBe(true);
    await restored.advancePhase(slot, id());
    expect(restored.view()).toMatchObject({ mode: "endless", night: 5 });
  } finally { vi.useRealTimers(); }
});

test("a one-share rescue pledge refunds when the market closes", () => {
  const second = openNight(newNight(closeNight(openNight(createWorld()))));
  const offer = Object.values(second.offers)[0]!;
  const partial = commit(second, quote(second, { type: "buy_offering", offering_id: offer.id, shares: "1" }, "pledge", 0), 0);
  const closed = closeNight(partial);
  expect(snapshotFor(closed, "test").coins).toBe("30");
  expect(snapshotFor(closed, "test").merchants.oil_wharf?.owned).toBe("0");
  expect(snapshotFor(closed, "test").merchants.oil_wharf?.band).toBe("dark");
});

test("closing a partially filled order leaves the boat dark", () => {
  const world = openNight(createWorld());
  const crafted = commit(world, quote(world, { type: "craft", recipe_id: "paper_lantern", quantity: "1" }, "craft", 0), 0);
  const partial = commit(crafted, quote(crafted, { type: "fill_order", order_id: "kingfisher", quantity: "1" }, "fill", 0), 0);
  expect(snapshotFor(advanceClock(partial, 300, false), "test").orders[1]?.state).toBe("expired");
});

test("a dock job pays only after the boat arrives and only once", () => {
  let world = openNight(createWorld());
  world = { ...world, ledger: apply(world.ledger, [
    { op: "burn", from: "p:guest", asset: "coin", amount: "30", memo: "Test wallet" },
    { op: "burn", from: "p:guest", asset: "oil", amount: "2", memo: "Test cargo" },
  ]) };
  const pickUp = quote(world, { type: "start_job" }, "parcel", 0);
  world = commit(world, pickUp, 0);
  const deliver = { type: "finish_job", job_id: "parcel" } as const;
  expect(() => quote(world, deliver, "deliver", 19999)).toThrow("time to dock");
  world = advanceClock(world, 20, false);
  world = commit(world, quote(world, deliver, "deliver", 20000), 20000);
  expect(snapshotFor(world, "test").coins).toBe("4");
  expect(() => quote(world, deliver, "duplicate", 20000)).toThrow("time to dock");
});

test("share-board escrow and a merchant buyback move shares exactly once", () => {
  let world = openNight(newNight(closeNight(openNight(createWorld()))));
  const offer = Object.values(world.offers)[0]!;
  world = commit(world, quote(world, { type: "buy_offering", offering_id: offer.id, shares: "2" }, "pledge", 0), 0);
  world = addTrader(openNight(newNight(closeNight(world), "endless")), "p:buyer", "Buyer");
  const act = (actor: string, intent: Intent, id: string) => {
    world = commitFor(world, actor, quoteFor(world, actor, intent, id, 0), 0);
  };
  const listing = { type: "list_shares", stall_id: "oil_wharf", shares: "1", price_per_share: "4" } as const;
  act("p:guest", listing, "first-listing");
  expect(snapshotFor(world, "test").merchants.oil_wharf?.owned).toBe("2");
  act("p:guest", { type: "cancel_listing", listing_id: "first-listing" }, "cancel");
  act("p:guest", listing, "listing");
  act("p:buyer", { type: "buy_listing", listing_id: "listing" }, "bought");
  expect(snapshotFor(world, "test").merchants.oil_wharf?.owned).toBe("1");
  expect(snapshotFor(world, "test", "p:buyer").coins).toBe("26");
  world = { ...world, ledger: apply(world.ledger, [{ op: "mint", to: "m:oil_wharf", asset: "coin", amount: "100", memo: "Test buyback cash" }]) };
  const buyback = snapshotFor(world, "test", "p:buyer").merchants.oil_wharf?.buyback;
  expect(buyback).toBeDefined();
  act("p:buyer", { type: "accept_buyback", buyback_id: buyback!.id }, "buyback");
  expect(snapshotFor(world, "test", "p:buyer").merchants.oil_wharf?.owned).toBe("0");
  expect(snapshotFor(world, "test", "p:buyer").coins).toBe(String(26 + Number(buyback!.price)));
});
