import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createWorld } from "@lantern/game-core";
import type { LedgerOp, PreparedAction } from "@lantern/protocol";
import { agentAccounts, chainHolder, isAccountId, merchantAccounts } from "../apps/server/src/near/accounts";
import type { CallOutcome, Chain } from "../apps/server/src/near/chain";
import { custodyOps, deltas } from "../apps/server/src/near/custody";
import { NearSettlementProvider, RoutedSettlement, settledLedger, tokenIds } from "../apps/server/src/near/provider";
import { DevSettlementProvider } from "../apps/server/src/providers/dev";
import { FileStateStore } from "../apps/server/src/providers/file";
import { LiveMarket, publicRoom } from "../apps/server/src/live";

const config = { root: "lantern-caravan.testnet", players: "players.lantern-caravan.testnet" };
const internal = (holder: string) => /^(sys|esc|pool):./.test(holder);

/** Follows the items contract's rules: operator-only, all-or-nothing, idempotent per ID, known tokens and holders. */
class FakeChain implements Chain {
  readonly contractId = "items.lantern-caravan.testnet";
  readonly operatorId = "operator.lantern-caravan.testnet";
  balances = new Map<string, number>();
  settled = new Set<string>();
  agents = new Set<string>();
  calls: { method: string; id?: string; ops?: number; signer?: string }[] = [];
  failNext = 0;
  private serial = 0;
  explorer = (hash: string) => "https://testnet.nearblocks.io/txns/" + hash;
  constructor(readonly signers: ReadonlySet<string> = new Set()) {}

  /** `agent_settle`: a registered agent, signing for itself, may only transfer its own balances. */
  async relay(signer: string, method: string, args: Record<string, unknown>): Promise<CallOutcome> {
    if (this.failNext > 0) { this.failNext--; throw new Error("RPC timeout"); }
    if (method !== "agent_settle" || !this.signers.has(signer)) throw new Error("No key for " + signer);
    const hash = "tx-" + ++this.serial;
    const ops = args.ops as LedgerOp[];
    this.calls.push({ method, id: "agent/" + signer + "/" + args.action_id, ops: ops.length, signer });
    if (!this.agents.has(signer)) return { kind: "failed", hash, reason: "Only a registered agent can sign its own transfers." };
    if (ops.some(op => op.op !== "transfer" || op.from !== signer)) return { kind: "failed", hash, reason: "Agents can only transfer their own balances." };
    return this.apply("agent/" + signer + "/" + args.action_id, ops, hash);
  }

  async view<T>(method: string, args: Record<string, unknown>): Promise<T> {
    if (method === "mt_batch_balance_of") return (args.token_ids as string[]).map(token => String(this.balances.get(token + "|" + args.account_id) ?? 0)) as T;
    if (method === "is_agent") return this.agents.has(args.account_id as string) as T;
    throw new Error("Unknown view " + method);
  }

  async call(method: string, args: Record<string, unknown>): Promise<CallOutcome> {
    if (this.failNext > 0) { this.failNext--; throw new Error("RPC timeout"); }
    const hash = "tx-" + ++this.serial;
    if (method === "register_agents") {
      for (const account of args.accounts as string[]) this.agents.add(account);
      this.calls.push({ method });
      return { kind: "ok", hash, applied: true };
    }
    const id = method === "game_settle" ? args.action_id as string : "batch/" + args.batch_id;
    const ops = args.ops as LedgerOp[];
    this.calls.push({ method, id, ops: ops.length });
    return this.apply(id, ops, hash);
  }

