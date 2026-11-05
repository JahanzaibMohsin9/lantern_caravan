import { z } from "zod";

export const amount = z.string().regex(/^(0|[1-9]\d*)$/).max(16)
  .refine(value => Number.isSafeInteger(Number(value)));
const quantity = amount.refine(value => Number(value) > 0);
const id = z.string().min(1).max(120);
export const ledgerOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("mint"), asset: id, amount: quantity, to: id, memo: id, source: id.optional() }),
  z.object({ op: z.literal("burn"), asset: id, amount: quantity, from: id, memo: id, sink: id.optional() }),
  z.object({ op: z.literal("transfer"), asset: id, amount: quantity, from: id, to: id, memo: id }),
]);
const units = z.int().min(1).max(20);
const coins = z.int().nonnegative();
const cargoCounts = z.record(id, z.int().min(0).max(20));
export const runReportSchema = z.object({
  run_id: id, seed: z.int().min(0).max(0xffffffff), durationMs: z.int().min(0).max(150_000),
  bought: z.array(z.object({ village_id: id, item_id: id, quantity: units, paid: coins })).max(6),
  soldBack: z.array(z.object({ village_id: id, item_id: id, quantity: units, received: coins })).max(6),
  delivered: cargoCounts, lost: cargoCounts, flaresUsed: z.int().min(0).max(20),
  pirates: z.array(z.object({ reach: id, count: z.int().min(1).max(10),
    roles: z.object({ skiff: z.int().min(0).max(10), raider: z.int().min(0).max(10), gunboat: z.int().min(0).max(10) }).optional() })).max(4),
  boomsBroken: z.array(id).max(4),
  escort: z.object({ id, completed: z.boolean() }).optional(),
  savedBoats: z.array(id).max(5).optional(),
  salvaged: z.array(z.object({ wreck_id: id, item_id: id, quantity: units })).max(12).optional(),
  stops: z.array(z.object({ stop_id: id, choice: id })).max(3).optional(),
  outcome: z.enum(["moored", "towed", "sunk"]), inputLogHash: z.string().max(120),
});
export type RunReport = z.infer<typeof runReportSchema>;
export const bargeTrimSchema = z.enum(["balanced", "runner", "ironclad", "gunner"]);
export const bargeLookSchema = z.object({
  paint: z.enum(["wood", "midnight", "vermilion", "moss", "ivory", "indigo"]),
  lantern: z.enum(["amber", "jade", "rose", "violet"]), prow: z.enum(["none", "heron", "carp"]),
});

export const manifestSchema = z.object({
  look: bargeLookSchema.optional(),
  stopLayout: z.literal("campaign_reach").optional(),
  trim: bargeTrimSchema.optional(),
  id, seed: z.int().nonnegative(), deadline: coins, wallet: coins, hold: units,
  items: z.array(z.object({ village: id, item: id, stock: coins, target: z.int().positive(),
    prices: z.array(z.int().positive()).max(20), coins, discount: z.boolean() })).max(6),
  reaches: z.array(z.object({ id, danger: z.int().min(0).max(5), boom: z.boolean() })).max(4),
  boats: z.array(z.object({ id, name: id, village: id, destination: id.optional(), departs: z.number(), arrives: z.number(), ambient: z.boolean() })),
  contract: z.object({ id, village: id, item: id, quantity: units, payout: coins,
    kind: z.enum(["supply", "escort"]), haul: id.optional(), relief: z.boolean().optional() }).optional(),
  upgrades: z.array(id), bounty: coins, glow: z.number().min(0).max(1),
  limitMs: z.int().min(10_000).max(150_000).optional(),
  wrecks: z.array(z.object({ id, reach: id, at: z.number().min(0).max(1), name: id,
    cargo: z.record(id, z.int().min(1).max(40)) })).max(6).optional(),
});
export type RunManifest = z.infer<typeof manifestSchema>;

