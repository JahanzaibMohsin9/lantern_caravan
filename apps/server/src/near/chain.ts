/**
 * The few things the settlement provider needs from NEAR, behind an interface so tests can use a fake.
 * Only testnet is supported: the client refuses any other network.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Account, actions, JsonRpcProvider, teraToGas, type KeyPairString } from "near-api-js";

/** `applied` is false when the contract had already settled that ID (a retry): the call still succeeded. */
export type CallOutcome = { kind: "ok"; hash: string; applied: boolean } | { kind: "failed"; hash: string; reason: string };

export interface Chain {
  readonly contractId: string;
  readonly operatorId: string;
  readonly explorer: (hash: string) => string;
  /** Agent accounts this client holds a signing key for. Their own transfers are signed by them, not the operator. */
  readonly signers: ReadonlySet<string>;
  view<T>(method: string, args: Record<string, unknown>): Promise<T>;
  /** Signs as the operator and waits for execution. Throws only when the outcome is unknown (network trouble). */
  call(method: string, args: Record<string, unknown>, gasTera?: number): Promise<CallOutcome>;
  /**
   * Signs a call as `signer` (one of `signers`) and has the operator relay it as a NEP-366 meta transaction, so the
   * contract sees the agent as the caller while the operator pays the gas. Throws only when the outcome is unknown.
   */
  relay(signer: string, method: string, args: Record<string, unknown>, gasTera?: number): Promise<CallOutcome>;
}

/** Without a key the client can only read: `call` refuses. `agentKeys` are function-call keys, one per agent account. */
export type NearConfig = { network: "testnet"; rpcUrl: string; contractId: string; operatorId: string; key?: KeyPairString;
  agentKeys?: Record<string, KeyPairString> };

/**
 * Each agent's function-call key (it can call only `agent_settle` on the items contract). They come from
 * `NEAR_AGENT_KEYS` ("account=ed25519:...,account=ed25519:...") or from `<account>.agent.json` files beside the
 * operator's credentials, written by `npm run near:agent-keys`. Accounts without a key are signed for by the operator.
 */
export async function agentKeys(accounts: readonly string[], env = process.env): Promise<Record<string, KeyPairString>> {
  const keys: Record<string, KeyPairString> = {};
  for (const pair of (env.NEAR_AGENT_KEYS ?? "").split(",").map(value => value.trim()).filter(Boolean)) {
    const at = pair.indexOf("=");
    const account = pair.slice(0, at), key = pair.slice(at + 1);
    if (at > 0 && accounts.includes(account) && key.startsWith("ed25519:")) keys[account] = key as KeyPairString;
  }
  if (env.NEAR_AGENT_KEYS) return keys;
  const dir = env.NEAR_CREDENTIALS_DIR ?? join(homedir(), ".near-credentials");
  for (const account of accounts) {
    try {
      const parsed = JSON.parse(await readFile(join(dir, "testnet", account + ".agent.json"), "utf8")) as { private_key?: string };
      if (parsed.private_key) keys[account] = parsed.private_key as KeyPairString;
    } catch {
      // No key file: the operator keeps signing for this agent.
    }
  }
  return keys;
}

/** The operator's key comes from `NEAR_OPERATOR_KEY` or the operator's own legacy-keychain file, and nothing else. */
export async function operatorKey(operatorId: string, env = process.env): Promise<KeyPairString> {
  if (env.NEAR_OPERATOR_KEY) return env.NEAR_OPERATOR_KEY as KeyPairString;
  const dir = env.NEAR_CREDENTIALS_DIR ?? join(homedir(), ".near-credentials");
  const file = join(dir, "testnet", operatorId + ".json");
  const parsed = JSON.parse(await readFile(file, "utf8")) as { private_key?: string };
  if (!parsed.private_key) throw new Error("NEAR_KEY · " + file + " has no private_key.");
  return parsed.private_key as KeyPairString;
}

