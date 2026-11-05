import { spawn } from "node:child_process";
import { resolve } from "node:path";

const children = [
  spawn(process.execPath, ["--import", "tsx", "apps/server/src/main.ts"], { stdio: "inherit", env: process.env }),
  spawn(process.execPath, [resolve("apps/web/node_modules/vite/bin/vite.js"), "--host", "127.0.0.1"],
    { cwd: resolve("apps/web"), stdio: "inherit", env: { ...process.env, VITE_BACKEND: "server", VITE_AUTH: "dev" } }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) child.on("exit", code => stop(code ?? 0)).on("error", error => { console.error(error); stop(1); });
process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());
