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
        const data = JSON.parse(saved) as { credential: string; player: NonNullable<AuthState["player"]> };
        this.credential = data.credential;
        this.state = { status: "signed_in", player: data.player };
      }
    } catch { /* credentials can be entered again */ }
  }

  override async signIn(name?: string) {
    if (name === undefined) return this.state;
    this.update({ status: "signing_in" });
    try {
      const response = await fetch(this.url + "/v1/auth/dev", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name }), signal: AbortSignal.timeout(7000) });
      if (!response.ok) throw new Error("Use a display name from 1 to 24 characters.");
      const data = await response.json() as { credential: string; player: NonNullable<AuthState["player"]> };
      this.credential = data.credential;
      try { sessionStorage.setItem("lantern-dev-identity", JSON.stringify(data)); } catch { /* memory fallback */ }
      return this.update({ status: "signed_in", player: data.player });
    } catch (error) {
      return this.update({ status: "error", error: error instanceof TypeError ? "The live server is unavailable."
        : error instanceof Error ? error.message : "Sign-in is unavailable." });
    }
  }

  override async signOut() {
    try { sessionStorage.removeItem("lantern-dev-identity"); } catch { /* memory fallback */ }
    await super.signOut();
  }
}
