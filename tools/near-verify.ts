/**
 * Read-only check that the NEAR items contract holds exactly the live Row's balances.
 *
 * It loads the public room from the server's data folder, undoes the agent activity that hasn't been flushed
 * to the chain yet, and compares every holder's balance with the contract. It never signs or sends anything,
 * so it is safe to run next to the live server.
 *
 *   npm run near:verify -- --data /var/lib/lantern-caravan
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import { decodeWorld } from "@lantern/game-core/codec";
import { publicRoom } from "../apps/server/src/live";
import { NearChain } from "../apps/server/src/near/chain";
import { compareChain, settledLedger, tokenIds } from "../apps/server/src/near/provider";
import { FileStateStore, readJson } from "../apps/server/src/providers/file";

const { values } = parseArgs({ options: { data: { type: "string", default: process.env.LANTERN_DATA_DIR ?? "apps/server/data" },
  room: { type: "string", default: publicRoom } } });
const root = process.env.NEAR_ACCOUNT_ROOT ?? "lantern-caravan.testnet";
const chain = new NearChain({ network: "testnet", rpcUrl: process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com",
  contractId: process.env.NEAR_CONTRACT_ID ?? "items." + root, operatorId: process.env.NEAR_OPERATOR_ID ?? "operator." + root });

type Stored = { world: unknown; agentEffects?: Parameters<typeof settledLedger>[1]; reservation?: unknown };
const store = new FileStateStore<Stored>(values.data!);
const row = await store.load(values.room!);
if (!row) throw new Error("No room " + values.room + " in " + values.data + ".");
const world = decodeWorld(row.state.world);
const outbox = await readJson<{ queue: unknown[]; holders: string[] }>(join(values.data!, "near-settlement.json"));
const pending = row.state.agentEffects ?? [];
const result = await compareChain(chain, { root, players: process.env.NEAR_PLAYER_SUFFIX ?? "players." + root },
  settledLedger(world.ledger, pending), outbox?.holders ?? []);
const report = {
  room: values.room, night: world.night, phase: world.phase, contract: chain.contractId,
  holders: result.holders.length, tokens: tokenIds.length, unflushedAgentOps: pending.length,
  queuedTransactions: outbox?.queue.length ?? 0, playerActionInFlight: !!row.state.reservation,
  matches: result.differences.length === 0, differences: result.differences,
};
console.log(JSON.stringify(report, null, 2));
if (!report.matches && !report.queuedTransactions && !report.playerActionInFlight) process.exitCode = 1;