export const intentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.enum(["buy", "sell"]), stall_id: id, item_id: id, quantity }),
  z.object({ type: z.literal("craft"), recipe_id: id, quantity }),
  z.object({ type: z.literal("fill_order"), order_id: id, quantity, wish_id: id.optional() }),
  z.object({ type: z.literal("sell_crowd"), item_id: id, quantity }),
  z.object({ type: z.literal("buy_offering"), offering_id: id, shares: quantity }),
  z.object({ type: z.literal("vote_strategy"), stall_id: id, strategy_id: id }),
  z.object({ type: z.literal("buy_upgrade"), upgrade_id: id }),
  z.object({ type: z.literal("start_job") }),
  z.object({ type: z.literal("start_run"), contract_id: id.optional(), escort_id: id.optional(),
    trim: bargeTrimSchema.optional(), barge_plan: z.array(z.object({ village_id: id, item_id: id, quantity })).max(6) }),
  z.object({ type: z.literal("finish_run"), run_id: id, report: runReportSchema }),
  z.object({ type: z.literal("accept_contract"), contract_id: id }),
  z.object({ type: z.literal("buy_barge_upgrade"), upgrade_id: id }),
  z.object({ type: z.literal("buy_barge_cosmetic"), cosmetic_id: id }),
  z.object({ type: z.literal("fit_barge_cosmetic"), cosmetic_id: id }),
  z.object({ type: z.literal("post_bell_order"), item_id: id, quantity: z.int().min(1).max(12), unit_price: z.int().min(3).max(20) }),
  z.object({ type: z.literal("cancel_bell_order"), order_id: id }),
  z.object({ type: z.literal("finish_job"), job_id: id }),
  z.object({ type: z.literal("accept_buyback"), buyback_id: id }),
  z.object({ type: z.literal("list_shares"), stall_id: id, shares: quantity, price_per_share: quantity }),
  z.object({ type: z.enum(["cancel_listing", "buy_listing"]), listing_id: id }),
]);
export const haggleOfferSchema = z.object({
  stall_id: id, item_id: id, side: z.enum(["buy", "sell"]), quantity, price_per_unit: quantity,
});
export const quoteSchema = z.object({
  quote_id: id, intent: intentSchema, effects: z.array(ledgerOpSchema),
  summary: id, expires_at: z.int().nonnegative(),
});
export type LedgerOp = z.infer<typeof ledgerOpSchema>;
export type Intent = z.infer<typeof intentSchema>;
export type HaggleOffer = z.infer<typeof haggleOfferSchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type HaggleResult = { outcome: "accept" | "counter" | "refuse"; quote?: Quote; line: string; retry_after_ms: number };
export type Receipt = { id: string; label: string; url?: string };
export type ActionStatus = { state: "confirmed"; receipt: Receipt }
  | { state: "pending" | "unknown" | "rejected"; reason?: string };
export type Mode = "campaign" | "endless" | "live";
export type CashBand = "thriving" | "healthy" | "tight" | "dark";
export type StrategyId = "steady" | "bold" | "festival" | "bargain";
export type Activity = { at: number; night: number; line: string; actor?: string; receipt?: Receipt };
export type MerchantSnapshot = {
  band: CashBand;
  stockClosed?: boolean;
  coins: string;
  stock: Record<string, string>;
  prices: Record<string, { buy: string; sell: string; label: string; target: string }>;
  strategy: StrategyId; vote?: StrategyId; thinking: string; relationship: number;
  suppliedBy?: { name: string; quantity: string }[];
  owned: string; shareholders: { name: string; count: string }[];
  bookValue: string; sharePrice: string; dividend: string; dividendHistory: string[];
  offering?: { id: string; kind: "rescue" | "expansion"; price: string; left: string; total: string; available: string; ends: number };
  buyback?: { id: string; price: string };
};
export type BellOrderView = { id: string; item: string; quantity: number; unitPrice: number; escrow: string; delivered: number;
  waiting: number; hauling: { name: string; quantity: number; eta: number }[]; cancelled: boolean; news: string };
export type AlmanacEntry = { id: string; name: string; village: string; item: string; detail: string };
export type Snapshot = {
  session_id: string; night_id: string; night: number; nightName: string; mode: Mode; seed: number;
  server_time: number; revision: number; phase: "preparation" | "open" | "results"; elapsed: number; duration: number;
  coins: string; cargo: Record<string, string>; capacity: string; upgrades: string[];
  merchants: Record<string, MerchantSnapshot>;
  villages: Record<string, { band: CashBand; coins: string; stock: Record<string, string>;
    prices: Record<string, { buy: string; sell: string; label: string }>; relationship: number }>;
  river: {
    reaches: { id: string; name: string; danger: number; boom: boolean; lamps: number }[];
    contracts: { id: string; stall: string; village: string; item: string; quantity: string; payout: string;
      deadline: number; mine: boolean; taken: boolean; kind: "supply" | "escort"; relief?: boolean }[];
    myRun?: { id: string; deadline: number; manifest: RunManifest };
    wrecks: { id: string; reach: string; name: string; cargo: Record<string, string>; open: boolean; nightsLeft: number; claimed: boolean }[];
    almanac: { tonight?: AlmanacEntry; tomorrow?: AlmanacEntry };
    myOrder?: BellOrderView;
    bellOrders: number;
    upriver: { actor: string; name: string }[];
    bountyFund: string;
  };
  barge: { hold: string; upgrades: string[]; trim: z.infer<typeof bargeTrimSchema>;
    look: z.infer<typeof bargeLookSchema>; cosmetics: string[] };
  orders: {
    id: string; name: string; item: string; remaining: string; quantity: string; payout: string;
    boat: number; personal: boolean; opens: number; state: "upcoming" | "open" | "filled" | "expired";
    wishes: string[]; wishAuthors: string[];
  }[];
  objective: { complete: boolean; name: string; steps: { label: string; count: string; target: string; icon: string }[] };
  delivered: string; crafted: string; crowdBudget: string; crowdSold: string; lifetimeCrafted: string; lifetimeDividends: string;
  earned: string; spent: string; boatsHelped: string; rescued: string; titles: string[];
  saveStatus: "saved" | "unsaved";
  events: { id: string; label: string; detail: string; at: number }[];
  job?: { id: string; readyAt: number }; jobAvailable: boolean;
  activity: Activity[];
  traders: { id: string; name: string; lastStop?: string }[];
  listings: { id: string; stall: string; shares: string; price: string; seller: string; mine: boolean }[];
  spectator: boolean;
  pendingActions: { id: string; state: "pending" | "unknown" }[];
};
export type SessionInfo = { sessionId: string; spectator?: boolean };
export type CreateSessionReq = { slot: string; mode?: Mode };
export type ProfileSummary = { slot: string; updated: number; night?: number; phase?: Snapshot["phase"]; mode?: Mode };
export type SaveStatus = { state: Snapshot["saveStatus"] };
export type Catalog = { version: string; items: Record<string, { name: string; price: string }> };
export type HistoryRange = "day" | "week" | "all";
export type HistoryRow = { time: number; night: number; stall: string; coins: string; price: string; item: string; strategy: StrategyId; dividend: string; sharePrice?: string };
export type MarketHistory = { rows: HistoryRow[] };
export type ChronicleEntry = Activity & { id: string; time: number };
export type ChroniclePage = { entries: ChronicleEntry[]; cursor?: string };

