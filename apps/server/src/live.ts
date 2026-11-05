import { randomUUID } from "node:crypto";
import { items } from "@lantern/content";
import { addActivity, addTrader, advanceClock, commitFor, createWorld, isRiverIntent, newNight, nightId, nowAt, openNight,
  quoteFor, recordAction, snapshotFor, validateQuote, type World } from "@lantern/game-core";
import { decodeWorld, encodeWorld } from "@lantern/game-core/codec";
import { haggle } from "@lantern/game-core/haggle";
import { netEffects } from "@lantern/game-core/net-effects";
import type { ActionStatus, HaggleOffer, HistoryRange, Intent, LedgerOp, PreparedAction,
  Quote, SettlementProvider, StateStore } from "@lantern/protocol";

// River runs are timed in wall-clock milliseconds; market actions use the room clock.
const clockFor = (world: World, intent: Intent) => isRiverIntent(intent) ? Date.now() : nowAt(world);

type Reservation = { prepared: PreparedAction; deal: Quote; at: number; requestId: string; status: ActionStatus };
type ReceiptEntry = { actor: string; quoteId: string; night: string; status: ActionStatus };
type Quoted = { actor: string; night: string; deal: Quote; baseline: LedgerOp[] };
type RoomData = {
  phaseStarted: number; world: unknown; seats: string[]; reservation?: Reservation;
  receipts: Record<string, ReceiptEntry>; agentEffects: LedgerOp[];
  seen?: Record<string, number>; waiting?: { actor: string; name: string }[];
};
type Room = Omit<RoomData, "world"> & {
  id: string; world: World; revision: number; quotes: Map<string, Quoted>;
  seen: Record<string, number>; waiting: { actor: string; name: string }[];
};

const shortError = (error: unknown) => error instanceof Error ? error.message : "The market is temporarily unavailable.";
export const publicRoom = "the-row";

function coalesce(effects: LedgerOp[]) {
  const delta: Record<string, Record<string, number>> = {};
  const add = (account: string, asset: string, amount: number) => {
    const wallet = delta[account] ??= {};
    wallet[asset] = (wallet[asset] ?? 0) + amount;
  };
  for (const effect of effects) {
    const amount = Number(effect.amount);
    if (effect.op !== "mint") add(effect.from, effect.asset, -amount);
    if (effect.op !== "burn") add(effect.to, effect.asset, amount);
  }
  return netEffects({}, delta);
}

export class LiveMarket {
  private rooms = new Map<string, Room>();
  private queue = Promise.resolve();
  private speed = Math.max(1, Math.min(300, Number(process.env.LANTERN_TIME_SCALE) || 1));
  private prep = Math.max(1, Number(process.env.LANTERN_PREP_SECONDS) || 30);

  constructor(private readonly store: StateStore<RoomData>, private readonly settlement: SettlementProvider) {}

