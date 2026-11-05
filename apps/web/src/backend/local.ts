import { advanceClock, commit, createWorld, quote, snapshotFor, type World } from "@lantern/game-core";
import { haggle as bargain } from "@lantern/game-core/haggle";
import { haggleOfferSchema, type ActionStatus, type CreateSessionReq, type HaggleOffer, type Intent,
  type MarketBackend, type Quote, type Snapshot } from "@lantern/protocol";
import { read, unpack, write } from "./saves";

export class LocalBackend implements MarketBackend {
  readonly kind = "local";
  readonly environmentLabel = "Local";
  private world = createWorld();
  private slot = "first-light";
  private quotes = new Map<string, { deal: Quote; revision: number }>();
  private actions = new Map<string, { quoteId: string; status: ActionStatus }>();
  private phases = new Set<string>();
  private saveStatus: Snapshot["saveStatus"] = "saved";
  private saveQueue = Promise.resolve();

  async listProfiles() {
    const row = await read(this.slot);
    return row ? [{ slot: this.slot, updated: row.current.updated }] : [];
  }

  async createSession(req: CreateSessionReq) {
    this.slot = req.slot;
    this.world = createWorld();
    this.quotes.clear();
    this.actions.clear();
    this.phases.clear();
    await this.save();
    return { sessionId: this.slot };
  }

  async restore() {
    const row = await read(this.slot);
    if (!row) return false;
    try {
      this.world = unpack(row.current);
    } catch (error) {
      if (!row.backup) throw error;
      this.world = unpack(row.backup);
      await this.save();
    }
    return true;
  }

  private save() {
    const world = this.world;
    const slot = this.slot;
    this.saveQueue = this.saveQueue.then(async () => {
      try {
        await write(slot, world);
        this.saveStatus = "saved";
      } catch {
        this.saveStatus = "unsaved";
      }
    });
    return this.saveQueue;
  }

  private check(sessionId: string, nightId?: string) {
    if (sessionId !== this.slot || (nightId && nightId !== "first-light")) {
      throw new Error("This quote belongs to a different market.");
    }
  }

  view(): Snapshot {
    return { ...snapshotFor(this.world, this.slot), saveStatus: this.saveStatus };
  }

  async getSnapshot(sessionId: string) {
    this.check(sessionId);
    return this.view();
  }

  async getSaveStatus(sessionId: string) {
    this.check(sessionId);
    return { state: this.saveStatus };
  }

  private remember(deal: Quote) {
    const now = Math.floor(this.world.elapsed * 1000);
    for (const [id, entry] of this.quotes) {
      if (entry.deal.expires_at <= now || entry.revision !== this.world.revision) this.quotes.delete(id);
    }
    this.quotes.set(deal.quote_id, { deal: structuredClone(deal), revision: this.world.revision });
    return deal;
  }

  async getQuote(sessionId: string, nightId: string, intent: Intent) {
    this.check(sessionId, nightId);
    return this.remember(quote(this.world, intent, crypto.randomUUID(), Math.floor(this.world.elapsed * 1000)));
  }

  async haggle(sessionId: string, nightId: string, raw: HaggleOffer) {
    this.check(sessionId, nightId);
    const outcome = bargain(this.world, haggleOfferSchema.parse(raw), crypto.randomUUID(), Math.floor(this.world.elapsed * 1000));
    this.world = outcome.state;
    if (outcome.result.quote) this.remember(outcome.result.quote);
    await this.save();
    return outcome.result;
  }

  async submitAction(sessionId: string, nightId: string, quoteId: string, actionId: string) {
    this.check(sessionId, nightId);
    const previous = this.actions.get(actionId);
    if (previous) {
      if (previous.quoteId !== quoteId) throw new Error("That action ID already belongs to another quote.");
      return previous.status;
    }
    const entry = this.quotes.get(quoteId);
    if (!entry || entry.revision !== this.world.revision) throw new Error("The market changed. Ask for a fresh quote.");
    this.world = commit(this.world, entry.deal, Math.floor(this.world.elapsed * 1000));
    const status: ActionStatus = { state: "confirmed", receipt: { id: actionId, label: "Local receipt" } };
    this.actions.set(actionId, { quoteId, status });
    await this.save();
    return status;
  }

  async getActionStatus(sessionId: string, nightId: string, actionId: string) {
    this.check(sessionId, nightId);
    const entry = this.actions.get(actionId);
    if (!entry) throw new Error("That receipt isn’t available.");
    return entry.status;
  }

  async advancePhase(sessionId: string, actionId: string) {
    this.check(sessionId);
    if (this.phases.has(actionId)) return this.view();
    if (this.world.phase === "preparation") {
      this.world = { ...this.world, phase: "open", revision: this.world.revision + 1 };
    } else if (this.world.phase === "open" && this.world.delivered >= 3) {
      this.world = { ...this.world, phase: "results", revision: this.world.revision + 1 };
    } else {
      throw new Error("Deliver three lanterns to close the night early.");
    }
    this.phases.add(actionId);
    await this.save();
    return this.view();
  }

  async tick(seconds: number) {
    const previous = this.world;
    this.world = advanceClock(previous, previous.elapsed + seconds);
    if (this.world.phase !== previous.phase) await this.save();
    return this.view();
  }
}
