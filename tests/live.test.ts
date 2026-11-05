import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DevIdentityProvider, DevSettlementProvider } from "../apps/server/src/providers/dev";
import { FileStateStore } from "../apps/server/src/providers/file";
import { LiveMarket } from "../apps/server/src/live";
import type { PreparedAction } from "@lantern/protocol";

const paths: string[] = [];
async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), "lantern-live-"));
  paths.push(dir);
  const store = new FileStateStore<Parameters<ConstructorParameters<typeof LiveMarket>[0]["save"]>[1]>(dir);
  await store.init();
  return { dir, store };
}
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe("authoritative market", () => {
  test("a trim is confirmed with the live manifest and survives a server restart", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { dir, store } = await makeStore();
    let market = new LiveMarket(store, new DevSettlementProvider(dir));
    const room = "trim";
    await market.load(room, true);
    await market.join(room, { playerId: "a", displayName: "Ari" }, false);
    const before = await market.snapshot(room, "p:a");
    const deal = await market.getQuote(room, "p:a", before.night_id, { type: "start_run", barge_plan: [], trim: "ironclad" });
    const receipt = await market.submit(room, "p:a", before.night_id, deal.quote_id, "cast-off");
    expect(receipt.state).toBe("confirmed");
    expect(await market.actionStatus(room, "p:a", before.night_id, "cast-off")).toEqual(receipt);
    market = new LiveMarket(store, new DevSettlementProvider(dir));
    const restored = await market.snapshot(room, "p:a");
    expect(restored.barge.trim).toBe("ironclad");
    expect(restored.river.myRun!.manifest.trim).toBe("ironclad");
    expect(restored.coins).toBe(before.coins);
  });

  test("one trader wins a contested order, and both see the same boat", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubEnv("LANTERN_PREP_SECONDS", "1");
    const { dir, store } = await makeStore();
    const market = new LiveMarket(store, new DevSettlementProvider(dir));
    const room = "contest";
    await market.load(room, true);
    await market.join(room, { playerId: "a", displayName: "Ari" }, false);
    await market.join(room, { playerId: "b", displayName: "Bo" }, false);
    vi.setSystemTime(Date.now() + 1100);
    const snapshot = await market.snapshot(room, "p:a");
    const night = snapshot.night_id;
    for (const actor of ["p:a", "p:b"]) {
      const deal = await market.getQuote(room, actor, night, { type: "craft", recipe_id: "paper_lantern", quantity: "1" });
      await market.submit(room, actor, night, deal.quote_id, "craft");
    }
    const intent = { type: "fill_order", order_id: "boat-0", quantity: "1" } as const;
    const a = await market.getQuote(room, "p:a", night, intent);
    const b = await market.getQuote(room, "p:b", night, intent);
    const outcomes = await Promise.allSettled([
      market.serialized(() => market.submit(room, "p:a", night, a.quote_id, "race")),
      market.serialized(() => market.submit(room, "p:b", night, b.quote_id, "race")),
    ]);
    expect(outcomes[0]).toMatchObject({ status: "fulfilled", value: { state: "confirmed" } });
    expect(outcomes[1]).toMatchObject({ status: "rejected" });
    const views = await Promise.all(["p:a", "p:b", ""].map(actor => market.snapshot(room, actor)));
    expect(views[0]!.orders).toEqual(views[1]!.orders);
    expect(views[1]!.orders).toEqual(views[2]!.orders);
    expect(views[0]!.orders[0]?.state).toBe("filled");
    expect(views[0]!.coins).toBe("40");
    expect(views[1]!.coins).toBe("30");
  });

  test("a persisted reservation survives restart and the closing deadline", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubEnv("LANTERN_PREP_SECONDS", "1");
    vi.stubEnv("DEV_SETTLE_DELAY_MS", "3500");
    vi.stubEnv("DEV_SETTLE_DUPLICATE", "1");
    const { dir, store } = await makeStore();
    const room = "restart";
    let market = new LiveMarket(store, new DevSettlementProvider(dir));
    await market.load(room, true);
    await market.join(room, { playerId: "a", displayName: "Ari" }, false);
    vi.setSystemTime(Date.now() + 1100);
    const opened = await market.snapshot(room, "p:a");
    vi.setSystemTime(Date.now() + 298000);
    const deal = await market.getQuote(room, "p:a", opened.night_id, { type: "craft", recipe_id: "paper_lantern", quantity: "1" });
    expect((await market.submit(room, "p:a", opened.night_id, deal.quote_id, "late")).state).toBe("pending");

    market = new LiveMarket(store, new DevSettlementProvider(dir));
    vi.setSystemTime(Date.now() + 3700);
    const settled = await market.actionStatus(room, "p:a", opened.night_id, "late");
    expect(settled.state).toBe("confirmed");
    expect(await market.submit(room, "p:a", opened.night_id, deal.quote_id, "late")).toEqual(settled);
    await expect(market.submit(room, "p:a", opened.night_id, "different", "late")).rejects.toThrow("ACTION_CONFLICT");
    const snapshot = await market.snapshot(room, "p:a");
    expect(snapshot.phase).toBe("results");
    expect(snapshot.cargo.lantern_paper).toBe("1");
  });

  test.each([0, 1])("an unknown dev settlement resolves with failure rate %i", async fail => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubEnv("DEV_SETTLE_FAIL_RATE", String(fail));
    vi.stubEnv("DEV_SETTLE_UNKNOWN_RATE", "1");
    const { dir } = await makeStore();
    const provider = new DevSettlementProvider(dir);
    const prepared: PreparedAction = { actionId: "unique", roomId: "test", nightId: "night", actorId: "p:a",
      expectedRevision: 0, kind: "player", effects: [], intent: { type: "start_job" } };
    await provider.prepare(prepared);
    await provider.submit(prepared.actionId);
    expect((await provider.status(prepared.actionId)).state).toBe("unknown");
    vi.setSystemTime(Date.now() + 2500);
    expect((await provider.status(prepared.actionId)).state).toBe(fail ? "rejected" : "confirmed");
    await provider.submit(prepared.actionId);
    expect((await provider.status(prepared.actionId)).state).toBe(fail ? "rejected" : "confirmed");
  });

  test("a signed dev identity remains valid after a restart", async () => {
    const { dir } = await makeStore();
    const auth = await DevIdentityProvider.create(dir);
    const { credential, player } = auth.issue("Ari");
    const restarted = await DevIdentityProvider.create(dir);
    await expect(restarted.verify(credential)).resolves.toMatchObject({ playerId: player.id });
    await expect(restarted.verify(credential + "wrong")).rejects.toThrow("AUTH_REQUIRED");
  });
});

