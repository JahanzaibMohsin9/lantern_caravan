/**
 * Social login through Privy (Google or email). The browser signs in with Privy, which also creates the player's
 * NEAR wallet, then sends Privy's identity token here. The token is checked against the app's published keys
 * (no secret needed); the player's NEAR implicit account becomes their player ID, so their coins, goods and shares
 * settle to an account they own. The server then issues its usual signed session credential.
 */
import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

export const defaultPrivyAppId = "cmw6l29gh00g50gl2m9hpwyvr";

type Linked = { type?: string; address?: string; chain_type?: string; chainType?: string; name?: string; email?: string };

/** A NEAR implicit account: the hex of an ed25519 public key. */
export const isImplicitAccount = (value: string) => /^[0-9a-f]{64}$/.test(value);

export function privyPlayer(payload: JWTPayload): { playerId: string; nearAccount?: string } {
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("AUTH_REQUIRED");
  let linked: Linked[] = [];
  try {
    const raw = payload.linked_accounts;
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) linked = parsed as Linked[];
  } catch { /* no linked accounts */ }
  const near = linked.find(account => account.type === "wallet" && (account.chain_type ?? account.chainType) === "near"
    && typeof account.address === "string" && isImplicitAccount(account.address.toLowerCase()));
  if (near) return { playerId: near.address!.toLowerCase(), nearAccount: near.address!.toLowerCase() };
  // Without a NEAR wallet the player still gets a stable ID, settled to a derived holder like a guest.
  return { playerId: "privy-" + createHash("sha256").update(payload.sub).digest("hex").slice(0, 20) };
}

export class PrivyVerifier {
  private readonly keys: JWTVerifyGetKey;
  constructor(readonly appId: string, keys?: JWTVerifyGetKey) {
    this.keys = keys ?? createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`));
  }

  /** Returns the player for a valid Privy identity token, or throws AUTH_REQUIRED. */
  async verify(token: string) {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.keys, { issuer: "privy.io", audience: this.appId, algorithms: ["ES256"] }));
    } catch {
      throw new Error("AUTH_REQUIRED");
    }
    return privyPlayer(payload);
  }
}
