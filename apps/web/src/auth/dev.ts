import type { AuthClient, AuthState } from "@lantern/protocol";

class AuthSession implements AuthClient {
  protected state: AuthState = { status: "signed_out" };
  protected credential: string | null = null;
  private listeners = new Set<(state: AuthState) => void>();
  getState() { return this.state; }
  async getCredential() { return this.credential; }
  onChange(cb: (state: AuthState) => void) { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  protected update(state: AuthState) { this.state = state; this.listeners.forEach(listener => listener(state)); return state; }
  async signIn(): Promise<AuthState> { return this.state; }
  async signOut() { this.credential = null; this.update({ status: "signed_out" }); }
}

export class DevGuestAuth extends AuthSession {
  override async signIn() { return this.update({ status: "signed_in", player: { id: "guest", displayName: "You" } }); }
}

export class DevNameAuth extends AuthSession {
  constructor(private readonly url: string) {
    super();
    try {
      const saved = sessionStorage.getItem("lantern-dev-identity");
      if (saved) {
        const data = JSON.parse(saved) as { credential: string; player: NonNullable<AuthState["player"]>; detailsUrl?: string };
        this.credential = data.credential;
        this.state = { status: "signed_in", player: data.player, detailsUrl: data.detailsUrl };
      }
    } catch { /* credentials can be entered again */ }
  }

  /** Set when the player signs out, so social login also ends its own session. */
  signedOut = false;

  /** Guest sign-in: a display name only. */
  override async signIn(name?: string) {
    if (name === undefined) return this.state;
    return this.session("/v1/auth/dev", { displayName: name }, "Use a display name from 1 to 24 characters.");
  }

  /** Social login: Privy's identity token, which lists the player's NEAR wallet, plus the name shown at the Row. */
  async signInWithPrivy(identityToken: string, name: string) {
    return this.session("/v1/auth/privy", { identityToken, displayName: name }, "Sign-in failed. Check your display name and try again.");
  }

  private async session(path: string, body: object, refused: string) {
    this.update({ status: "signing_in" });
    try {
      const response = await fetch(this.url + path, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(refused);
      const data = await response.json() as { credential: string; player: NonNullable<AuthState["player"]> & { nearAccount?: string } };
      this.credential = data.credential;
      this.signedOut = false;
      const detailsUrl = data.player.nearAccount ? "https://testnet.nearblocks.io/address/" + data.player.nearAccount : undefined;
      const player = { id: data.player.id, displayName: data.player.displayName };
      try { sessionStorage.setItem("lantern-dev-identity", JSON.stringify({ credential: data.credential, player, detailsUrl })); }
      catch { /* memory fallback */ }
      return this.update({ status: "signed_in", player, detailsUrl });
    } catch (error) {
      return this.update({ status: "error", error: error instanceof TypeError ? "The live server is unavailable."
        : error instanceof Error ? error.message : "Sign-in is unavailable." });
    }
  }

  override async signOut() {
    this.signedOut = true;
    try { sessionStorage.removeItem("lantern-dev-identity"); } catch { /* memory fallback */ }
    await super.signOut();
  }
}
