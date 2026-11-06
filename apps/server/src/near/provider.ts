/**
 * Settles the live market to the NEAR items contract.
 *
 * Every chain transaction goes through one ordered outbox saved to disk: agent batches, player actions,
 * agent registration and reconciles. The chain therefore sees changes in the same order as the game, and a
 * job that was interrupted is simply sent again: the contract ignores an action ID it has already settled.
 * Gameplay waits only for its own action to execute, which takes a second or two on testnet.
 */
import { join } from "node:path";
import { items, merchants } from "@lantern/content";
import type { LedgerOp, PreparedAction, SettlementProvider, SettlementStatus } from "@lantern/protocol";
type Ledger = Record<string, Record<string, number>>;
import { atomic, readJson } from "../providers/file";
import { agentAccounts, chainHolder, type AccountConfig } from "./accounts";
import type { Chain } from "./chain";
import { chunk, custodyOps } from "./custody";

/** Ops per transaction. The contract accepts 200; smaller chunks stay well inside the 300 Tgas limit. */
export const opsPerCall = 40;
export const tokenIds = ["coin", ...Object.keys(items), ...Object.keys(merchants).map(stall => "share:" + stall)];

type ChainOp = LedgerOp;
type Job =
  | { id: string; kind: "action"; actionId: string; ops: ChainOp[] }
  | { id: string; kind: "batch"; ops: ChainOp[] }
  | { id: string; kind: "agents"; accounts: string[] };
type Outcome = { state: "confirmed"; hash: string; at: number; applied: boolean } | { state: "rejected"; hash: string; reason: string; at: number };
type State = {
  queue: Job[]; outcomes: Record<string, Outcome>; prepared: Record<string, string>; holders: string[];
  settled: number; last?: { id: string; hash: string; at: number }; error?: string; diverged?: string;
};

export type ChainStatus = {
  enabled: true; network: "testnet"; contract: string; operator: string; contractUrl: string;
  queued: number; settled: number; last?: { id: string; url: string; at: number }; error?: string; diverged?: string;
};

export class NearSettlementProvider implements SettlementProvider {
  private state: State = { queue: [], outcomes: {}, prepared: {}, holders: [], settled: 0 };
  private running = false;
  private closed = false;
  private retry?: ReturnType<typeof setTimeout>;
  private backoff = 0;
  private readonly file: string;

  constructor(private readonly chain: Chain, private readonly accounts: AccountConfig, directory: string,
    private readonly retryMs = (attempt: number) => Math.min(30000, 1000 * 2 ** attempt)) {
    this.file = join(directory, "near-settlement.json");
  }

  async init() {
    const saved = await readJson<State>(this.file);
    if (saved) this.state = { ...this.state, ...saved };
    this.pump();
  }

  private saving = Promise.resolve();
  /** Saves run one at a time: Windows refuses two renames onto the same file at once. */
  private save() {
    const snapshot = JSON.parse(JSON.stringify(this.state)) as State;
    const next = this.saving.then(() => atomic(this.file, snapshot));
    this.saving = next.catch(() => {});
    return next;
  }

  private mapOps(ops: readonly LedgerOp[]): ChainOp[] {
    return ops.map(op => {
      if (!tokenIds.includes(op.asset)) throw new Error("NEAR_TOKEN · " + op.asset + " is not in the items contract.");
      if (op.op === "mint") return { ...op, to: chainHolder(op.to, this.accounts) };
      if (op.op === "burn") return { ...op, from: chainHolder(op.from, this.accounts) };
      return { ...op, from: chainHolder(op.from, this.accounts), to: chainHolder(op.to, this.accounts) };
    }).filter(op => op.op !== "transfer" || op.from !== op.to);
  }

