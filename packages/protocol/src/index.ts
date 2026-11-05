import { z } from "zod";

export const amount = z.string().regex(/^(0|[1-9]\d*)$/)
  .refine(value => Number.isSafeInteger(Number(value)));
const quantity = amount.refine(value => Number(value) > 0);
const id = z.string().min(1);
export const ledgerOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("mint"), asset: id, amount: quantity, to: id, memo: id }),
  z.object({ op: z.literal("burn"), asset: id, amount: quantity, from: id, memo: id }),
  z.object({ op: z.literal("transfer"), asset: id, amount: quantity, from: id, to: id, memo: id }),
]);
export const intentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.enum(["buy", "sell"]), stall_id: id, item_id: id, quantity }),
  z.object({ type: z.literal("craft"), recipe_id: id, quantity }),
  z.object({ type: z.literal("fill_order"), order_id: id, quantity, wish_id: id.optional() }),
  z.object({ type: z.literal("sell_crowd"), item_id: id, quantity }),
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
export type ActionStatus = { state: "confirmed"; receipt: { id: string; label: string } };

export type CashBand = "thriving" | "healthy" | "tight" | "dark";
export type Snapshot = {
  session_id: string;
  night_id: string;
  revision: number;
  phase: "preparation" | "open" | "results";
  elapsed: number;
  coins: string;
  cargo: Record<string, string>;
  merchants: Record<string, {
    band: CashBand;
    stock: Record<string, string>;
    prices: Record<string, { buy: string; sell: string; label: string; target: string }>;
  }>;
  orders: {
    id: string; name: string; remaining: string; quantity: string; payout: string;
    boat: number; personal: boolean; opens: number; state: "upcoming" | "open" | "filled" | "expired";
    wishes: string[];
  }[];
  delivered: string;
  crafted: string;
  crowdBudget: string;
  crowdSold: string;
  saveStatus: "saved" | "unsaved";
};
export type SessionInfo = { sessionId: string };
export type CreateSessionReq = { slot: string };
export type ProfileSummary = { slot: string; updated: number };
export type SaveStatus = { state: Snapshot["saveStatus"] };

// Methods used by the local First Light client.
export interface MarketBackend {
  readonly kind: "local" | "server";
  readonly environmentLabel: string;
  listProfiles(): Promise<ProfileSummary[]>;
  createSession(req: CreateSessionReq): Promise<SessionInfo>;
  getSnapshot(sessionId: string): Promise<Snapshot>;
  getQuote(sessionId: string, nightId: string, intent: Intent): Promise<Quote>;
  haggle(sessionId: string, nightId: string, offer: HaggleOffer): Promise<HaggleResult>;
  submitAction(sessionId: string, nightId: string, quoteId: string, actionId: string): Promise<ActionStatus>;
  getActionStatus(sessionId: string, nightId: string, actionId: string): Promise<ActionStatus>;
  advancePhase(sessionId: string, actionId: string): Promise<Snapshot>;
  getSaveStatus(sessionId: string): Promise<SaveStatus>;
}