  private apply(id: string, ops: LedgerOp[], hash: string): CallOutcome {
    if (this.settled.has(id)) return { kind: "ok", hash, applied: false };
    const next = new Map(this.balances);
    const change = (holder: string, token: string, amount: number) => {
      if (!internal(holder) && !isAccountId(holder)) throw new Error("Unknown holder " + holder);
      if (!tokenIds.includes(token)) throw new Error("Unknown token " + token);
      const key = token + "|" + holder, total = (next.get(key) ?? 0) + amount;
      if (total < 0) throw new Error(holder + " holds too little " + token);
      if (total) next.set(key, total); else next.delete(key);
    };
    try {
      for (const op of ops) {
        if (op.op !== "mint") change(op.from, op.asset, -Number(op.amount));
        if (op.op !== "burn") change(op.to, op.asset, Number(op.amount));
      }
    } catch (error) {
      return { kind: "failed", hash, reason: (error as Error).message };
    }
    this.balances = next;
    this.settled.add(id);
    return { kind: "ok", hash, applied: true };
  }

  /** Balances as a holder → token → amount map, for comparing with a mapped game ledger. */
  wallets() {
    const wallets: Record<string, Record<string, number>> = {};
    for (const [key, amount] of this.balances) {
      const [token, holder] = [key.slice(0, key.indexOf("|")), key.slice(key.indexOf("|") + 1)];
      (wallets[holder] ??= {})[token] = amount;
    }
    return wallets;
  }
}

function mapped(ledger: Record<string, Record<string, number>>) {
  const wallets: Record<string, Record<string, number>> = {};
  for (const [account, assets] of Object.entries(ledger)) {
    for (const [asset, amount] of Object.entries(assets)) {
      if (!amount) continue;
      const holder = chainHolder(account, config);
      (wallets[holder] ??= {})[asset] = (wallets[holder]?.[asset] ?? 0) + amount;
    }
  }
  return wallets;
}

const paths: string[] = [];
const open: NearSettlementProvider[] = [];
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), "lantern-near-"));
  paths.push(dir);
  return dir;
}
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await Promise.all(open.splice(0).map(near => near.close()));
  await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
const action = (actionId: string, effects: LedgerOp[]): PreparedAction => ({ actionId, roomId: publicRoom, nightId: "n1", actorId: "p:ari",
  intent: { type: "start_job" }, effects, expectedRevision: 0, kind: "player" });
const move = (asset: string, amount: number, from: string, to: string, memo = "Test"): LedgerOp =>
  ({ op: "transfer", asset, amount: String(amount), from, to, memo });

describe("account mapping", () => {
  test("merchants, rivals and villages are their own sub-accounts; funds stay internal; players get a derived account", () => {
    expect(chainHolder("m:paper_mill", config)).toBe("mira.lantern-caravan.testnet");
    expect(chainHolder("v:ember_falls", config)).toBe("ember-falls.lantern-caravan.testnet");
    expect(chainHolder("r:freight", config)).toBe("freight.lantern-caravan.testnet");
    expect(chainHolder("r:juno", config)).toBe("juno.lantern-caravan.testnet");
    expect(chainHolder("r:boat-3", config)).toBe("sys:rival-boat-3");
    expect(chainHolder("esc:bell:abc", config)).toBe("esc:bell:abc");
    expect(chainHolder("p:4f1a2b3c4d5e6f708192a3b4", config)).toBe("4f1a2b3c4d5e6f708192a3b4.players.lantern-caravan.testnet");
    expect(chainHolder("p:ari.testnet", config)).toBe("ari.testnet");
    expect(() => chainHolder("x:unknown", config)).toThrow("NEAR_HOLDER");
    expect(agentAccounts(config)).toHaveLength(12);
    expect(agentAccounts(config).every(isAccountId)).toBe(true);
    // Every account a real game ledger uses has a holder.
    for (const account of Object.keys(createWorld("live", 42).ledger)) expect(() => chainHolder(account, config)).not.toThrow();
  });
});