  private async enqueue(jobs: Job[]) {
    if (!jobs.length) return;
    const holders = new Set(this.state.holders);
    for (const job of jobs) {
      if (job.kind === "agents") continue;
      for (const op of job.ops) {
        if (op.op !== "mint") holders.add(op.from);
        if (op.op !== "burn") holders.add(op.to);
      }
    }
    this.state.holders = [...holders].sort();
    this.state.queue.push(...jobs);
    await this.save();
    this.pump();
  }

  // ---------- SettlementProvider ----------

  async prepare(action: PreparedAction) {
    const fingerprint = JSON.stringify(action);
    const prior = this.state.prepared[action.actionId];
    if (prior && prior !== fingerprint) throw new Error("ACTION_CONFLICT");
    if (!prior) { this.state.prepared[action.actionId] = fingerprint; await this.save(); }
  }

  async submit(actionId: string) {
    const fingerprint = this.state.prepared[actionId];
    if (!fingerprint) throw new Error("Action was not prepared.");
    if (this.state.outcomes[actionId] || this.state.queue.some(job => job.kind === "action" && job.actionId === actionId)) return;
    const action = JSON.parse(fingerprint) as PreparedAction;
    const ops = this.mapOps(action.effects);
    // An action with no ledger effects (accepting a contract, a free refit) has nothing to put on chain.
    if (!ops.length) {
      this.state.outcomes[actionId] = { state: "confirmed", hash: "", at: Date.now(), applied: false };
      await this.save();
      return;
    }
    await this.enqueue([{ id: actionId, kind: "action", actionId, ops }]);
  }

  async status(actionId: string): Promise<SettlementStatus> {
    const outcome = this.state.outcomes[actionId];
    if (outcome?.state === "confirmed") return { state: "confirmed", receipt: outcome.hash
      ? { id: outcome.hash, label: "NEAR testnet transaction", url: this.chain.explorer(outcome.hash) }
      : { id: actionId, label: "No ledger change" } };
    if (outcome?.state === "rejected") return { state: "rejected", reason: "The items contract refused this action: " + outcome.reason };
    if (this.state.queue.some(job => job.kind === "action" && job.actionId === actionId)) return { state: "pending" };
    return { state: "unknown" };
  }

  async settleBatch(batch: { batchId: string; roomId: string; nightId: string; effects: LedgerOp[] }): Promise<SettlementStatus> {
    const ops = this.mapOps(custodyOps(batch.effects));
    const parts = chunk(ops, opsPerCall);
    await this.enqueue(parts.map((part, i) => ({ id: "batch/" + batch.batchId + "#" + (i + 1), kind: "batch", ops: part })));
    return { state: "pending" };
  }

  // ---------- Reconcile, agents and status ----------

  /** True when a batch was refused, so the chain may no longer match the game until the next reconcile. */
  needsReconcile() { return !!this.state.diverged; }

  /**
   * Brings the chain to exactly the game's ledger: reads every known holder's balances and settles the
   * difference as mints and burns. On an empty contract this is the genesis of the market.
   */
  async reconcile(roomId: string, ledger: Ledger, timeoutMs = 180000) {
    await this.idle(timeoutMs);
    const { mints, burns, chainTotal } = await this.compare(ledger);
    const ops = [...mints, ...burns].map(op => chainTotal ? op : { ...op, memo: "Genesis",
      ...(op.op === "mint" ? { source: "sys:genesis" } : {}) } as ChainOp);
    const stamp = Date.now().toString(36);
    const jobs: Job[] = chunk(ops, opsPerCall).map((part, i) => ({ id: "resync/" + roomId + "/" + stamp + "#" + (i + 1), kind: "batch", ops: part }));
    this.state.diverged = undefined;
    await this.enqueue(jobs);
    await this.idle(timeoutMs);
    return { genesis: !chainTotal, mints: mints.length, burns: burns.length, transactions: jobs.length };
  }

  /** Read-only: every holder and token where the chain differs from the game's ledger. */
  async verify(ledger: Ledger) {
    const { differences, holders } = await this.compare(ledger);
    return { holders: holders.length, tokens: tokenIds.length, matches: !differences.length, differences };
  }

