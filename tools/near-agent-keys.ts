/**
 * Gives each merchant account its own function-call key, so the merchant signs its side of every trade itself.
 *
 * The key can call only `agent_settle` on the items contract, which moves only that merchant's own balances, and
 * attaches no deposit. The server signs NEP-366 delegate actions with it and the operator relays them, paying the gas.
 * Each merchant's full-access key (in the legacy keychain, `~/.near-credentials/testnet/<account>.json`) adds the
 * key once; the new private key is saved beside it as `<account>.agent.json` and never printed. Run again to skip
 * merchants that already have one. `--env <file>` also writes the `NEAR_AGENT_KEYS=...` line for a server.
 *
 *   npm run near:agent-keys
 *   npm run near:agent-keys -- --env /path/to/agent-keys.env
 *   npm run near:agent-keys -- --check   # signs a call that the contract must refuse, for every merchant
 */
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Account, JsonRpcProvider, KeyPair, type KeyPairString } from "near-api-js";
import { merchantAccounts } from "../apps/server/src/near/accounts";
import { agentKeys, NearChain, operatorKey } from "../apps/server/src/near/chain";

const { values } = parseArgs({ options: { env: { type: "string" }, check: { type: "boolean", default: false } } });
const root = process.env.NEAR_ACCOUNT_ROOT ?? "lantern-caravan.testnet";
const contractId = process.env.NEAR_CONTRACT_ID ?? "items." + root;
const operatorId = process.env.NEAR_OPERATOR_ID ?? "operator." + root;
const rpcUrl = process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
const dir = join(process.env.NEAR_CREDENTIALS_DIR ?? join(homedir(), ".near-credentials"), "testnet");
const provider = new JsonRpcProvider({ url: rpcUrl });
const merchants = merchantAccounts({ root, players: "players." + root });

type KeyView = { public_key: string; access_key: { permission: "FullAccess" | { FunctionCall: { receiver_id: string; method_names: string[] } } } };
const keys = async (account: string) => (await provider.viewAccessKeyList({ accountId: account })).keys as unknown as KeyView[];

for (const account of merchants) {
  const file = join(dir, account + ".agent.json");
  const saved = await readFile(file, "utf8").then(text => JSON.parse(text) as { public_key: string }).catch(() => undefined);
  if (saved && (await keys(account)).some(key => key.public_key === saved.public_key)) {
    console.log("· " + account + " already has its agent key " + saved.public_key);
    continue;
  }
  const owner = JSON.parse(await readFile(join(dir, account + ".json"), "utf8")) as { private_key: string };
  const key = KeyPair.fromRandom("ed25519");
  const signer = new Account(account, provider, owner.private_key as KeyPairString);
  await signer.addFunctionCallAccessKey({ publicKey: key.getPublicKey(), contractId, methodNames: ["agent_settle"] });
  await writeFile(file, JSON.stringify({ account_id: account, public_key: key.getPublicKey().toString(), private_key: key.toString() }, null, 2) + "\n",
    { mode: 0o600 });
  console.log("· " + account + " now signs its own trades with " + key.getPublicKey().toString() + " (agent_settle on " + contractId + " only)");
}

const loaded = await agentKeys(merchants, { ...process.env, NEAR_AGENT_KEYS: "" });
if (values.env) {
  await writeFile(values.env, "NEAR_AGENT_KEYS=" + Object.entries(loaded).map(([account, key]) => account + "=" + key).join(",") + "\n", { mode: 0o600 });
  console.log("· wrote the server's NEAR_AGENT_KEYS line to " + values.env);
}

if (values.check) {
  // A transfer out of someone else's balance: the contract must refuse it with the agent as the caller.
  const chain = new NearChain({ network: "testnet", rpcUrl, contractId, operatorId, key: await operatorKey(operatorId), agentKeys: loaded });
  for (const account of merchants) {
    const other = merchants.find(name => name !== account)!;
    const outcome = await chain.relay(account, "agent_settle", { action_id: "key-check-" + Date.now().toString(36),
      ops: [{ op: "transfer", asset: "coin", amount: "1", from: other, to: account, memo: "Key check" }] }, 30);
    const ok = outcome.kind === "failed" && /only transfer their own balances/.test(outcome.reason);
    console.log((ok ? "· " : "✗ ") + account + " → " + (outcome.kind === "failed" ? outcome.reason : "accepted (unexpected)") + " · " + chain.explorer(outcome.hash));
    if (!ok) process.exitCode = 1;
  }
}