describe("custody", () => {
  test("new supply of a good is minted at its village, then moved on", () => {
    const ops = custodyOps([
      { op: "mint", asset: "oil", amount: "10", to: "v:ember_falls", memo: "Harvest", source: "sys:harvest" },
      move("oil", 3, "v:ember_falls", "p:ari"),
      move("coin", 9, "p:ari", "v:ember_falls"),
      { op: "mint", asset: "lantern_paper", amount: "1", to: "r:juno", memo: "Craft" },
      { op: "burn", asset: "paper", amount: "1", from: "r:juno", memo: "Craft" },
    ]);
    expect(ops.filter(op => op.op === "mint" && op.asset === "oil")).toEqual([
      { op: "mint", asset: "oil", amount: "10", to: "v:ember_falls", memo: "Harvest", source: "sys:harvest" }]);
    expect(ops).toContainEqual(move("oil", 3, "v:ember_falls", "p:ari", "Net market settlement"));
    // Mints come first, then transfers, then burns, so every prefix can be applied on its own.
    const order = ops.map(op => op.op);
    expect(order.lastIndexOf("mint")).toBeLessThan(order.indexOf("transfer"));
    expect(order.lastIndexOf("transfer")).toBeLessThan(order.indexOf("burn"));
    // The ops add up to exactly the same balance changes.
    const sum = (map: ReturnType<typeof deltas>) => JSON.stringify([...map].map(([asset, accounts]) =>
      [asset, [...accounts].filter(([, n]) => n).sort()]).sort());
    expect(sum(deltas(ops))).toBe(sum(deltas([
      { op: "mint", asset: "oil", amount: "10", to: "v:ember_falls", memo: "" }, move("oil", 3, "v:ember_falls", "p:ari"),
      move("coin", 9, "p:ari", "v:ember_falls"), { op: "mint", asset: "lantern_paper", amount: "1", to: "r:juno", memo: "" },
      { op: "burn", asset: "paper", amount: "1", from: "r:juno", memo: "" }])));
  });
});

