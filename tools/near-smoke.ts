/**
 * Runs the live market against the real testnet items contract: registers the agents, mints the genesis
 * market, lets the agents trade, settles one player purchase, checks every balance against the game, then
 * (unless --keep) reconciles to an empty ledger so the contract is clean for the hosted server's own genesis.
 *
 *   npm run near:smoke            # testnet only; signs as operator.<root> from its legacy-keychain file
 *   npm run near:smoke -- --keep  # leave the smoke market's balances on chain
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { LiveMarket, publicRoom } from "../apps/server/src/live";
import { NearChain, operatorKey } from "../apps/server/src/near/chain";
import { NearSettlementProvider, RoutedSettlement } from "../apps/server/src/near/provider";
import { DevSettlementProvider } from "../apps/server/src/providers/dev";
import { FileStateStore } from "../apps/server/src/providers/file";

const { values } = parseArgs({ options: { keep: { type: "boolean", default: false } } });
process.env.LANTERN_PREP_SECONDS = "1";
const root = process.env.NEAR_ACCOUNT_ROOT ?? "lantern-caravan.testnet";
const operatorId = process.env.NEAR_OPERATOR_ID ?? "operator." + root;
const chain = new NearChain({ network: "testnet", rpcUrl: process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org",
  contractId: process.env.NEAR_CONTRACT_ID ?? "items." + root, operatorId, key: await operatorKey(operatorId) });
const dir = await mkdtemp(join(tmpdir(), "lantern-near-smoke-"));
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const step = (label: string, value?: unknown) => console.log("· " + label + (value === undefined ? "" : " " + JSON.stringify(value)));

const near = new NearSettlementProvider(chain, { root, players: "players." + root }, dir);
await near.init();
try {
  const store = new FileStateStore<Parameters<ConstructorParameters<typeof LiveMarket>[0]["save"]>[1]>(dir);
  await store.init();
  const market = new LiveMarket(store, new RoutedSettlement(near, new DevSettlementProvider(dir), new Set([publicRoom])));
  await market.load(publicRoom, true);
  step("agents to register", await near.ensureAgents());
  await near.idle();
  step("genesis", await market.serialized(() => market.reconcileChain(publicRoom)));
  await market.join(publicRoom, { playerId: "smoke-test", displayName: "Smoke test" }, false);
  let view = await market.snapshot(publicRoom, "p:smoke-test");
  for (let i = 0; i < 40 && view.phase !== "open"; i++) { await sleep(500); view = await market.snapshot(publicRoom, "p:smoke-test"); }
  // Let the agents trade for a couple of ticks, so the trade has a flush of agent activity in front of it.
  await sleep(22000);
  view = await market.snapshot(publicRoom, "p:smoke-test");
  step("night open at", view.elapsed);
  const deal = await market.serialized(() => market.getQuote(publicRoom, "p:smoke-test", view.night_id,
    { type: "buy", stall_id: "paper_mill", item_id: "paper", quantity: "1" }));
  let status = await market.serialized(() => market.submit(publicRoom, "p:smoke-test", view.night_id, deal.quote_id, "smoke-buy"));
  for (let i = 0; i < 120 && status.state !== "confirmed" && status.state !== "rejected"; i++) {
    await sleep(500);
    await market.serialized(() => market.snapshot(publicRoom, "p:smoke-test"));
    status = await market.actionStatus(publicRoom, "p:smoke-test", view.night_id, "smoke-buy");
  }
  step("player purchase", status);
  await near.idle();
  const world = (await market.load(publicRoom)).world, pending = (await market.load(publicRoom)).agentEffects.length;
  if (pending) step("agent changes since the trade, settled next flush", pending);
  else step("balance check", await near.verify(world.ledger));
  step("chain status", near.info());
  if (!values.keep) step("clean-up", await near.reconcile(publicRoom, {}));
  if (status.state !== "confirmed") process.exitCode = 1;
} finally {
  await near.close();
  await rm(dir, { recursive: true, force: true });
}
