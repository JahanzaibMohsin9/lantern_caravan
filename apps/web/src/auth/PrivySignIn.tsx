/**
 * Social login with Privy (Google or email), loaded only when the Live market panel asks for it. After sign-in it
 * makes sure the player has a NEAR wallet, then hands Privy's identity token (which lists that wallet) to the game
 * server. The player never signs anything: the server settles their trades to their own NEAR account.
 */
import { useEffect, useRef, useState } from "react";
import { getIdentityToken, PrivyProvider, useLogin, useLogout, usePrivy, useUser, type User } from "@privy-io/react-auth";
import { useCreateWallet } from "@privy-io/react-auth/extended-chains";
import { LogIn } from "lucide-react";

type Props = { appId: string; disabled: boolean; signOutRequested: () => boolean;
  onToken: (token: string) => Promise<void>; onError: (message: string) => void };

const nearOf = (user: User | null | undefined) => user?.linkedAccounts.find(account =>
  account.type === "wallet" && "chainType" in account && account.chainType === "near") as { address: string } | undefined;

/** True when the token's linked accounts already include a NEAR wallet (the server keys the player on it). */
function tokenHasNear(token: string) {
  try {
    const body = JSON.parse(atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { linked_accounts?: unknown };
    const linked = typeof body.linked_accounts === "string" ? JSON.parse(body.linked_accounts) : body.linked_accounts;
    return Array.isArray(linked) && linked.some(account => account?.type === "wallet"
      && (account.chain_type ?? account.chainType) === "near");
  } catch { return false; }
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function SignInButton({ disabled, signOutRequested, onToken, onError }: Omit<Props, "appId">) {
  const { ready, authenticated, user } = usePrivy();
  const { refreshUser } = useUser();
  const { createWallet } = useCreateWallet();
  const { logout } = useLogout();
  const [working, setWorking] = useState(false);
  const busy = useRef(false);

  // A game sign-out also ends the Privy session, so the next player can use another account.
  useEffect(() => { if (ready && authenticated && signOutRequested()) void logout(); }, [ready, authenticated]);

  async function finish(current: User | null) {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    try {
      if (!nearOf(current)) await createWallet({ chainType: "near" });
      let token: string | null = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        token = await getIdentityToken();
        if (token && tokenHasNear(token)) break;
        await refreshUser().catch(() => undefined);
        await wait(600);
      }
      if (!token) throw new Error("Sign-in is unavailable right now.");
      if (!tokenHasNear(token)) throw new Error("Your NEAR account is still being created. Try again in a moment.");
      await onToken(token);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Sign-in is unavailable right now.");
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  const { login } = useLogin({ onComplete: ({ user: signedIn }) => void finish(signedIn) });
  return <button type="button" className="primary" disabled={!ready || working || disabled}
    onClick={() => authenticated ? void finish(user) : login()}>
    <LogIn size={16}/> {!ready ? "Loading sign-in…" : working ? "Creating your NEAR account…" : "Sign in with Google or email"}
  </button>;
}

export default function PrivySignIn({ appId, ...props }: Props) {
  return <PrivyProvider appId={appId} config={{
    loginMethods: ["google", "email"],
    appearance: { theme: "dark", accentColor: "#f0b17f", landingHeader: "Sign in to Lantern Caravan" },
    embeddedWallets: { ethereum: { createOnLogin: "off" }, solana: { createOnLogin: "off" } },
  }}>
    <SignInButton {...props}/>
  </PrivyProvider>;
}