describe("NEAR settlement provider", () => {
  async function provider(chain = new FakeChain(), dir?: string) {
    const near = new NearSettlementProvider(chain, config, dir ?? await directory(), () => 5);
    open.push(near);
    await near.init();
    return { near, chain };
  }

  test("a player action settles in order behind the agent batch it depends on, with an explorer receipt", async () => {
    const { near, chain } = await provider();
    await near.settleBatch({ batchId: "the-row-n1-r7", roomId: publicRoom, nightId: "n1", effects: [
      { op: "mint", asset: "oil", amount: "6", to: "v:ember_falls", memo: "Harvest", source: "sys:harvest" },
      move("oil", 6, "v:ember_falls", "m:oil_wharf"), { op: "mint", asset: "coin", amount: "20", to: "p:ari", memo: "Float" }] });
    const buy = action("buy-1", [move("oil", 2, "m:oil_wharf", "p:ari"), move("coin", 10, "p:ari", "m:oil_wharf")]);
    expect(await near.status("buy-1")).toEqual({ state: "unknown" });
    await near.prepare(buy);
    await near.submit("buy-1");
    await near.idle();
    expect(chain.calls.map(call => call.method)).toEqual(["game_settle_batch", "game_settle"]);
    expect(await near.status("buy-1")).toEqual({ state: "confirmed", receipt: { id: "tx-2", label: "NEAR testnet transaction",
      url: "https://testnet.nearblocks.io/txns/tx-2" } });
    expect(chain.wallets()["sami.lantern-caravan.testnet"]).toEqual({ oil: 4, coin: 10 });
    await expect(near.prepare({ ...buy, effects: [] })).rejects.toThrow("ACTION_CONFLICT");
  });

  test("the contract refusing an action rejects it; a network error is retried until it lands, exactly once", async () => {
    const { near, chain } = await provider();
    await near.prepare(action("overdraw", [move("coin", 5, "p:ari", "sys:crowd")]));
    await near.submit("overdraw");
    await near.idle();
    expect(await near.status("overdraw")).toMatchObject({ state: "rejected", reason: expect.stringContaining("holds too little coin") });
    chain.failNext = 2;
    await near.settleBatch({ batchId: "b", roomId: publicRoom, nightId: "n1", effects: [{ op: "mint", asset: "coin", amount: "5", to: "p:ari", memo: "Float" }] });
    await near.idle();
    expect(chain.wallets()["ari.players.lantern-caravan.testnet"]).toEqual({ coin: 5 });
    expect(near.info()).toMatchObject({ queued: 0, error: undefined, settled: 1 });
  });

  test("an interrupted outbox resumes after a restart", async () => {
    const dir = await directory();
    const offline = new FakeChain();
    offline.failNext = 1000;
    const first = await provider(offline, dir);
    await first.near.settleBatch({ batchId: "b", roomId: publicRoom, nightId: "n1", effects: [{ op: "mint", asset: "coin", amount: "3", to: "sys:rescue", memo: "Float" }] });
    expect(first.near.info().queued).toBe(1);
    await first.near.close();
    const online = new FakeChain();
    const second = await provider(online, dir);
    await second.near.idle();
    expect(online.wallets()["sys:rescue"]).toEqual({ coin: 3 });
    offline.failNext = 0;
  });

  test("reconcile mints the genesis market, does nothing when in sync, and repairs drift", async () => {
    const { near, chain } = await provider();
    const world = createWorld("live", 42);
    const genesis = await near.reconcile(publicRoom, world.ledger);
    expect(genesis).toMatchObject({ genesis: true, burns: 0 });
    expect(chain.wallets()).toEqual(mapped(world.ledger));
    expect(await near.reconcile(publicRoom, world.ledger)).toMatchObject({ genesis: false, mints: 0, burns: 0, transactions: 0 });
    chain.balances.set("coin|mira.lantern-caravan.testnet", 999);
    chain.balances.delete("oil|ember-falls.lantern-caravan.testnet");
    expect(await near.verify(world.ledger)).toMatchObject({ matches: false, differences: [
      { holder: "ember-falls.lantern-caravan.testnet", token: "oil", chain: 0, game: world.ledger["v:ember_falls"]!.oil },
      { holder: "mira.lantern-caravan.testnet", token: "coin", chain: 999, game: world.ledger["m:paper_mill"]!.coin }] });
    expect(await near.reconcile(publicRoom, world.ledger)).toMatchObject({ mints: 1, burns: 1 });
    expect((await near.verify(world.ledger)).matches).toBe(true);
    expect(chain.wallets()).toEqual(mapped(world.ledger));
  });

  test("registers the twelve agent accounts once", async () => {
    const { near, chain } = await provider();
    expect(await near.ensureAgents()).toHaveLength(12);
    await near.idle();
    expect(await near.ensureAgents()).toEqual([]);
    expect(chain.calls.filter(call => call.method === "register_agents")).toHaveLength(1);
  });

  test("a merchant signs its own leg of a trade; the operator settles the player's leg", async () => {
    const sami = "sami.lantern-caravan.testnet";
    const { near, chain } = await provider(new FakeChain(new Set([sami])));
    await near.ensureAgents();
    await near.settleBatch({ batchId: "stock", roomId: publicRoom, nightId: "n1", effects: [
      { op: "mint", asset: "oil", amount: "6", to: "m:oil_wharf", memo: "Stock" }, { op: "mint", asset: "coin", amount: "20", to: "p:ari", memo: "Float" }] });
    await near.prepare(action("buy-oil", [move("oil", 2, "m:oil_wharf", "p:ari"), move("coin", 10, "p:ari", "m:oil_wharf")]));
    await near.submit("buy-oil");
    await near.idle();
    expect(chain.calls.slice(-2)).toEqual([
      { method: "agent_settle", id: "agent/" + sami + "/buy-oil", ops: 1, signer: sami },
      { method: "game_settle", id: "buy-oil", ops: 1 }]);
    const status = await near.status("buy-oil");
    expect(status).toMatchObject({ state: "confirmed", receipt: { signed: [{ account: sami, url: expect.stringContaining("/txns/tx-") }] } });
    expect(chain.wallets()[sami]).toEqual({ oil: 4, coin: 10 });
    expect(chain.wallets()["ari.players.lantern-caravan.testnet"]).toEqual({ oil: 2, coin: 10 });
    expect(near.info()).toMatchObject({ signers: [sami], agentSigned: 1, lastAgent: { signer: sami } });
  });

  test("in an agent batch each signing merchant sends its own goods; everything else stays with the operator", async () => {
    const mira = "mira.lantern-caravan.testnet";
    const { near, chain } = await provider(new FakeChain(new Set([mira])));
    await near.ensureAgents();
    await near.settleBatch({ batchId: "genesis", roomId: publicRoom, nightId: "n1", effects: [
      { op: "mint", asset: "paper", amount: "5", to: "m:paper_mill", memo: "Stock" }, { op: "mint", asset: "coin", amount: "30", to: "r:juno", memo: "Float" }] });
    await near.settleBatch({ batchId: "n1-r2", roomId: publicRoom, nightId: "n1", effects: [
      move("paper", 3, "m:paper_mill", "r:juno"), move("coin", 9, "r:juno", "m:paper_mill"),
      { op: "mint", asset: "oil", amount: "4", to: "v:ember_falls", memo: "Harvest", source: "sys:harvest" }] });
    await near.idle();
    const agentCalls = chain.calls.filter(call => call.method === "agent_settle");
    expect(agentCalls).toEqual([{ method: "agent_settle", id: "agent/" + mira + "/n1-r2#1", ops: 1, signer: mira }]);
    expect(chain.wallets()[mira]).toEqual({ paper: 2, coin: 9 });
    expect(chain.wallets()["juno.lantern-caravan.testnet"]).toEqual({ paper: 3, coin: 21 });
    expect(near.info().diverged).toBeUndefined();
  });

  test("when the contract refuses a merchant's leg, the player's leg is never sent", async () => {
    const sami = "sami.lantern-caravan.testnet";
    const { near, chain } = await provider(new FakeChain(new Set([sami])));
    await near.ensureAgents();
    await near.prepare(action("overdraw-oil", [move("oil", 2, "m:oil_wharf", "p:ari"), move("coin", 10, "sys:rescue", "m:oil_wharf")]));
    await near.submit("overdraw-oil");
    await near.idle();
    expect(await near.status("overdraw-oil")).toMatchObject({ state: "rejected", reason: expect.stringContaining("holds too little oil") });
    expect(chain.calls.filter(call => call.method === "game_settle")).toEqual([]);
    expect(near.info()).toMatchObject({ queued: 0, diverged: undefined });
  });

  test("only the public Row goes to the chain; private rooms keep the dev ledger", async () => {
    const dir = await directory();
    const { near, chain } = await provider(new FakeChain(), dir);
    const routed = new RoutedSettlement(near, new DevSettlementProvider(dir), new Set([publicRoom]));
    await routed.prepare({ ...action("private-1", [{ op: "mint", asset: "coin", amount: "1", to: "p:ari", memo: "x" }]), roomId: "ab12cd34" });
    await routed.submit("private-1");
    expect((await routed.status("private-1")).state).toBe("confirmed");
    await routed.settleBatch({ batchId: "x", roomId: "ab12cd34", nightId: "n1", effects: [{ op: "mint", asset: "coin", amount: "1", to: "p:ari", memo: "x" }] });
    await near.idle();
    expect(chain.calls).toEqual([]);
  });
});