  private compare(ledger: Ledger) { return compareChain(this.chain, this.accounts, ledger, this.state.holders); }

  /** Registers every merchant, rival and village account that isn't an agent yet. */
  async ensureAgents() {
    const missing: string[] = [];
    for (const account of agentAccounts(this.accounts)) {
      if (!await this.chain.view<boolean>("is_agent", { account_id: account })) missing.push(account);
    }
    if (missing.length) await this.enqueue([{ id: "agents/" + missing.join(","), kind: "agents", accounts: missing }]);
    return missing;
  }

  info(): ChainStatus {
    const last = this.state.last;
    return { enabled: true, network: "testnet", contract: this.chain.contractId, operator: this.chain.operatorId,
      contractUrl: "https://testnet.nearblocks.io/address/" + this.chain.contractId,
      queued: this.state.queue.length, settled: this.state.settled,
      last: last && { id: last.id, url: this.chain.explorer(last.hash), at: last.at }, error: this.state.error, diverged: this.state.diverged };
  }

  async idle(timeoutMs = 180000) {
    const end = Date.now() + timeoutMs;
    while (this.state.queue.length) {
      if (Date.now() > end) throw new Error("NEAR_BUSY · The settlement queue did not drain in time." + (this.state.error ? " " + this.state.error : ""));
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // ---------- The outbox ----------

  /** Stops sending; whatever is queued stays saved for the next start. */
  async close() {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    while (this.running) await new Promise(resolve => setTimeout(resolve, 20));
    await this.saving;
  }

  private pump() {
    if (this.closed || this.running || !this.state.queue.length) return;
    this.running = true;
    void this.drain().finally(() => { this.running = false; if (this.state.queue.length && !this.retry) this.pump(); });
  }

  private async drain() {
    while (this.state.queue.length && !this.closed) {
      const job = this.state.queue[0]!;
      let outcome;
      try {
        outcome = job.kind === "agents"
          ? await this.chain.call("register_agents", { accounts: job.accounts }, 100)
          : await this.chain.call(job.kind === "action" ? "game_settle" : "game_settle_batch",
            job.kind === "action" ? { action_id: job.actionId, ops: job.ops } : { batch_id: job.id.replace(/^batch\//, ""), ops: job.ops });
      } catch (error) {
        // The outcome is unknown: try the same job again later. A repeat is harmless.
        this.state.error = "Waiting to retry: " + (error instanceof Error ? error.message : String(error)).slice(0, 200);
        await this.save();
        const delay = this.retryMs(this.backoff++);
        this.backoff = Math.min(this.backoff, 5);
        this.retry = setTimeout(() => { this.retry = undefined; this.pump(); }, delay);
        this.retry.unref?.();
        return;
      }
      this.backoff = 0;
      this.state.error = undefined;
      this.state.queue.shift();
      const at = Date.now();
      if (outcome.kind === "ok") {
        if (job.kind === "action") this.state.outcomes[job.actionId] = { state: "confirmed", hash: outcome.hash, at, applied: outcome.applied };
        this.state.settled++;
        this.state.last = { id: job.id, hash: outcome.hash, at };
      } else if (job.kind === "action") {
        this.state.outcomes[job.actionId] = { state: "rejected", hash: outcome.hash, reason: outcome.reason, at };
      } else {
        this.state.diverged = job.id + ": " + outcome.reason;
      }
      this.prune();
      await this.save();
    }
  }

  /** Keeps the outcome and prepared records of the most recent 500 actions. */
  private prune() {
    const ids = Object.keys(this.state.outcomes);
    if (ids.length <= 500) return;
    for (const id of ids.sort((a, b) => this.state.outcomes[a]!.at - this.state.outcomes[b]!.at).slice(0, ids.length - 500)) {
      delete this.state.outcomes[id];
      delete this.state.prepared[id];
    }
  }
}

/**
 * Reads every holder's balances from the contract and compares them with a game ledger. `knownHolders` adds
 * holders that may hold something on chain but nothing in the ledger any more.
 */
export async function compareChain(chain: Pick<Chain, "view">, accounts: AccountConfig, ledger: Ledger, knownHolders: readonly string[] = []) {
  const target = new Map<string, Map<string, number>>();
  for (const [account, assets] of Object.entries(ledger)) {
    const holder = chainHolder(account, accounts);
    const wallet = target.get(holder) ?? new Map<string, number>();
    for (const [asset, amount] of Object.entries(assets)) {
      if (!amount) continue;
      if (!tokenIds.includes(asset)) throw new Error("NEAR_TOKEN · " + asset + " is not in the items contract.");
      wallet.set(asset, (wallet.get(asset) ?? 0) + amount);
    }
    target.set(holder, wallet);
  }
  const holders = [...new Set([...target.keys(), ...knownHolders])].sort();
  const mints: ChainOp[] = [], burns: ChainOp[] = [];
  const differences: { holder: string; token: string; chain: number; game: number }[] = [];
  let chainTotal = 0;
  for (const holder of holders) {
    const onChain = await chain.view<string[]>("mt_batch_balance_of", { account_id: holder, token_ids: tokenIds });
    tokenIds.forEach((token, i) => {
      const have = Number(onChain[i] ?? 0), want = target.get(holder)?.get(token) ?? 0;
      chainTotal += have;
      if (have !== want) differences.push({ holder, token, chain: have, game: want });
      if (want > have) mints.push({ op: "mint", asset: token, amount: String(want - have), to: holder, memo: "Resync", source: "sys:resync" });
      if (have > want) burns.push({ op: "burn", asset: token, amount: String(have - want), from: holder, memo: "Resync", sink: "sys:resync" });
    });
  }
  return { mints, burns, chainTotal, holders, differences };
}


/** The ledger as the chain should hold it: the live ledger with agent activity that hasn't been flushed yet undone. */
export function settledLedger(ledger: Ledger, pending: readonly LedgerOp[]): Ledger {
  const settled: Ledger = JSON.parse(JSON.stringify(ledger));
  const add = (account: string, asset: string, amount: number) => {
    const wallet = settled[account] ??= {};
    wallet[asset] = (wallet[asset] ?? 0) + amount;
  };
  for (const op of pending) {
    if (op.op !== "mint") add(op.from, op.asset, Number(op.amount));
    if (op.op !== "burn") add(op.to, op.asset, -Number(op.amount));
  }
  return settled;
}

/** Sends the rooms that live on chain to NEAR, and every other room to the local dev ledger. */
export class RoutedSettlement implements SettlementProvider {
  private routes = new Map<string, boolean>();
  constructor(readonly near: NearSettlementProvider, private readonly local: SettlementProvider, private readonly rooms: ReadonlySet<string>) {}
  private pick(onChain: boolean) { return onChain ? this.near : this.local; }
  async prepare(action: PreparedAction) {
    const onChain = this.rooms.has(action.roomId);
    this.routes.set(action.actionId, onChain);
    await this.pick(onChain).prepare(action);
  }
  async submit(actionId: string) { await this.pick(this.routes.get(actionId) ?? false).submit(actionId); }
  async status(actionId: string) { return this.pick(this.routes.get(actionId) ?? false).status(actionId); }
  async settleBatch(batch: Parameters<NonNullable<SettlementProvider["settleBatch"]>>[0]) {
    return this.rooms.has(batch.roomId) ? this.near.settleBatch(batch) : this.local.settleBatch?.(batch) ?? { state: "confirmed" as const };
  }
  needsReconcile(roomId: string) { return this.rooms.has(roomId) && this.near.needsReconcile(); }
  async reconcile(roomId: string, ledger: Ledger) { return this.rooms.has(roomId) ? this.near.reconcile(roomId, ledger) : undefined; }
}
