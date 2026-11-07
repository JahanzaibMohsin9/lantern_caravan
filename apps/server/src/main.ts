import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { maxRunLogBytes, haggleOfferSchema, type Intent, type HistoryRange, type IdentityProvider, type SettlementProvider } from "@lantern/protocol";
import { contracts, loginSchema, requestEnvelope } from "@lantern/protocol/schemas";
import { FileStateStore } from "./providers/file";
import { DevIdentityProvider, DevSettlementProvider } from "./providers/dev";
import { catalog, LiveMarket, publicRoom } from "./live";
import { NearChain, operatorKey } from "./near/chain";
import { NearSettlementProvider, RoutedSettlement } from "./near/provider";

const started = Date.now();
const directory = process.env.LANTERN_DATA_DIR ?? fileURLToPath(new URL("../data", import.meta.url));
const store = new FileStateStore<Parameters<ConstructorParameters<typeof LiveMarket>[0]["save"]>[1]>(directory);
await store.init();
for (const [name, values] of [["IDENTITY", ["dev"]], ["SETTLEMENT", ["dev", "near"]], ["STORE", ["file"]]] as const) {
  if (process.env[name] && !(values as readonly string[]).includes(process.env[name]!)) throw new Error(`Unknown ${name} provider.`);
}
const devAuth = await DevIdentityProvider.create(directory);
const auth: IdentityProvider = devAuth;
const dev = new DevSettlementProvider(directory);
let near: NearSettlementProvider | undefined;
let settlement: SettlementProvider = dev;
if (process.env.SETTLEMENT === "near") {
  // Only the public Row settles on chain. Private rooms are separate economies and keep the dev ledger.
  if ((process.env.NEAR_NETWORK ?? "testnet") !== "testnet") throw new Error("NEAR_NETWORK · Only testnet is supported.");
  const root = process.env.NEAR_ACCOUNT_ROOT ?? "lantern-caravan.testnet";
  const operatorId = process.env.NEAR_OPERATOR_ID ?? "operator." + root;
  const chain = new NearChain({ network: "testnet", rpcUrl: process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com",
    contractId: process.env.NEAR_CONTRACT_ID ?? "items." + root, operatorId, key: await operatorKey(operatorId) });
  near = new NearSettlementProvider(chain, { root, players: process.env.NEAR_PLAYER_SUFFIX ?? "players." + root }, directory);
  await near.init();
  settlement = new RoutedSettlement(near, dev, new Set([publicRoom]));
}
const market = new LiveMarket(store, settlement);
await market.load(publicRoom, true);
for (const room of await store.roomIds()) {
  if (room !== publicRoom) await market.load(room);
}
if (near) {
  const chainSync = near;
  // The chain check must not keep the Row offline: if the RPC is unavailable or rate-limited, log it and retry.
  const syncChain = async (attempt = 0): Promise<void> => {
    try {
      const missing = await chainSync.ensureAgents();
      if (missing.length) console.log("NEAR · registering " + missing.length + " agent accounts");
      const synced = await market.serialized(() => market.reconcileChain(publicRoom));
      console.log("NEAR · " + JSON.stringify(synced) + " · " + chainSync.info().contractUrl);
    } catch (error) {
      const wait = Math.min(600, 30 * 2 ** attempt);
      console.error("NEAR · chain sync failed, retrying in " + wait + "s: " + (error instanceof Error ? error.message : String(error)));
      setTimeout(() => void syncChain(attempt + 1), wait * 1000).unref();
    }
  };
  await syncChain();
}
let updating = false;
const ticker = setInterval(() => {
  if (updating) return;
  updating = true;
  void market.serialized(() => market.updateAll()).finally(() => { updating = false; });
}, 450);
ticker.unref();

async function payload(req: IncomingMessage) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maxRunLogBytes + 65536) throw new Error("Request is too large.");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function range(value: unknown): HistoryRange { return value === "day" || value === "week" ? value : "all"; }
const id = z.string().min(1).max(120);
const messageOf = (error: unknown) => error instanceof Error && !(error instanceof z.ZodError) ? error.message : "Check the request and try again.";