export interface MarketBackend {
  readonly kind: "local" | "server";
  readonly environmentLabel: string;
  listProfiles(): Promise<ProfileSummary[]>;
  createSession(req: CreateSessionReq): Promise<SessionInfo>;
  joinRoom(roomId: string, opts?: { spectate?: boolean }): Promise<SessionInfo>;
  getCatalog(contentVersion: string): Promise<Catalog>;
  getSnapshot(sessionId: string): Promise<Snapshot>;
  getQuote(sessionId: string, nightId: string, intent: Intent): Promise<Quote>;
  haggle(sessionId: string, nightId: string, offer: HaggleOffer): Promise<HaggleResult>;
  submitAction(sessionId: string, nightId: string, quoteId: string, actionId: string): Promise<ActionStatus>;
  getActionStatus(sessionId: string, nightId: string, actionId: string): Promise<ActionStatus>;
  advancePhase(sessionId: string, actionId: string): Promise<Snapshot>;
  getChronicle(roomId: string, cursor?: string): Promise<ChroniclePage>;
  getHistory(roomId: string, range: HistoryRange): Promise<MarketHistory>;
  getSaveStatus(sessionId: string): Promise<SaveStatus>;
}

export type AuthState = { status: "signed_out" | "signing_in" | "signed_in" | "error";
  player?: { id: string; displayName: string }; detailsUrl?: string; error?: string };
export interface AuthClient {
  getState(): AuthState;
  signIn(): Promise<AuthState>;
  signOut(): Promise<void>;
  getCredential(): Promise<string | null>;
  onChange(cb: (state: AuthState) => void): () => void;
}
export interface IdentityProvider {
  verify(credential: string): Promise<{ playerId: string; displayName: string }>;
  onFirstSeen?(playerId: string): Promise<void>;
}
export type PreparedAction = { actionId: string; roomId: string; nightId: string; actorId: string;
  intent: Intent; effects: LedgerOp[]; expectedRevision: number; kind: "player" | "agent" };
export type SettlementStatus = ActionStatus | { state: "confirmed"; receipt?: Receipt };
export interface SettlementProvider {
  prepare(action: PreparedAction): Promise<void>;
  submit(actionId: string): Promise<void>;
  status(actionId: string): Promise<SettlementStatus>;
  settleBatch?(batch: { batchId: string; roomId: string; nightId: string; effects: LedgerOp[] }): Promise<SettlementStatus>;
}
export type ActionLogEntry = PreparedAction & { status: ActionStatus };
export interface StateStore<WorldState> {
  load(roomId: string): Promise<{ state: WorldState; revision: number } | null>;
  save(roomId: string, state: WorldState, expectedRevision: number): Promise<number>;
  appendActionLog(entry: ActionLogEntry): Promise<void>;
  appendHistory(roomId: string, rows: HistoryRow[]): Promise<void>;
  appendChronicle(roomId: string, entries: ChronicleEntry[]): Promise<void>;
  queryHistory(roomId: string, range: HistoryRange): Promise<HistoryRow[]>;
  queryChronicle(roomId: string, cursor?: string, limit?: number): Promise<ChroniclePage>;
}
