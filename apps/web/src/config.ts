import { DevGuestAuth, DevNameAuth } from "./auth/dev";
import { HttpBackend } from "./backend/http";
import { LocalBackend } from "./backend/local";

const serverUrl = (import.meta.env.VITE_SERVER_URL || "http://127.0.0.1:4318").replace(/\/$/, "");
const authMode = import.meta.env.VITE_AUTH || "dev";
if (authMode !== "dev") throw new Error("Unknown auth provider.");

export const backend = new LocalBackend();
export const guest = new DevGuestAuth();
export const devAuth = new DevNameAuth(serverUrl);
export const live = new HttpBackend(serverUrl, devAuth);
export const publicView = new HttpBackend(serverUrl, devAuth);
export const liveDefault = import.meta.env.VITE_BACKEND === "server";
/** Privy app for social login (public ID). Set VITE_PRIVY_APP_ID to an empty string to show guest sign-in only. */
export const privyAppId = import.meta.env.VITE_PRIVY_APP_ID ?? "cmw6l29gh00g50gl2m9hpwyvr";
