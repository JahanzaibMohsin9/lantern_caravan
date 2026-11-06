import { afterEach, expect, test, vi } from "vitest";
import { LiveMarket } from "../apps/server/src/live";
import type { Intent, SettlementProvider, StateStore } from "@lantern/protocol";

type Stored = Parameters<ConstructorParameters<typeof LiveMarket>[0]["save"]>[1];

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

test("the authoritative loop runs 500 nights and accepts a 20-night player", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv("LANTERN_PREP_SECONDS", "1");
  const rows = new Map<string, { state: Stored; revision: number }>();
  const submitted = new Set<string>();
  let batches = 0, flushes = 0, emptyFlushes = 0;
  const store: StateStore<Stored> = {
    async load(id) { return rows.get(id) ?? null; },
    async save(id, state, previous) {
      if ((rows.get(id)?.revision ?? 0) !== previous) throw new Error("Revision conflict");
      rows.set(id, { state: structuredClone(state), revision: previous + 1 });
      return previous + 1;
    },
    async appendActionLog() {}, async appendHistory() {}, async appendChronicle() {},
    async queryHistory() { return []; }, async queryChronicle() { return { entries: [] }; },
  };
  const provider: SettlementProvider = {
    async prepare() {},
    async submit(id) { submitted.add(id); },
    async status(id) { return submitted.has(id) ? { state: "confirmed", receipt: { id, label: "Test receipt" } } : { state: "unknown" }; },
    // Night-close batches end in the night ID; flushes before a player's action add "-r<revision>".
    async settleBatch(batch) {
      if (/-r\d+$/.test(batch.batchId)) flushes++; else batches++;
      if (!batch.effects.length) emptyFlushes++;
      return { state: "confirmed" };
    },
  };
  const market = new LiveMarket(store, provider);
  const id = "soak";
  const actor = "p:bot";
  const identity = { playerId: "bot", displayName: "Campaign Bot" };
  await market.load(id, true);
  let stable = 0;
  let min = Infinity;
  let max = 0;
  let consecutiveDark = 0;
  const streaks = new Map<string, number>();
  let serial = 0;
  const tick = async (milliseconds: number) => { vi.setSystemTime(Date.now() + milliseconds); await market.updateAll(); };
  for (let night = 1; night <= 500; night++) {
    if (night <= 20) await market.join(id, identity, false);
    await tick(1100);
    const view = await market.snapshot(id, actor);
    expect(view.night).toBe(night);
    if (night <= 20) {
      const act = async (intent: Intent) => {
        const deal = await market.getQuote(id, actor, view.night_id, intent);
        expect((await market.submit(id, actor, view.night_id, deal.quote_id, "bot-" + ++serial)).state).toBe("confirmed");
      };
      for (const item of ["paper", "oil"]) {
        if (Number(view.cargo[item])) continue;
        const stall = Object.entries(view.merchants).find(([, merchant]) => merchant.band !== "dark" && Number(merchant.stock[item]));
        expect(stall).toBeDefined();
        await act({ type: "buy", stall_id: stall![0], item_id: item, quantity: "1" });
      }
      await act({ type: "craft", recipe_id: "paper_lantern", quantity: "1" });
      await act({ type: "fill_order", order_id: "boat-0", quantity: "1" });
    }
    await tick(301000);
    const closed = await market.snapshot(id);
    expect(closed.phase).toBe("results");
    const merchants = Object.entries(closed.merchants);
    const coins = merchants.reduce((sum, [, merchant]) => sum + Number(merchant.coins), 0);
    min = Math.min(min, coins);
    max = Math.max(max, coins);
    if (merchants.filter(([, merchant]) => merchant.band !== "dark").length >= 3) stable++;
    for (const [stall, merchant] of merchants) {
      const streak = merchant.band === "dark" ? (streaks.get(stall) ?? 0) + 1 : 0;
      streaks.set(stall, streak);
      consecutiveDark = Math.max(consecutiveDark, streak);
    }
    await tick(31000);
  }
  expect(stable).toBeGreaterThanOrEqual(475);
  expect(consecutiveDark).toBeLessThanOrEqual(5);
  expect(min).toBeGreaterThanOrEqual(50);
  expect(max).toBeLessThanOrEqual(500);
  expect(batches).toBe(500);
  // At most one flush per player action, and only when agents had changed something.
  expect(flushes).toBeGreaterThan(0);
  expect(flushes).toBeLessThanOrEqual(serial);
  expect(emptyFlushes).toBe(0);
}, 30000);
