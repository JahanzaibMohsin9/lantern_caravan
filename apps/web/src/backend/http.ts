import type { ActionStatus, AuthClient, Catalog, ChroniclePage, CreateSessionReq, HaggleOffer, HaggleResult, HistoryRange, Intent,
  MarketBackend, MarketHistory, ProfileSummary, Quote, SaveStatus, SessionInfo, Snapshot } from "@lantern/protocol";

export type ChainStatus = { enabled: boolean; network?: string; contract?: string; contractUrl?: string; queued?: number;
  settled?: number; last?: { id: string; url: string; at: number } };

class RpcError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
type Pending = { night: string; quote: string; action: string };
type Reply<T> = { ok: true; result: T } | { ok: false; error: { code: string; message: string } };

export class HttpBackend implements MarketBackend {
  readonly kind = "server";
  readonly environmentLabel = "Dev server";
  private current!: Snapshot;
  private observed = 0;
  private watch = false;
  private pending?: Pending;
  private reading?: Promise<Snapshot>;
  connection = "Connected";
  notice = "";

  constructor(private readonly url: string, private readonly auth: AuthClient) {}

  private async rpc<T>(method: string, params: object = {}): Promise<T> {
    const credential = this.watch ? null : await this.auth.getCredential();
    let reply: Reply<T>;
    try {
      const response = await fetch(this.url + "/v1/rpc", { method: "POST", signal: AbortSignal.timeout(7000),
        headers: { "Content-Type": "application/json", ...(credential ? { Authorization: "Bearer " + credential } : {}) },
        body: JSON.stringify({ version: 1, request_id: crypto.randomUUID(), method, params }) });
      reply = await response.json() as Reply<T>;
    } catch {
      throw new Error("The live server is unavailable.");
    }
    if (!reply.ok) throw new RpcError(reply.error.code, reply.error.message);
    return reply.result;
  }

  private async publicRead<T>(path: string): Promise<T> {
    try {
      const response = await fetch(this.url + "/v1/public/" + path, { signal: AbortSignal.timeout(7000) });
      if (!response.ok) throw new Error();
      return await response.json() as T;
    } catch { throw new Error("The live server is unavailable."); }
  }

  /** The public Row's NEAR settlement: contract, settled transactions and the latest one. */
  async chainStatus(): Promise<ChainStatus> {
    try {
      const response = await fetch(this.url + "/v1/chain/status", { signal: AbortSignal.timeout(7000) });
      return response.ok ? await response.json() as ChainStatus : { enabled: false };
    } catch { return { enabled: false }; }
  }

  private key(room: string) { return "lantern-pending/" + (this.auth.getState().player?.id ?? "watch") + "/" + room; }

  private remember(room: string, value?: Pending) {
    this.pending = value;
    try {
      if (value) sessionStorage.setItem(this.key(room), JSON.stringify(value));
      else sessionStorage.removeItem(this.key(room));
    } catch { /* memory fallback */ }
  }

  private restorePending(room: string) {
    this.pending = undefined;
    try {
      const value = sessionStorage.getItem(this.key(room));
      if (value) this.pending = JSON.parse(value) as Pending;
    } catch { /* memory fallback */ }
  }

  get confirming() { return !!this.pending; }
  listProfiles() { return this.rpc<ProfileSummary[]>("list_profiles"); }

  async createSession(req: CreateSessionReq) {
    this.watch = false;
    const info = await this.rpc<SessionInfo>("create_session", req);
    this.restorePending(info.sessionId);
    await this.getSnapshot(info.sessionId);
    return info;
  }

  async joinRoom(roomId: string, opts?: { spectate?: boolean }) {
    this.watch = !!opts?.spectate && roomId === "the-row";
    const info = this.watch ? { sessionId: roomId, spectator: true }
      : await this.rpc<SessionInfo>("join_room", { room_id: roomId, spectate: opts?.spectate });
    this.restorePending(roomId);
    await this.getSnapshot(roomId);
    return info;
  }