function errorCode(message: string) {
  if (/^RIVER_[A-Z_]+/.test(message)) return message.split(/[ ·]/)[0]!;
  const errors = [
    [/^AUTH_REQUIRED$/, "AUTH_REQUIRED"], [/UNSUPPORTED_VERSION/, "UNSUPPORTED_VERSION"], [/ACTION_CONFLICT/, "ACTION_CONFLICT"],
    [/confirming/, "ACTION_PENDING"], [/quote expired/i, "QUOTE_EXPIRED"], [/market changed/i, "PRICE_CHANGED"],
    [/already has those lanterns/, "ORDER_FILLED"], [/another offer/, "HAGGLE_COOLDOWN"],
    [/stall is short on coins/, "MERCHANT_CANNOT_AFFORD"], [/short on coins/, "INSUFFICIENT_FUNDS"], [/low on stock/, "OUT_OF_STOCK"], [/cart is full/, "CARGO_FULL"],
    [/more .*lantern|need paper|missing ingredients/, "MISSING_INGREDIENTS"], [/stall is closed/, "STALL_CLOSED"],
    [/unlocks/, "RECIPE_LOCKED"], [/offering has closed/, "OFFERING_CLOSED"], [/fewer shares/, "SHARE_LIMIT"],
    [/shares in this stall to vote/, "NOT_SHAREHOLDER"], [/market is closed|night has closed/, "NIGHT_CLOSED"],
    [/preparation/, "WRONG_PHASE"],
  ] as const;
  return errors.find(([pattern]) => pattern.test(message))?.[1] ?? "INVALID_REQUEST";
}

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
  let requestId: string | null = null;
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/v1/health") {
      send(res, 200, { version: 1, content_version: "1", rules_version: "1", uptime: Math.floor((Date.now() - started) / 1000) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/chain/status") {
      send(res, 200, near ? near.info() : { enabled: false });
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/v1/public/")) {
      const room = publicRoom;
      const data = await (async () => {
        if (url.pathname === "/v1/public/snapshot") return market.serialized(() => market.snapshot(room));
        if (url.pathname === "/v1/public/history") return market.historyPage(room, range(url.searchParams.get("range")));
        if (url.pathname === "/v1/public/chronicle") return market.chroniclePage(room, url.searchParams.get("cursor") ?? undefined);
        throw new Error("Unknown public endpoint.");
      })();
      send(res, 200, data);
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/auth/dev") {
      const body = loginSchema.parse(await payload(req));
      send(res, 200, devAuth.issue(body.displayName));
      return;
    }
    if (req.method !== "POST" || url.pathname !== "/v1/rpc") { send(res, 404, { error: "Not found" }); return; }

    const call = requestEnvelope.parse(await payload(req));
    requestId = call.request_id;
    if (call.version !== 1) throw new Error("UNSUPPORTED_VERSION");
    const credential = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    const identity = credential ? await auth.verify(credential) : undefined;
    const watch = call.method === "join_room" && call.params.spectate === true;
    if (!identity && !watch) throw new Error("AUTH_REQUIRED");
    const actor = identity ? "p:" + identity.playerId : "";
    const p = call.params;
    const contract = Object.hasOwn(contracts, call.method) ? contracts[call.method as keyof typeof contracts] : undefined;
    if (!contract) throw new Error("Unknown market method.");
    if (call.method !== "get_quote") contract[0].parse(p);
    const room = () => id.parse(p.session_id ?? p.room_id);
    const night = () => id.parse(p.night_id);
    const result = await market.serialized(async () => {
      switch (call.method) {
        case "list_profiles": return [];
        case "create_session": return market.createPrivate(identity!);
        case "join_room": return market.join(room(), identity, watch);
        case "get_catalog": return catalog;
        case "get_snapshot":
        case "advance_phase": return market.snapshot(room(), actor);
        case "get_quote": return market.getQuote(room(), actor, night(), p.intent as Intent);
        case "haggle": return market.bargain(room(), actor, night(), haggleOfferSchema.parse(p.offer));
        case "submit_action": return market.submit(room(), actor, night(), id.parse(p.quote_id), id.parse(p.action_id));
        case "get_action_status": return market.actionStatus(room(), actor, night(), id.parse(p.action_id));
        case "get_chronicle": return market.chroniclePage(room(), z.string().optional().parse(p.cursor));
        case "get_history": return market.historyPage(room(), range(p.range));
        case "get_save_status": return { state: "saved" };
        default: throw new Error("Unknown market method.");
      }
    });
    send(res, 200, { version: 1, request_id: requestId, ok: true, result, error: null });
  } catch (error) {
    const message = messageOf(error);
    const code = errorCode(message);
    send(res, code === "AUTH_REQUIRED" ? 401 : 400,
      { version: 1, request_id: requestId, ok: false, result: null, error: { code, message: code === "AUTH_REQUIRED" ? "Sign in to trade." : message } });
  }
});

server.listen(Number(process.env.PORT) || 4318, process.env.HOST ?? "127.0.0.1", () => {
  console.log(`Lantern Row live server · http://${process.env.HOST ?? "127.0.0.1"}:${Number(process.env.PORT) || 4318}`);
});
