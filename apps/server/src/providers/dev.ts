import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import type { IdentityProvider, PreparedAction, SettlementProvider, SettlementStatus } from "@lantern/protocol";
import { atomic, readJson } from "./file";

export class DevIdentityProvider implements IdentityProvider {
  private constructor(private readonly secret: string) {}

  static async create(directory: string) {
    const file = join(directory, "dev-identity.json");
    const existing = await readJson<{ secret: string }>(file);
    const secret = existing?.secret ?? randomBytes(32).toString("hex");
    if (!existing) await atomic(file, { secret });
    return new DevIdentityProvider(secret);
  }

  issue(displayName: string) {
    const name = displayName.trim().replace(/\s+/g, " ");
    if (!name || name.length > 24 || /[<>\p{Cc}]/u.test(name)) throw new Error("Use a name from 1 to 24 characters.");
    const playerId = createHash("sha256").update(name.normalize("NFKC").toLowerCase()).digest("hex").slice(0, 24);
    return this.issueFor(playerId, name);
  }

  /** A session credential for a player whose identity another provider (social login) has already verified. */
  issueFor(playerId: string, displayName: string) {
    const name = displayName.trim().replace(/\s+/g, " ");
    if (!name || name.length > 24 || /[<>\p{Cc}]/u.test(name)) throw new Error("Use a name from 1 to 24 characters.");
    const payload = Buffer.from(JSON.stringify({ playerId, displayName: name })).toString("base64url");
    return { credential: payload + "." + this.sign(payload), player: { id: playerId, displayName: name } };
  }

  private sign(payload: string) { return createHmac("sha256", this.secret).update(payload).digest("base64url"); }

  async verify(credential: string) {
    const [payload, signature, extra] = credential.split(".");
    if (!payload || !signature || extra) throw new Error("AUTH_REQUIRED");
    const expected = Buffer.from(this.sign(payload));
    const supplied = Buffer.from(signature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error("AUTH_REQUIRED");
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { playerId: string; displayName: string };
  }
}

type Settlement = { action: PreparedAction; submitted?: number };

export class DevSettlementProvider implements SettlementProvider {
  private delay = Math.max(0, Number(process.env.DEV_SETTLE_DELAY_MS) || 0);
  private fail = Math.max(0, Math.min(1, Number(process.env.DEV_SETTLE_FAIL_RATE) || 0));
  private unknown = Math.max(0, Math.min(1, Number(process.env.DEV_SETTLE_UNKNOWN_RATE) || 0));

  constructor(private readonly directory: string) {}

  private path(actionId: string) {
    const key = createHash("sha256").update(actionId).digest("hex");
    return join(this.directory, "settle-" + key + ".json");
  }

  async prepare(action: PreparedAction) {
    const file = this.path(action.actionId);
    const prior = await readJson<Settlement>(file);
    if (prior && JSON.stringify(prior.action) !== JSON.stringify(action)) throw new Error("ACTION_CONFLICT");
    if (!prior) await atomic(file, { action });
  }

  async submit(actionId: string) {
    const file = this.path(actionId);
    const row = await readJson<Settlement>(file);
    if (!row) throw new Error("Action was not prepared.");
    if (!row.submitted) await atomic(file, { ...row, submitted: Date.now() });
  }

  async status(actionId: string): Promise<SettlementStatus> {
    const row = await readJson<Settlement>(this.path(actionId));
    if (!row?.submitted) return { state: "unknown" };
    const hash = createHash("sha256").update(actionId).digest();
    const elapsed = Date.now() - row.submitted;
    if (hash.readUInt32LE(0) / 4294967296 < this.unknown && elapsed < this.delay + 2200) return { state: "unknown" };
    if (elapsed < this.delay) return { state: "pending" };
    if (hash.readUInt32LE(4) / 4294967296 < this.fail) return { state: "rejected", reason: "The dev ledger declined this action." };
    return { state: "confirmed", receipt: { id: "dev-" + hash.subarray(0, 6).toString("hex"), label: "Dev receipt" } };
  }

  async settleBatch(batch: Parameters<NonNullable<SettlementProvider["settleBatch"]>>[0]): Promise<SettlementStatus> {
    await atomic(this.path("batch-" + batch.batchId), batch);
    return { state: "confirmed", receipt: { id: "dev-" + batch.batchId, label: "Dev batch receipt" } };
  }
}