describe("Bell orders in a live room", () => {
  test("two players' orders race for the same haulers; each gets only their own goods and every coin is accounted for", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubEnv("LANTERN_PREP_SECONDS", "1");
    const { dir, store } = await makeStore();
    const market = new LiveMarket(store, new DevSettlementProvider(dir));
    const room = "bell-race";
    await market.load(room, true);
    await market.join(room, { playerId: "a", displayName: "Ari" }, false);
    await market.join(room, { playerId: "b", displayName: "Bo" }, false);
    const start = await Promise.all(["p:a", "p:b"].map(actor => market.snapshot(room, actor)));
    const night = start[0]!.night_id;
    const orders = [{ actor: "p:a", item_id: "oil", quantity: 3, unit_price: 9 }, { actor: "p:b", item_id: "oil", quantity: 3, unit_price: 10 }];
    const deals = await Promise.all(orders.map(({ actor, ...order }) => market.getQuote(room, actor, night, { type: "post_bell_order", ...order })));
    const outcomes = await Promise.allSettled(orders.map(({ actor }, i) =>
      market.serialized(() => market.submit(room, actor, night, deals[i]!.quote_id, "post-" + actor))));
    expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
    const again = await market.getQuote(room, "p:a", night, { type: "post_bell_order", item_id: "paper", quantity: 1, unit_price: 5 })
      .then(() => "quoted", (error: Error) => error.message);
    expect(again).toContain("BELL_ORDER_LIMIT");
    for (let step = 0; step < 30; step++) {
      vi.setSystemTime(Date.now() + 10_000);
      await market.snapshot(room, "");
    }
    const views = await Promise.all(["p:a", "p:b"].map(actor => market.snapshot(room, actor)));
    let delivered = 0;
    views.forEach((view, i) => {
      const before = start[i]!, order = orders[i]!;
      const got = Number(view.cargo.oil ?? 0) - Number(before.cargo.oil ?? 0);
      delivered += got;
      expect(got).toBeLessThanOrEqual(order.quantity);
      const held = view.river.myOrder ? Number(view.river.myOrder.escrow) : 0;
      // Coins in hand + coins still in escrow + coins paid for delivered oil = the purse before posting.
      expect(Number(view.coins) + held + got * order.unit_price).toBe(Number(before.coins));
    });
    expect(delivered).toBeGreaterThan(0);
  });
});
