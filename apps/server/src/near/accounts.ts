/**
 * Maps the game's ledger accounts to holders in the NEAR items contract.
 *
 * Merchants, rival haulers, the freight barge and villages are real sub-accounts of the game's root account
 * ("NPCs with wallets"). Funds, escrows and dividend pools stay internal to the contract under their own
 * `sys:`, `esc:` and `pool:` keys. Players settle to an account derived from their player ID until social
 * login gives them a NEAR account of their own.
 */
import { createHash } from "node:crypto";

export type AccountConfig = { root: string; players: string };

const merchants: Record<string, string> = {
  paper_mill: "mira", oil_wharf: "sami", reed_thread: "toma", indigo_atelier: "nila", lantern_house: "asha",
};
const rivals: Record<string, string> = { pell: "pell", juno: "juno", ren: "ren", freight: "freight" };
const villages: Record<string, string> = { millbrook: "millbrook", ember_falls: "ember-falls", reedmarsh: "reedmarsh" };

/** Every account that signs as an agent: registered with `register_agents` once. */
export const agentAccounts = (config: AccountConfig) =>
  [...Object.values(merchants), ...Object.values(rivals), ...Object.values(villages)].map(name => name + "." + config.root);

const accountPattern = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
export const isAccountId = (value: string) => value.length >= 2 && value.length <= 64 && accountPattern.test(value);

/** A player ID that is already a NEAR account (from social login) is used as is. */
function playerAccount(id: string, config: AccountConfig) {
  if (isAccountId(id) && id.includes(".")) return id;
  const slug = id.toLowerCase().replace(/[^a-z0-9]/g, "");
  const name = slug.length >= 2 && slug.length <= 32 ? slug : createHash("sha256").update(id).digest("hex").slice(0, 24);
  return name + "." + config.players;
}

export function chainHolder(account: string, config: AccountConfig): string {
  if (/^(sys|esc|pool):./.test(account)) return account;
  const [prefix, ...rest] = account.split(":");
  const id = rest.join(":");
  if (prefix === "m" && merchants[id]) return merchants[id] + "." + config.root;
  if (prefix === "v" && villages[id]) return villages[id] + "." + config.root;
  if (prefix === "r" && rivals[id]) return rivals[id] + "." + config.root;
  // Village boats and any rival without its own sub-account are internal, like the other funds.
  if (prefix === "r" && id) return "sys:rival-" + id;
  if (prefix === "p" && id) return playerAccount(id, config);
  throw new Error("NEAR_HOLDER · No chain holder for game account " + account + ".");
}
