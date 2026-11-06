import { items } from "@lantern/content";
import { advanceClock, cancelRun, InvalidRun, isRiverIntent, closeNight, commit, createWorld, newNight, nightId, nowAt, objective, openNight, player,
  quote, recordAction, snapshotFor, validateQuote, type World } from "@lantern/game-core";
import { haggle as bargain } from "@lantern/game-core/haggle";
import type { ActionStatus, CreateSessionReq, HaggleOffer, HistoryRange, HistoryRow, Intent,
  LedgerOp, MarketBackend, Quote, Snapshot } from "@lantern/protocol";
import { pack, read, remove, slots, unpack, write } from "./saves";

export class LocalBackend implements MarketBackend {
  readonly kind = "local";
  readonly environmentLabel = "Local";
  private world = createWorld();
  private checkpoint = this.world;
  private slot: string = slots[0];
  private quotes = new Map<string, { deal: Quote; baseline: LedgerOp[] }>();
  private actions = new Map<string, { quoteId: string; status: ActionStatus }>();
  private phases = new Set<string>();
  private saveStatus: Snapshot["saveStatus"] = "saved";
  private saveQueue = Promise.resolve();

  async listProfiles() {
    const found = await Promise.all(slots.map(async slot => {
      const row = await read(slot);
      if (!row) return null;
      for (const candidate of [row.current, row.backup]) {
        try {
          const { world, updated } = unpack(candidate);
          return { slot, updated, night: world.night, mode: world.mode, phase: world.phase };
        } catch { /* try the previous save */ }
      }
      return { slot, updated: 0 };
    }));
    return found.filter(row => row !== null);
  }

  private changeSession(slot: string, world: World, checkpoint = world) {
    this.slot = slot;
    this.world = cancelRun(world, player);
    this.checkpoint = checkpoint;
    this.quotes.clear();
    this.actions.clear();
    this.phases.clear();
    this.saveStatus = "saved";
  }

  async createSession(req: CreateSessionReq) {
    if (!slots.some(slot => slot === req.slot)) throw new Error("Choose a profile slot.");
    this.changeSession(req.slot, createWorld(req.mode === "endless" ? "endless" : "campaign"));
    await this.save();
    return { sessionId: this.slot };
  }

  async joinRoom(slot: string) {
    if (!await this.restore(slot)) throw new Error("There is no save in that slot.");
    return { sessionId: slot };
  }

  async restore(slot: string = slots[0]) {
    await this.saveQueue;
    const row = await read(slot);
    if (!row) return false;
    try {
      const { world, checkpoint } = unpack(row.current);
      this.changeSession(slot, world, checkpoint);
      if (this.world !== world) await this.save();
    } catch (error) {
      if (!row.backup) throw error;
      const { world, checkpoint } = unpack(row.backup);
      this.changeSession(slot, world, checkpoint);
      await this.save();
    }
    return true;
  }

  async deleteProfile(slot: string) {
    await this.saveQueue;
    await remove(slot);
    if (this.slot === slot) this.changeSession(slot, createWorld());
  }

  exportSave() {
    return JSON.stringify(pack(this.world, this.checkpoint), null, 2);
  }

  async importSave(slot: string, json: string) {
    const { world, checkpoint } = unpack(JSON.parse(json));
    this.changeSession(slot, world, checkpoint);
    await this.save();
    return this.view();
  }

  save() {
    const world = this.world;
    const checkpoint = this.checkpoint;
    const slot = this.slot;
    this.saveQueue = this.saveQueue.then(async () => {
      try {
        await write(slot, world, checkpoint);
        if (slot === this.slot) this.saveStatus = "saved";
      } catch {
        if (slot === this.slot) this.saveStatus = "unsaved";
      }
    });
    return this.saveQueue;
  }

  private check(sessionId: string, requestedNight?: string) {
    if (sessionId !== this.slot || (requestedNight && requestedNight !== nightId(this.world))) {
      throw new Error("This quote belongs to a different market.");
    }
  }

  view(): Snapshot {
    return { ...snapshotFor(this.world, this.slot, player, Date.now()), saveStatus: this.saveStatus };
  }

  async getSnapshot(sessionId: string) {
    this.check(sessionId);
    return this.view();
  }

  async getSaveStatus(sessionId: string) {
    this.check(sessionId);
    return { state: this.saveStatus };
  }

  async getCatalog(contentVersion: string) {
    return { version: contentVersion, items: Object.fromEntries(Object.entries(items).map(([id, item]) =>
      [id, { name: item.name, price: String(item.price) }])) };
  }

  async getChronicle(roomId: string, cursor?: string) {
    this.check(roomId);
    const start = cursor ? Number(cursor) : 0;
    const entries = [...this.world.activity].reverse().slice(start, start + 30).map((entry, index) =>
      ({ ...entry, id: String(start + index), time: Math.floor(entry.at * 1000) }));
    return { entries, cursor: start + 30 < this.world.activity.length ? String(start + 30) : undefined };
  }

