import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Browser tests use their own ports and never reuse a running server, so a
// stale preview or API from another checkout cannot be tested by mistake.
const webPort = Number(process.env.LANTERN_E2E_WEB_PORT) || 4499;
const apiPort = Number(process.env.LANTERN_E2E_API_PORT) || 4418;
const api = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  use: { baseURL: `http://127.0.0.1:${webPort}`, viewport: { width: 1280, height: 720 }, trace: "retain-on-failure",
    video: process.env.LANTERN_RECORD === "1" ? "on" : "off" },
  projects: [
    { name: "chrome", use: { browserName: "chromium", channel: process.env.LANTERN_CHROME_CHANNEL } },
    { name: "firefox", use: { browserName: "firefox" } },
  ],
  webServer: [{
    command: `npm run build -w @lantern/web -- --outDir dist-e2e && npm exec -w @lantern/web -- vite preview --outDir dist-e2e --host 127.0.0.1 --port ${webPort} --strictPort`,
    url: `http://127.0.0.1:${webPort}`,
    env: { VITE_SERVER_URL: api },
    reuseExistingServer: false,
    timeout: 180_000,
  }, {
    command: "npm run dev -w @lantern/server",
    url: `${api}/v1/health`,
    env: { PORT: String(apiPort), LANTERN_DATA_DIR: join(tmpdir(), "lantern-row-e2e-" + process.pid), LANTERN_PREP_SECONDS: "4" },
    reuseExistingServer: false,
  }],
});
