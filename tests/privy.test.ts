import { describe, expect, test } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { PrivyVerifier } from "../apps/server/src/providers/privy";
import { chainHolder } from "../apps/server/src/near/accounts";

const appId = "test-app";
const near = "a".repeat(40) + "0123456789abcdef01234567";

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256", use: "sig" };
  const verifier = new PrivyVerifier(appId, createLocalJWKSet({ keys: [jwk] }));
  const token = (claims: Record<string, unknown>, options: { audience?: string; issuer?: string; key?: Parameters<SignJWT["sign"]>[0] } = {}) =>
    new SignJWT(claims).setProtectedHeader({ alg: "ES256", kid: "k1" }).setSubject("did:privy:user-1")
      .setIssuer(options.issuer ?? "privy.io").setAudience(options.audience ?? appId).setIssuedAt().setExpirationTime("1h")
      .sign(options.key ?? privateKey);
  return { verifier, token };
}

describe("Privy social login", () => {
  test("a player with a NEAR wallet gets their implicit account as player ID", async () => {
    const { verifier, token } = await setup();
    const linked = JSON.stringify([{ type: "email", address: "ari@example.com" }, { type: "wallet", chain_type: "near", address: near }]);
    expect(await verifier.verify(await token({ linked_accounts: linked }))).toEqual({ playerId: near, nearAccount: near });
  });

  test("without a NEAR wallet the player still gets a stable ID", async () => {
    const { verifier, token } = await setup();
    const first = await verifier.verify(await token({ linked_accounts: "[]" }));
    const again = await verifier.verify(await token({}));
    expect(first.playerId).toMatch(/^privy-[0-9a-f]{20}$/);
    expect(again.playerId).toBe(first.playerId);
    expect(first.nearAccount).toBeUndefined();
  });

  test("tokens for another app, another issuer or another key are refused", async () => {
    const { verifier, token } = await setup();
    const other = (await generateKeyPair("ES256")).privateKey;
    for (const bad of [await token({}, { audience: "someone-else" }), await token({}, { issuer: "example.com" }),
      await token({}, { key: other }), "not-a-token"]) {
      await expect(verifier.verify(bad)).rejects.toThrow("AUTH_REQUIRED");
    }
  });

  test("an implicit-account player settles to that account on chain", () => {
    const config = { root: "lantern-caravan.testnet", players: "players.lantern-caravan.testnet" };
    expect(chainHolder("p:" + near, config)).toBe(near);
    expect(chainHolder("p:privy-0123456789abcdef0123", config)).toBe("privy0123456789abcdef0123.players.lantern-caravan.testnet");
  });
});
