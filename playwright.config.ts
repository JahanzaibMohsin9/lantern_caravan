import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  use: { baseURL: "http://127.0.0.1:4399", viewport: { width: 1280, height: 720 }, trace: "retain-on-failure",
    video: process.env.LANTERN_RECORD === "1" ? "on" : "off" },
  projects: [
    { name: "chrome", use: { browserName: "chromium", channel: process.env.LANTERN_CHROME_CHANNEL } },
    { name: "firefox", use: { browserName: "firefox" } },
  ],
  webServer: [{
    command: "npm run preview -w @lantern/web",
    url: "http://127.0.0.1:4399",
    reuseExistingServer: !process.env.CI,
  }, {
    command: "npm run dev -w @lantern/server",
    url: "http://127.0.0.1:4318/v1/health",
    env: { LANTERN_DATA_DIR: join(tmpdir(), "lantern-row-e2e-" + process.pid), LANTERN_PREP_SECONDS: "4" },
    reuseExistingServer: !process.env.CI,
  }],
});