  async getHistory(roomId: string, _range: HistoryRange) {
    this.check(roomId);
    const view = this.view();
    const rows: HistoryRow[] = Object.entries(view.merchants).flatMap(([stall, merchant]) => Object.entries(merchant.prices).map(([item, hint]) =>
      ({ time: view.server_time, night: view.night, stall, item, coins: merchant.coins, price: hint.buy,
        strategy: merchant.strategy, dividend: merchant.dividendHistory.at(-1) ?? "0" })));
    for (const [village, market] of Object.entries(view.villages)) {
      for (const [item, hint] of Object.entries(market.prices)) rows.push({ kind: "village", village, item,
        time: view.server_time, night: view.night, coins: market.coins, price: hint.buy, stock: market.stock[item] ?? "0" });
    }
    rows.push(...view.river.reaches.map(reach => ({ kind: "reach" as const, reach: reach.id,
      time: view.server_time, night: view.night, danger: reach.danger, boom: reach.boom })));
    return { rows };
  }

  private remember(deal: Quote, baseline = deal.effects) {
    const now = nowAt(this.world);
    for (const [id, entry] of this.quotes) {
      if (entry.deal.expires_at <= (isRiverIntent(entry.deal.intent) ? Date.now() : now)) this.quotes.delete(id);
    }
    this.quotes.set(deal.quote_id, { deal: structuredClone(deal), baseline: structuredClone(baseline) });
    return deal;
  }

  async getQuote(sessionId: string, night: string, intent: Intent) {
    this.check(sessionId, night);
    try {
      return this.remember(quote(this.world, intent, crypto.randomUUID(), isRiverIntent(intent) ? Date.now() : nowAt(this.world)));
    } catch (error) {
      const malformed = intent.type === "finish_run" && error instanceof Error && error.name === "ZodError" &&
        this.view().river.myRun?.id === intent.run_id;
      if (error instanceof InvalidRun || malformed) {
        this.world = cancelRun(this.world, player);
        await this.save();
      }
      if (malformed) throw new InvalidRun("RIVER_REPORT · The report is malformed.");
      throw error;
    }
  }

  async haggle(sessionId: string, night: string, offer: HaggleOffer) {
    this.check(sessionId, night);
    const now = nowAt(this.world);
    const outcome = bargain(this.world, offer, crypto.randomUUID(), now);
    this.world = outcome.state;
    const deal = outcome.result.quote;
    if (deal) this.remember(deal, quote(this.world, deal.intent, deal.quote_id, now).effects);
    await this.save();
    return outcome.result;
  }

  async submitAction(sessionId: string, night: string, quoteId: string, actionId: string) {
    this.check(sessionId, night);
    const previous = this.actions.get(actionId);
    if (previous) {
      if (previous.quoteId !== quoteId) throw new Error("That action ID already belongs to another quote.");
      return previous.status;
    }
    const entry = this.quotes.get(quoteId);
    if (!entry) throw new Error("Ask for a fresh quote.");
    const now = isRiverIntent(entry.deal.intent) ? Date.now() : nowAt(this.world);
    validateQuote(this.world, player, entry.deal, entry.baseline, now);
    const receipt = { id: actionId, label: "Local receipt" };
    this.world = recordAction(commit(this.world, entry.deal, now), player, entry.deal.summary, receipt);
    // The Row's clock waits while the barge is out on a local night; the trip's time passes when it moors.
    const trip = entry.deal.intent.type === "finish_run" ? entry.deal.intent.report.durationMs / 1000 : 0;
    if (trip && this.world.phase === "open") this.world = advanceClock(this.world, this.world.elapsed + trip);
    const status: ActionStatus = { state: "confirmed", receipt };
    this.actions.set(actionId, { quoteId, status });
    this.quotes.delete(quoteId);
    await this.save();
    return status;
  }

  async getActionStatus(sessionId: string, night: string, actionId: string): Promise<ActionStatus> {
    this.check(sessionId, night);
    const entry = this.actions.get(actionId);
    if (entry) return entry.status;
    const receipt = this.world.activity.find(entry => entry.receipt?.id === actionId)?.receipt;
    if (!receipt) throw new Error("That receipt isn’t available.");
    return { state: "confirmed", receipt };
  }

  async advancePhase(sessionId: string, actionId: string) {
    this.check(sessionId);
    if (this.phases.has(actionId)) return this.view();
    const goal = objective(this.world, player).complete;
    if (this.world.phase === "preparation") this.world = openNight(cancelRun(this.world, player));
    else if (this.world.phase === "open" && goal) this.world = closeNight(this.world);
    else if (this.world.phase === "results" && (goal || this.world.mode === "endless")) {
      this.world = newNight(this.world, this.world.mode === "campaign" && this.world.night === 4 ? "endless" : this.world.mode);
      this.checkpoint = this.world;
    } else throw new Error("Finish this night’s objective first.");
    this.phases.add(actionId);
    this.quotes.clear();
    await this.save();
    return this.view();
  }

  async retry() {
    this.world = openNight({ ...this.checkpoint, revision: this.world.revision + 1 });
    this.quotes.clear();
    await this.save();
    return this.view();
  }

  async tick(seconds: number) {
    const previous = this.world;
    if (Object.values(previous.river.runs).some(run => run.actor === player)) return this.view();
    this.world = advanceClock(previous, previous.elapsed + seconds);
    if (this.world.phase !== previous.phase || (Math.floor(this.world.elapsed / 15) > Math.floor(previous.elapsed / 15))) await this.save();
    return this.view();
  }
}
