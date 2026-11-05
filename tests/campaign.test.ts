import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import { LocalBackend } from "../apps/web/src/backend/local";
import type { Intent } from "@lantern/protocol";
import { addTrader, advanceClock, closeNight, commit, commitFor, createWorld, newNight, openNight, quote, quoteFor, snapshotFor } from "@lantern/game-core";
import { apply } from "../packages/game-core/src/ledger";

test("a guest plays all three nights through the local backend and reopens the save", async () => {
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
  const buy = (stall_id: string, item_id: string, quantity = 1) => act({ type: "buy", stall_id, item_id, quantity: String(quantity) });
  const craft = (recipe_id: string, quantity = 1) => act({ type: "craft", recipe_id, quantity: String(quantity) });
  const deliver = (order_id: string, quantity = 1, wish_id?: string) => act({ type: "fill_order", order_id, quantity: String(quantity), wish_id });

  await backend.createSession({ slot });
  await phase();
  await craft("paper_lantern", 2);
  const first = await deliver("heron");
  const beforeRetry = backend.view().coins;
  await backend.submitAction(slot, first.night, first.quoteId, first.actionId);
  expect(backend.view().coins).toBe(beforeRetry);
  await buy("paper_mill", "paper");
  await buy("oil_wharf", "oil");
  await craft("paper_lantern");
  await deliver("kingfisher", 2);
  expect(backend.view().objective.complete).toBe(true);
  await phase();
  await phase();

  expect(backend.view().night).toBe(2);
  expect(backend.view().merchants.oil_wharf?.band).toBe("dark");
  await act({ type: "buy_upgrade", upgrade_id: "cart_i" });
  await phase();
  const offering = backend.view().merchants.oil_wharf?.offering;
  expect(offering?.available).toBe("2");
  await act({ type: "buy_offering", offering_id: offering!.id, shares: "2" });
  expect(backend.view().merchants.oil_wharf).toMatchObject({ band: "tight", owned: "2" });
  await buy("paper_mill", "paper", 2);
  await buy("oil_wharf", "oil", 2);
  await craft("paper_lantern", 2);
  await deliver("boat-1", 2);
  await buy("paper_mill", "paper", 2);
  await buy("oil_wharf", "oil", 2);
  await buy("reed_thread", "reed", 2);
  await craft("floating_lantern", 2);
  await deliver("boat-0", 2);
  expect(backend.view().objective.complete).toBe(true);
  await phase();
  expect(backend.view().merchants.oil_wharf?.dividend).toBe("2");
  await phase();
  await act({ type: "vote_strategy", stall_id: "oil_wharf", strategy_id: "festival" });
  await phase();
  expect(backend.view().merchants.oil_wharf?.strategy).toBe("festival");

  await buy("paper_mill", "paper", 2);
  await buy("oil_wharf", "oil", 2);
  await craft("paper_lantern");
  await deliver("boat-0", 1, "May the river be kind");
  await buy("reed_thread", "reed");
  await craft("floating_lantern");
  await deliver("boat-1");
  await buy("paper_mill", "paper");
  await buy("oil_wharf", "oil");
  await buy("reed_thread", "cord");
  await buy("indigo_atelier", "dye");
  await craft("colored_lantern");
  await deliver("boat-2");
  await backend.tick(130);
  expect(backend.view().objective.complete).toBe(true);
  await phase();
  expect(backend.view().titles).toContain("Master of the Row");
  const restored = new LocalBackend();
  expect(await restored.restore(slot)).toBe(true);
  expect(restored.view().orders.filter(order => order.state === "filled")).toHaveLength(6);
  expect(restored.view().merchants.oil_wharf?.owned).toBe("2");
  expect(restored.view().orders[0]?.wishes).toEqual(["May the river be kind"]);
  await restored.advancePhase(slot, id());
  expect(restored.view()).toMatchObject({ mode: "endless", night: 4 });
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