  serialized<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.then(() => {}, () => {});
    return result;
  }

  private async persist(room: Room) {
    const { id, world, revision, phaseStarted, seats, reservation, receipts, agentEffects, seen, waiting } = room;
    room.revision = await this.store.save(id, {
      world: encodeWorld(world), phaseStarted, seats, reservation, receipts, agentEffects, seen, waiting,
    }, revision);
  }

  async load(id: string, create = false): Promise<Room> {
    const existing = this.rooms.get(id);
    if (existing) return existing;
    const stored = await this.store.load(id);
    if (!stored && !create) throw new Error("That room code wasn’t found.");
    const room: Room = stored ? { ...stored.state, id, world: decodeWorld(stored.state.world), revision: stored.revision,
      quotes: new Map(), seen: stored.state.seen ?? {}, waiting: stored.state.waiting ?? [] }
      : { id, world: createWorld("live", 42), revision: 0, phaseStarted: Date.now(), quotes: new Map(), seats: [],
        receipts: {}, agentEffects: [], seen: {}, waiting: [] };
    if (!stored) await this.persist(room);
    this.rooms.set(id, room);
    return room;
  }

  async join(id: string, identity: { playerId: string; displayName: string } | undefined, watch: boolean) {
    const room = await this.load(id);
    await this.update(room);
    const actor = identity ? "p:" + identity.playerId : "";
    if (watch || !identity) return { sessionId: room.id, spectator: true };
    room.seen[actor] = Date.now();
    if (!room.seats.includes(actor)) {
      if (room.reservation || room.seats.length >= 4) {
        if (!room.waiting.some(entry => entry.actor === actor)) room.waiting.push({ actor, name: identity.displayName });
      } else {
        const before = room.world;
        this.seat(room, actor, identity.displayName);
        await this.chronicle(room, before, Date.now());
      }
      await this.persist(room);
    }
    return { sessionId: room.id, spectator: !room.seats.includes(actor) };
  }

  private seat(room: Room, actor: string, name: string) {
    const before = room.world;
    room.world = addTrader(before, actor, name);
    room.seats.push(actor);
    if (room.world !== before) room.world = addActivity(room.world, `${name} arrived at the Row.`);
  }

  async createPrivate(identity: { playerId: string; displayName: string }) {
    const id = randomUUID().replace(/-/g, "").slice(0, 8);
    await this.load(id, true);
    return this.join(id, identity, false);
  }

  private async history(room: Room, time: number) {
    const view = snapshotFor(room.world, room.id, "", time);
    await this.store.appendHistory(room.id, Object.entries(view.merchants).flatMap(([stall, market]) =>
      Object.entries(market.prices).map(([item, hint]) => ({ stall, item, coins: market.coins, price: hint.buy,
        strategy: market.strategy, time, night: view.night, dividend: market.dividendHistory.at(-1) ?? "0", sharePrice: market.sharePrice }))));
  }

  private async chronicle(room: Room, before: World, time: number) {
    const entries = room.world.activity.filter(entry => !before.activity.includes(entry) && !entry.receipt);
    await this.store.appendChronicle(room.id, entries.map(entry => ({ ...entry, id: randomUUID(), time })));
  }

  async updateAll() {
    const time = Date.now();
    for (const room of this.rooms.values()) {
      try { await this.update(room, time); } catch (error) { console.error(room.id, shortError(error)); }
    }
  }

  private async resolve(room: Room) {
    const reservation = room.reservation;
    if (!reservation) return;
    const { prepared, requestId, deal, at } = reservation;
    let status: ActionStatus;
    try {
      await this.settlement.prepare(prepared);
      await this.settlement.submit(prepared.actionId);
      if (process.env.DEV_SETTLE_DUPLICATE === "1") await this.settlement.submit(prepared.actionId);
      const reply = await this.settlement.status(prepared.actionId);
      status = reply.state === "confirmed" ? { state: "confirmed", receipt: reply.receipt ?? { id: requestId, label: "Confirmed" } } : reply;
    } catch {
      status = { state: "unknown" };
    }
    const entry = { actor: prepared.actorId, quoteId: deal.quote_id, night: prepared.nightId, status };
    if (status.state === "pending" || status.state === "unknown") {
      if (reservation.status.state !== status.state) {
        reservation.status = status;
        room.receipts[requestId] = entry;
        await this.persist(room);
      }
      return;
    }
    const before = room.world;
    const beforeReceipt = room.receipts[requestId]!;
    if (status.state === "confirmed") {
      room.world = recordAction(commitFor(room.world, prepared.actorId, deal, at), prepared.actorId, deal.summary, status.receipt);
    }
    room.receipts[requestId] = entry;
    delete room.reservation;
    try { await this.persist(room); }
    catch {
      room.world = before;
      room.reservation = reservation;
      room.receipts[requestId] = beforeReceipt;
      return;
    }
    try {
      await this.store.appendActionLog({ ...prepared, status });
      await this.chronicle(room, before, Date.now());
    } catch (error) { console.error("Action settled, journal append failed", shortError(error)); }
  }

  async update(room: Room, time = Date.now()) {
    if (room.reservation) {
      await this.resolve(room);
      if (room.reservation) return;
    }
    const before = room.world;
    const seconds = (time - room.phaseStarted) / 1000 * this.speed;
    if (before.phase === "preparation" && seconds >= this.prep) {
      room.world = openNight(before);
      room.phaseStarted = time;
    } else if (before.phase === "open") {
      room.world = advanceClock(before, seconds);
      if (room.world.phase === "results") room.phaseStarted = time;
    } else if (before.phase === "results" && seconds >= 30) {
      room.world = newNight(before);
      room.phaseStarted = time;
      room.quotes.clear();
      // Carry only recent action IDs. Pending actions always resolve before a new night.
      room.receipts = Object.fromEntries(Object.entries(room.receipts).filter(([, value]) => value.night === nightId(before)));
      const recent = (actor: string) => time - (room.seen[actor] ?? 0) < 45000;
      room.seats = room.seats.filter(recent);
      room.waiting = room.waiting.filter(entry => recent(entry.actor) && !room.seats.includes(entry.actor));
      for (const entry of room.waiting.splice(0, 4 - room.seats.length)) this.seat(room, entry.actor, entry.name);
    }
    if (before === room.world || (before.revision === room.world.revision && before.tickAt === room.world.tickAt)) return;
    const delta = netEffects(before.ledger, room.world.ledger);
    room.agentEffects.push(...delta);
    if (room.world.phase === "results" && before.phase !== "results") {
      const batch = { roomId: room.id, nightId: nightId(room.world), batchId: room.id + "-" + nightId(room.world), effects: coalesce(room.agentEffects) };
      await this.settlement.settleBatch?.(batch);
      room.agentEffects = [];
    }
    await this.persist(room);
    await this.chronicle(room, before, time);
    if (before.tickAt !== room.world.tickAt || before.phase !== room.world.phase) await this.history(room, time);
  }

  async snapshot(roomId: string, actor = "") {
    const room = await this.load(roomId);
    if (actor && (room.seats.includes(actor) || room.waiting.some(entry => entry.actor === actor))) room.seen[actor] = Date.now();
    await this.update(room);
    const view = snapshotFor(room.world, room.id, room.seats.includes(actor) ? actor : "", Date.now());
    const reserved = room.reservation;
    const pendingActions: typeof view.pendingActions = reserved && reserved.prepared.actorId === actor
      ? [{ id: reserved.requestId.slice(actor.length + 1), state: reserved.status.state === "unknown" ? "unknown" : "pending" }] : [];
    return { ...view, spectator: !room.seats.includes(actor), pendingActions };
  }

  private check(room: Room, actor: string, night: string) {
    if (!room.seats.includes(actor)) throw new Error("Join an open trader seat first.");
    if (nightId(room.world) !== night) throw new Error("That night has closed.");
    if (room.reservation) throw new Error("A trade is confirming. Try again shortly.");
  }

  private remember(room: Room, actor: string, deal: Quote, baseline = deal.effects) {
    for (const [id, entry] of room.quotes) {
      if (entry.deal.expires_at <= clockFor(room.world, entry.deal.intent)) room.quotes.delete(id);
    }
    if (room.quotes.size >= 1000) room.quotes.delete(room.quotes.keys().next().value!);
    room.quotes.set(deal.quote_id, { actor, night: nightId(room.world), deal, baseline });
    return deal;
  }

  async getQuote(roomId: string, actor: string, night: string, intent: Intent) {
    const room = await this.load(roomId);
    await this.update(room);
    this.check(room, actor, night);
    return this.remember(room, actor, quoteFor(room.world, actor, intent, randomUUID(), clockFor(room.world, intent)));
  }

  async bargain(roomId: string, actor: string, night: string, offer: HaggleOffer) {
    const room = await this.load(roomId);
    await this.update(room);
    this.check(room, actor, night);
    const now = nowAt(room.world);
    const { state, result } = haggle(room.world, offer, randomUUID(), now, actor);
    room.world = state;
    if (result.quote) this.remember(room, actor, result.quote, quoteFor(state, actor, result.quote.intent, result.quote.quote_id, now).effects);
    await this.persist(room);
    return result;
  }

  async submit(roomId: string, actor: string, night: string, quoteId: string, requestId: string) {
    const room = await this.load(roomId);
    await this.update(room);
    const key = actor + "/" + requestId;
    const prior = room.receipts[key];
    if (prior) {
      if (prior.quoteId !== quoteId || prior.night !== night) throw new Error("ACTION_CONFLICT");
      return prior.status;
    }
    this.check(room, actor, night);
    const entry = room.quotes.get(quoteId);
    if (!entry || entry.actor !== actor || entry.night !== night) throw new Error("Ask for a fresh quote.");
    const at = clockFor(room.world, entry.deal.intent);
    validateQuote(room.world, actor, entry.deal, entry.baseline, at);
    const prepared: PreparedAction = { actionId: room.id + "/" + key, roomId: room.id, nightId: night, actorId: actor,
      intent: entry.deal.intent, effects: entry.deal.effects, expectedRevision: room.world.revision, kind: "player" };
    const status = { state: "pending" } as const;
    room.reservation = { requestId: key, prepared, deal: entry.deal, at, status };
    room.receipts[key] = { actor, quoteId, night, status };
    room.quotes.delete(quoteId);
    try { await this.persist(room); } catch (error) {
      delete room.reservation;
      delete room.receipts[key];
      room.quotes.set(quoteId, entry);
      throw error;
    }
    await this.resolve(room);
    return room.receipts[key]!.status;
  }

  async actionStatus(roomId: string, actor: string, night: string, requestId: string) {
    const room = await this.load(roomId);
    await this.update(room);
    const entry = room.receipts[actor + "/" + requestId];
    if (!entry || entry.night !== night) throw new Error("That receipt isn’t available.");
    return entry.status;
  }

  async historyPage(room: string, range: HistoryRange) {
    await this.load(room);
    return { rows: await this.store.queryHistory(room, range) };
  }

  async chroniclePage(room: string, cursor?: string) {
    await this.load(room);
    return this.store.queryChronicle(room, cursor);
  }
}

export const catalog = { version: "1", items: Object.fromEntries(Object.entries(items).map(([id, item]) =>
  [id, { name: item.name, price: String(item.price) }])) };