function failureReason(status: unknown): string | undefined {
  if (!status || typeof status !== "object" || !("Failure" in status)) return undefined;
  const text = JSON.stringify((status as { Failure: unknown }).Failure);
  const panic = /"ExecutionError":"([^"]+)"/.exec(text)?.[1] ?? /Smart contract panicked: ([^"]+)/.exec(text)?.[1];
  return (panic ?? text).slice(0, 300);
}

export class NearChain implements Chain {
  readonly contractId: string;
  readonly operatorId: string;
  readonly signers: ReadonlySet<string>;
  private readonly provider: JsonRpcProvider;
  private readonly account: Account;
  private readonly agents = new Map<string, Account>();
  private readonly canSign: boolean;

  constructor(config: NearConfig) {
    if (config.network !== "testnet") throw new Error("NEAR_NETWORK · Only testnet is supported.");
    this.contractId = config.contractId;
    this.operatorId = config.operatorId;
    this.provider = new JsonRpcProvider({ url: config.rpcUrl });
    this.account = new Account(config.operatorId, this.provider, config.key);
    this.canSign = !!config.key;
    for (const [account, key] of Object.entries(config.agentKeys ?? {})) this.agents.set(account, new Account(account, this.provider, key));
    this.signers = new Set(this.canSign ? this.agents.keys() : []);
  }

  explorer = (hash: string) => "https://testnet.nearblocks.io/txns/" + hash;

  /** A read-only call. Public RPCs rate-limit bursts of reads, so a 429 waits and retries with backoff. */
  async view<T>(method: string, args: Record<string, unknown>) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.provider.callFunction({ contractId: this.contractId, method, args }) as T;
      } catch (error) {
        if (attempt >= 6 || !rateLimited(error)) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
      }
    }
  }

  async call(method: string, args: Record<string, unknown>, gasTera = 300): Promise<CallOutcome> {
    if (!this.canSign) throw new Error("NEAR_KEY · This client is read-only.");
    return outcomeOf(await this.account.signAndSendTransaction({
      receiverId: this.contractId,
      actions: [actions.functionCall(method, args, teraToGas(gasTera), 0n)],
      waitUntil: "EXECUTED_OPTIMISTIC",
      throwOnFailure: false,
    }));
  }

  async relay(signer: string, method: string, args: Record<string, unknown>, gasTera = 200): Promise<CallOutcome> {
    const agent = this.agents.get(signer);
    if (!this.canSign || !agent) throw new Error("NEAR_KEY · No signing key for " + signer + ".");
    // The agent signs the delegate action with its own function-call key; the operator only wraps and pays for it.
    const { signedDelegate } = await agent.createSignedMetaTransaction({
      receiverId: this.contractId,
      actions: [actions.functionCall(method, args, teraToGas(gasTera), 0n)],
    });
    return outcomeOf(await this.account.signAndSendTransaction({
      receiverId: signer,
      actions: [actions.signedDelegate(signedDelegate)],
      waitUntil: "EXECUTED_OPTIMISTIC",
      throwOnFailure: false,
    }));
  }
}

type SendResponse = Awaited<ReturnType<Account["signAndSendTransaction"]>>;

/** A failure anywhere in the receipt chain (for a meta transaction, the agent's inner call) fails the whole call. */
function outcomeOf(response: SendResponse): CallOutcome {
  const hash = response.transaction_outcome?.id ?? (response.transaction as { hash?: string } | undefined)?.hash ?? "";
  const reason = failureReason(response.status) ??
    response.receipts_outcome?.map(receipt => failureReason(receipt.outcome?.status)).find(Boolean);
  if (reason) return { kind: "failed", hash, reason };
  const value = response.status && typeof response.status === "object" && "SuccessValue" in response.status
    ? Buffer.from(String((response.status as { SuccessValue: string }).SuccessValue ?? ""), "base64").toString("utf8") : "";
  return { kind: "ok", hash, applied: value.trim() !== "false" };
}

function rateLimited(error: unknown) {
  const cause = (error as { cause?: unknown })?.cause;
  return cause === 429 || /rate limit|429/i.test(String((error as Error)?.message ?? error));
}