test.each([
  ["with the operator signing every leg", [] as string[]],
  ["with every merchant signing its own legs", merchantAccounts(config)],
])("the live public Row settles a real trade on chain and every balance matches the game afterwards, %s", async (_, signers) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv("LANTERN_PREP_SECONDS", "1");
  const dir = await directory();
  const store = new FileStateStore<Parameters<ConstructorParameters<typeof LiveMarket>[0]["save"]>[1]>(dir);
  await store.init();
  const chain = new FakeChain(new Set(signers));
  const near = new NearSettlementProvider(chain, config, dir, () => 5);
  open.push(near);
  await near.init();
  await near.ensureAgents();
  await near.idle();
  const market = new LiveMarket(store, new RoutedSettlement(near, new DevSettlementProvider(dir), new Set([publicRoom])));
  await market.load(publicRoom, true);
  await market.reconcileChain(publicRoom);
  await market.join(publicRoom, { playerId: "ari", displayName: "Ari" }, false);
  vi.setSystemTime(Date.now() + 1100);
  await market.snapshot(publicRoom, "p:ari");
  vi.setSystemTime(Date.now() + 25_000);
  const view = await market.snapshot(publicRoom, "p:ari");
  expect(view.phase).toBe("open");
  const deal = await market.getQuote(publicRoom, "p:ari", view.night_id, { type: "buy", stall_id: "paper_mill", item_id: "paper", quantity: "1" });
  let status = await market.submit(publicRoom, "p:ari", view.night_id, deal.quote_id, "buy-paper");
  for (let i = 0; i < 50 && status.state !== "confirmed"; i++) {
    await near.idle();
    await market.snapshot(publicRoom, "p:ari");
    status = await market.actionStatus(publicRoom, "p:ari", view.night_id, "buy-paper");
  }
  expect(status).toMatchObject({ state: "confirmed", receipt: { label: "NEAR testnet transaction" } });
  const after = await market.snapshot(publicRoom, "p:ari");
  expect(after.cargo.paper).toBe(String(Number(view.cargo.paper ?? 0) + 1));
  // The agent ticks before the trade were flushed first, so the chain matches the game exactly.
  const world = (await market.load(publicRoom)).world;
  await near.idle();
  const pending = (await market.load(publicRoom)).agentEffects;
  expect(pending).toEqual([]);
  expect(chain.wallets()).toEqual(mapped(world.ledger));
  expect(chain.calls.some(call => call.method === "game_settle_batch" && call.id!.includes("-r"))).toBe(true);
  // Mira sold the paper, so she signed that leg herself.
  if (signers.length) {
    expect(status).toMatchObject({ receipt: { signed: [{ account: "mira.lantern-caravan.testnet" }] } });
    expect(chain.calls.filter(call => call.method === "agent_settle").every(call => signers.includes(call.signer!))).toBe(true);
  }
  // After more agent activity, a restart-style reconcile flushes it as a custody batch and finds nothing to repair.
  vi.setSystemTime(Date.now() + 30_000);
  await market.snapshot(publicRoom, "p:ari");
  expect((await market.load(publicRoom)).agentEffects.length).toBeGreaterThan(0);
  expect(await market.reconcileChain(publicRoom)).toMatchObject({ mints: 0, burns: 0, transactions: 0 });
  expect(chain.wallets()).toEqual(mapped((await market.load(publicRoom)).world.ledger));
});

test("settledLedger undoes unflushed agent activity, so a check can run mid-night", () => {
  const live = { "v:ember_falls": { oil: 7, coin: 49 }, "p:ari": { oil: 3, coin: 1 } };
  const pending: LedgerOp[] = [{ op: "mint", asset: "oil", amount: "10", to: "v:ember_falls", memo: "Harvest" },
    move("oil", 3, "v:ember_falls", "p:ari"), move("coin", 9, "p:ari", "v:ember_falls")];
  expect(settledLedger(live, pending)).toEqual({ "v:ember_falls": { oil: 0, coin: 40 }, "p:ari": { oil: 0, coin: 10 } });
  expect(live["p:ari"].coin).toBe(1);
});
