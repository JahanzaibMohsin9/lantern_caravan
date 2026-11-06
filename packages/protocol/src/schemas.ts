import { z } from "zod";
import { amount, bargeLookSchema, bargeTrimSchema, haggleOfferSchema, intentSchema, manifestSchema, quoteSchema, type Snapshot } from "./index";

const text = z.string().min(1).max(120);
const time = z.int().nonnegative();
const seconds = z.number().nonnegative();
const strategy = z.enum(["steady", "bold", "festival", "bargain"]);
const mode = z.enum(["campaign", "endless", "live"]);
const phase = z.enum(["preparation", "open", "results"]);
const range = z.enum(["day", "week", "all"]);
const amounts = z.record(z.string(), amount);
const receipt = z.object({ id: text, label: text, url: z.url().optional() });
export const actionStatusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("confirmed"), receipt }),
  z.object({ state: z.enum(["pending", "unknown", "rejected"]), reason: z.string().optional() }),
]);
const activity = z.object({ at: seconds, night: time, line: z.string(), actor: z.string().optional(), receipt: receipt.optional() });
const merchant = z.object({
  band: z.enum(["thriving", "healthy", "tight", "dark"]), stockClosed: z.boolean().optional(), coins: amount, stock: amounts,
  prices: z.record(z.string(), z.object({ buy: amount, sell: amount, label: text, target: amount })),
  suppliedBy: z.array(z.object({ name: text, quantity: amount })).optional(),
  strategy, vote: strategy.optional(), thinking: z.string(), relationship: z.int().min(-5).max(10),
  owned: amount, shareholders: z.array(z.object({ name: text, count: amount })),
  bookValue: amount, sharePrice: amount, dividend: amount, dividendHistory: z.array(amount).max(5),
  offering: z.object({ id: text, kind: z.enum(["rescue", "expansion"]), price: amount, left: amount,
    total: amount, available: amount, ends: seconds }).optional(),
  buyback: z.object({ id: text, price: amount }).optional(),
});
const almanacEntry = z.object({ id: text, name: text, village: text, item: text, detail: z.string() });
const order = z.object({ id: text, name: text, item: text, remaining: amount, quantity: amount, payout: amount,
  boat: z.int().min(0).max(5), personal: z.boolean(), opens: seconds,
  state: z.enum(["upcoming", "open", "filled", "expired"]), wishes: z.array(z.string()), wishAuthors: z.array(z.string()) });
export const snapshotSchema = z.object({
  session_id: text, night_id: text, night: time, nightName: text, mode, seed: time,
  server_time: time, revision: time, phase, elapsed: seconds, duration: seconds,
  coins: amount, cargo: amounts, capacity: amount, upgrades: z.array(text),
  merchants: z.record(z.string(), merchant), orders: z.array(order),
  villages: z.record(z.string(), z.object({ band: merchant.shape.band, coins: amount, stock: amounts,
    prices: z.record(z.string(), z.object({ buy: amount, sell: amount, label: text })), relationship: z.int(), contractsCompleted: time, trusted: z.boolean() })),
  river: z.object({
    reaches: z.array(z.object({ id: text, name: text, danger: z.int().min(0).max(5), boom: z.boolean(), lamps: time })),
    contracts: z.array(z.object({ id: text, stall: text, village: text, item: text, quantity: amount, payout: amount,
      deadline: seconds, mine: z.boolean(), taken: z.boolean(), kind: z.enum(["supply", "escort"]), relief: z.boolean().optional() })),
    myRun: z.object({ id: text, deadline: time, manifest: manifestSchema }).optional(),
    wrecks: z.array(z.object({ id: text, reach: text, name: text, cargo: amounts, open: z.boolean(),
      nightsLeft: z.int().min(0).max(3), claimed: z.boolean() })),
    almanac: z.object({ tonight: almanacEntry.optional(), tomorrow: almanacEntry.optional() }),
    myOrder: z.object({ id: text, item: text, quantity: z.int().min(1).max(12), unitPrice: z.int().min(3).max(20), escrow: amount,
      delivered: z.int().min(0).max(12), waiting: z.int().min(0).max(12),
      hauling: z.array(z.object({ name: text, quantity: z.int().min(1).max(12), eta: seconds })), cancelled: z.boolean(), news: z.string() }).optional(),
    bellOrders: z.int().nonnegative(),
    upriver: z.array(z.object({ actor: text, name: text })),
    bountyFund: amount,
  }),
  barge: z.object({ hold: amount, upgrades: z.array(text), trim: bargeTrimSchema, look: bargeLookSchema, cosmetics: z.array(text) }),
  objective: z.object({ complete: z.boolean(), name: text,
    steps: z.array(z.object({ label: text, count: amount, target: amount, icon: text })) }),
  delivered: amount, crafted: amount, crowdBudget: amount, crowdSold: amount, lifetimeCrafted: amount, lifetimeDividends: amount,
  earned: amount, spent: amount, boatsHelped: amount, rescued: amount, titles: z.array(text),
  saveStatus: z.enum(["saved", "unsaved"]),
  events: z.array(z.object({ id: text, label: text, detail: z.string(), at: seconds })),
  job: z.object({ id: text, readyAt: seconds }).optional(), jobAvailable: z.boolean(),
  activity: z.array(activity), traders: z.array(z.object({ id: text, name: text, lastStop: text.optional() })),
  listings: z.array(z.object({ id: text, stall: text, shares: amount, price: amount, seller: text, mine: z.boolean() })),
  spectator: z.boolean(), pendingActions: z.array(z.object({ id: text, state: z.enum(["pending", "unknown"]) })),
}) satisfies z.ZodType<Snapshot>;