  getCatalog(contentVersion: string) { return this.rpc<Catalog>("get_catalog", { content_version: contentVersion }); }

  view() {
    if (this.current.phase !== "open") return this.current;
    return { ...this.current, elapsed: Math.min(this.current.duration, this.current.elapsed + (performance.now() - this.observed) / 1000) };
  }

  private async loadSnapshot(sessionId: string) {
    if (this.pending && !this.watch) await this.recover(sessionId);
    const update = this.watch ? await this.publicRead<Snapshot>("snapshot")
      : await this.rpc<Snapshot>("get_snapshot", { session_id: sessionId });
    if (!this.current || this.current.session_id !== update.session_id || update.revision >= this.current.revision) {
      this.current = update;
      this.observed = performance.now();
    }
    this.connection = "Connected";
    return this.view();
  }

  getSnapshot(sessionId: string) {
    if (this.reading) return this.reading;
    this.reading = this.loadSnapshot(sessionId).catch(error => {
      this.connection = "Reconnecting";
      throw error;
    }).finally(() => { this.reading = undefined; });
    return this.reading;
  }

  getQuote(sessionId: string, night: string, intent: Intent) {
    if (this.pending) return Promise.reject(new Error("Your last action is confirming."));
    return this.rpc<Quote>("get_quote", { session_id: sessionId, night_id: night, intent });
  }

  haggle(sessionId: string, night: string, offer: HaggleOffer) {
    return this.rpc<HaggleResult>("haggle", { session_id: sessionId, night_id: night, offer });
  }

  async submitAction(sessionId: string, night: string, quote: string, action: string) {
    if (this.pending) throw new Error("Your last action is confirming.");
    const pending = { night, quote, action };
    this.remember(sessionId, pending);
    let status: ActionStatus;
    try { status = await this.submit(sessionId, pending); }
    catch (error) {
      if (error instanceof RpcError) { this.remember(sessionId); throw error; }
      return { state: "unknown" } as const;
    }
    if (status.state === "confirmed" || status.state === "rejected") this.remember(sessionId);
    // A lost refresh cannot change a settlement result.
    await this.getSnapshot(sessionId).catch(() => {});
    return status;
  }

  private submit(sessionId: string, pending: Pending) {
    return this.rpc<ActionStatus>("submit_action", { session_id: sessionId, night_id: pending.night,
      quote_id: pending.quote, action_id: pending.action });
  }

  getActionStatus(sessionId: string, night: string, action: string) {
    return this.rpc<ActionStatus>("get_action_status", { session_id: sessionId, night_id: night, action_id: action });
  }

  private async recover(sessionId: string) {
    const pending = this.pending!;
    try {
      let status: ActionStatus;
      try { status = await this.getActionStatus(sessionId, pending.night, pending.action); }
      catch (error) {
        if (!(error instanceof RpcError) || error.code !== "INVALID_REQUEST") throw error;
        status = await this.submit(sessionId, pending);
      }
      if (status.state === "confirmed" || status.state === "rejected") {
        this.notice = status.state === "confirmed" ? "Trade confirmed" : status.reason ?? "Trade declined";
        this.remember(sessionId);
      }
    } catch (error) {
      if (error instanceof RpcError && error.code !== "ACTION_PENDING" && error.code !== "AUTH_REQUIRED") {
        this.notice = error.message;
        this.remember(sessionId);
      }
    }
  }

  async advancePhase(sessionId: string, _actionId: string) { return this.getSnapshot(sessionId); }

  getChronicle(room: string, cursor?: string) {
    return room === "the-row" ? this.publicRead<ChroniclePage>("chronicle" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""))
      : this.rpc<ChroniclePage>("get_chronicle", { room_id: room, cursor });
  }

  getHistory(room: string, range: HistoryRange) {
    return room === "the-row" ? this.publicRead<MarketHistory>("history?range=" + range)
      : this.rpc<MarketHistory>("get_history", { room_id: room, range });
  }

  getSaveStatus(sessionId: string) { return this.rpc<SaveStatus>("get_save_status", { session_id: sessionId }); }
}
