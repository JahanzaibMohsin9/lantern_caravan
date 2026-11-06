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
  view<T>(method: string, args: Record<string, unknown>): Promise<T>;
  /** Signs as the operator and waits for execution. Throws only when the outcome is unknown (network trouble). */
  call(method: string, args: Record<string, unknown>, gasTera?: number): Promise<CallOutcome>;
}

export type NearConfig = { network: "testnet"; rpcUrl: string; contractId: string; operatorId: string; key: KeyPairString };

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
  private readonly provider: JsonRpcProvider;
  private readonly account: Account;

  constructor(config: NearConfig) {
    if (config.network !== "testnet") throw new Error("NEAR_NETWORK · Only testnet is supported.");
    this.contractId = config.contractId;
    this.operatorId = config.operatorId;
    this.provider = new JsonRpcProvider({ url: config.rpcUrl });
    this.account = new Account(config.operatorId, this.provider, config.key);
  }

  explorer = (hash: string) => "https://testnet.nearblocks.io/txns/" + hash;

  async view<T>(method: string, args: Record<string, unknown>) {
    return await this.provider.callFunction({ contractId: this.contractId, method, args }) as T;
  }

  async call(method: string, args: Record<string, unknown>, gasTera = 300): Promise<CallOutcome> {
    const response = await this.account.signAndSendTransaction({
      receiverId: this.contractId,
      actions: [actions.functionCall(method, args, teraToGas(gasTera), 0n)],
      waitUntil: "EXECUTED_OPTIMISTIC",
      throwOnFailure: false,
    });
    const hash = response.transaction_outcome?.id ?? (response.transaction as { hash?: string } | undefined)?.hash ?? "";
    const reason = failureReason(response.status) ??
      response.receipts_outcome?.map(receipt => failureReason(receipt.outcome?.status)).find(Boolean);
    if (reason) return { kind: "failed", hash, reason };
    const value = response.status && typeof response.status === "object" && "SuccessValue" in response.status
      ? Buffer.from(String((response.status as { SuccessValue: string }).SuccessValue ?? ""), "base64").toString("utf8") : "";
    return { kind: "ok", hash, applied: value.trim() !== "false" };
  }
}