export const historyRowSchema = z.union([
  z.object({ kind: z.literal("stall").optional(), time, night: time, stall: text, coins: amount, price: amount,
    item: text, strategy, dividend: amount, sharePrice: amount.optional() }),
  z.object({ kind: z.literal("village"), time, night: time, village: text, item: text, coins: amount, price: amount, stock: amount }),
  z.object({ kind: z.literal("reach"), time, night: time, reach: text, danger: z.int().min(0).max(5), boom: z.boolean() }),
]);
export const chronicleEntrySchema = activity.extend({ id: text, time });
export const healthSchema = z.object({ version: z.literal(1), content_version: text, rules_version: text, uptime: time });
export const loginSchema = z.object({ displayName: z.string().trim().min(1).max(24) });
export const loginResultSchema = z.object({ credential: z.string().min(1), player: z.object({ id: text, displayName: text }) });

const session = z.object({ session_id: text });
const night = session.extend({ night_id: text });
const room = z.object({ room_id: text });
const sessionInfo = z.object({ sessionId: text, spectator: z.boolean().optional() });
const status = night.extend({ action_id: text });
const history = z.object({ rows: z.array(historyRowSchema) });
const chronicle = z.object({ entries: z.array(chronicleEntrySchema), cursor: text.optional() });

export const contracts = {
  list_profiles: [z.object({}), z.array(z.object({ slot: text, updated: time, night: time.optional(), phase: phase.optional(), mode: mode.optional() }))],
  create_session: [z.object({ slot: text, mode: mode.optional() }), sessionInfo],
  join_room: [room.extend({ spectate: z.boolean().optional() }), sessionInfo],
  get_catalog: [z.object({ content_version: text }), z.object({ version: text, items: z.record(z.string(), z.object({ name: text, price: amount })) })],
  get_snapshot: [session, snapshotSchema],
  get_quote: [night.extend({ intent: intentSchema }), quoteSchema],
  haggle: [night.extend({ offer: haggleOfferSchema }), z.object({ outcome: z.enum(["accept", "counter", "refuse"]),
    quote: quoteSchema.optional(), line: z.string(), retry_after_ms: time })],
  submit_action: [status.extend({ quote_id: text }), actionStatusSchema],
  get_action_status: [status, actionStatusSchema],
  advance_phase: [session.extend({ action_id: text }), snapshotSchema],
  get_chronicle: [room.extend({ cursor: text.optional() }), chronicle],
  get_history: [room.extend({ range }), history],
  get_save_status: [session, z.object({ state: z.enum(["saved", "unsaved"]) })],
} as const;

export const requestEnvelope = z.object({ version: z.int(), request_id: text, method: text, params: z.record(z.string(), z.unknown()).default({}) });
export const responseEnvelope = z.discriminatedUnion("ok", [
  z.object({ version: z.literal(1), request_id: text, ok: z.literal(true), result: z.unknown(), error: z.null() }),
  z.object({ version: z.literal(1), request_id: text.nullable(), ok: z.literal(false), result: z.null(),
    error: z.object({ code: text, message: z.string() }) }),
]);
