import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/** The header's Pause (or Settings) button, then Settings. */
async function openSettings(page: Page) {
  await page.locator(".header-actions").getByRole("button", { name: /^(Pause|Settings)$/ }).click();
  const settings = page.getByRole("heading", { name: "Settings", exact: true });
  if (!(await settings.isVisible())) await page.locator(".panel").getByRole("button", { name: /^Settings/ }).click();
  await expect(settings).toBeVisible();
}

/** The barge's details (almanac, upriver prices, wrecks, upgrades, Bell orders) sit in a drawer on the Dock. */
async function openDrawer(page: Page) {
  const drawer = page.getByRole("region", { name: "The Dock" }).locator("details.dock-more");
  if (!(await drawer.evaluate(node => (node as HTMLDetailsElement).open))) await drawer.locator(":scope > summary").click();
  const barge = drawer.getByRole("button", { name: "Barge", exact: true });
  if (await barge.count()) await barge.click();
}

test("Night 1: casts off from the Dock, hauls oil from Ember Falls and sells it to the Row", async ({ page }) => {
  test.setTimeout(100_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  const dock = page.getByRole("region", { name: "The Dock" });
  await page.goto("/");
  await expect(page).toHaveTitle("Lantern Caravan");
  await expect(page.getByRole("heading", { name: "Lantern Caravan", exact: true })).toBeVisible();
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Lantern Caravan.*Lantern Row/);
  await expect(page.locator(".brand")).toContainText("LANTERN ROW");
  await expect(button("Start")).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  await page.context().setOffline(true);
  await page.clock.install();
  await button("Start").click();
  // No walking, crafting or locked barge: the Dock is the first screen and the barge is ready.
  await expect(page.getByRole("navigation", { name: "Market locations" })).toHaveCount(0);
  await expect(page.getByText("NIGHT 01")).toBeVisible();
  await expect(page.getByText("First Haul", { exact: true })).toBeVisible();
  await expect(dock.getByText("River run 0/1")).toBeVisible();
  await dock.getByRole("button", { name: /^Cast off/ }).click();
  const river = page.getByRole("region", { name: "River Run" });
  await expect(river).toBeVisible();
  await page.keyboard.press("m");
  await expect(page.getByRole("dialog", { name: "River map" })).toBeVisible();
  await page.keyboard.press("Escape");
  const trade = river.getByRole("button", { name: /Trade at Ember Falls/ });
  for (const key of ["Shift", "w", " "]) await page.keyboard.down(key);
  for (let i = 0; i < 160 && !(await trade.isVisible()); i++) await page.clock.runFor(200);
  for (const key of ["Shift", "w", " "]) await page.keyboard.up(key);
  await page.keyboard.press("e");
  const market = page.getByRole("dialog", { name: "Village market" });
  await expect(market.getByRole("heading", { name: "Ember Falls" })).toBeVisible();
  await market.getByLabel("Order size").getByRole("button", { name: "10", exact: true }).click();
  await market.locator(".river-trade").filter({ hasText: "Lamp oil" }).getByRole("button", { name: /^Buy \d/ }).click();
  await page.clock.runFor(150);
  await expect(river.getByText(/Lamp oil × \d/)).toBeVisible();
  await button("Back to the barge").click();
  const moor = river.getByRole("button", { name: /Moor at The Landing/ });
  for (const key of ["Shift", "s", " "]) await page.keyboard.down(key);
  for (let i = 0; i < 160 && !(await moor.isVisible()); i++) await page.clock.runFor(200);
  for (const key of ["Shift", "s", " "]) await page.keyboard.up(key);
  await page.keyboard.press("e");
  await page.clock.runFor(400);
  await expect(river).toHaveCount(0);
  await expect(dock.getByText("River run 1/1")).toBeVisible();
  // The Row pays a hauler the full price for goods a stall is short of.
  const oil = dock.getByLabel("Sell your haul").locator(".dock-hold").filter({ hasText: "Lamp oil" });
  await expect(oil).toContainText("short of it");
  const coins = Number(await page.locator(".meter.gold b").innerText());
  await oil.getByRole("button", { name: /^Sell \d/ }).click();
  await expect.poll(async () => Number(await page.locator(".meter.gold b").innerText())).toBeGreaterThan(coins);
  // The Last run card adds up the trip: spent upriver, earned at the Dock, and the net.
  const lastRun = dock.getByLabel("Last run");
  await expect(lastRun).toContainText("on the river");
  await expect(lastRun).toContainText(/goods brought home for \d+ coins upriver/);
  await expect(lastRun.locator(".dock-voyage-row span").nth(1)).toContainText("+");
  // A merchant card opens the full trade panel.
  await dock.locator(".dock-merchant").filter({ hasText: "Oil Wharf" }).click();
  await expect(page.getByRole("heading", { name: "Oil Wharf", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("fits each free trim at the Dock and sees it on the live barge HUD", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Live market", exact: true }).click();
  await page.getByLabel("Display name").fill("Trim captain");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Create private room" }).click();
  await expect(page.locator("[data-room-code]")).toBeVisible();
  for (const trim of ["runner", "ironclad", "gunner", "balanced"]) {
    const dock = page.getByRole("region", { name: "The Dock" });
    await expect(dock).toBeVisible();
    await page.getByRole("combobox", { name: "Barge trim" }).selectOption(trim);
    await dock.getByRole("button", { name: /^Cast off/ }).click();
    const river = page.getByRole("region", { name: "River Run" });
    await expect(river.getByText("BARGE / " + trim.toUpperCase(), { exact: true })).toBeVisible();
    await river.getByRole("button", { name: /Moor at The Landing/ }).click();
    await expect(river).toHaveCount(0);
    await expect(dock.getByRole("combobox", { name: "Barge trim" })).toHaveValue(trim);
  }
});

test("salvages the oil the Night 2 storm sank at Heron Reach", async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  await page.goto("/");
  await button("Start").click();
  // A save at the start of Night 3, built by the game code, goes in through the real Import save control.
  const save = execFileSync(process.execPath, [join("node_modules", "tsx", "dist", "cli.mjs"), join("tests", "e2e", "fixtures", "night3-save.ts")]);
  page.on("dialog", dialog => void dialog.accept());
  await openSettings(page);
  await page.locator('input[type="file"]').setInputFiles({ name: "night3.json", mimeType: "application/json", buffer: save });
  await expect(page.getByText("NIGHT 03")).toBeVisible();
  await page.clock.install();
  await page.keyboard.press("Escape");
  await openDrawer(page);
  await expect(page.getByLabel("Harbor almanac")).toContainText("Tonight · Pressing strike at Ember Falls.");
  const wrecks = page.getByLabel("Wrecks on the river");
  await expect(wrecks).toContainText("Wreck of the freight barge on Heron Reach");
  await expect(wrecks).toContainText("6 lamp oil");
  await page.getByRole("button", { name: /^Cast off/ }).click();
  const river = page.getByRole("region", { name: "River Run" });
  await expect(river).toBeVisible();
  const salvage = river.getByRole("button", { name: /Salvage the wreck/ });
  // Keep real wall time between locator checks from carrying us past the small stop radius.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const stop = river.getByRole("button", { name: /Visit the lock keeper's shed/ });
  await page.keyboard.down("w");
  for (let i = 0; i < 35 && !(await stop.isVisible()); i++) await page.clock.runFor(150);
  await page.keyboard.up("w");
  await expect(stop).toBeVisible();
  await page.keyboard.press("e");
  await page.getByRole("dialog", { name: "Riverside stop" }).getByRole("button", { name: /Take the shot crate/ }).click();
  await page.clock.runFor(150);
  await expect(page.getByRole("dialog", { name: "Riverside stop" })).toHaveCount(0);
  await page.keyboard.down("w");
  for (let i = 0; i < 120 && !(await salvage.isVisible()); i++) await page.clock.runFor(150);
  await page.keyboard.up("w");
  await expect(salvage).toBeVisible();
  const capture = async (name: string) => {
    if (process.env.LANTERN_CAPTURE_DIR) await page.screenshot({ path: join(process.env.LANTERN_CAPTURE_DIR, name + ".png") });
  };
  await capture("river-wreck");
  await page.keyboard.press("m");
  await capture("river-map-wrecks-stops");
  await page.keyboard.press("Escape");
  await page.keyboard.press("e");
  await page.clock.runFor(150);
  await expect(river.getByText("Lamp oil × 6")).toBeVisible();
  await expect(river.getByRole("status").filter({ hasText: "Salvaged 6 from the wreck of the freight barge" })).toBeVisible();
  await page.keyboard.down("s");
  for (let i = 0; i < 160 && !(await river.getByRole("button", { name: /Moor at The Landing/ }).isVisible()); i++) await page.clock.runFor(150);
  await page.keyboard.up("s");
  await page.keyboard.press("e");
  await page.clock.runFor(400);
  await expect(river).toHaveCount(0);
  await page.clock.resume();
  await page.keyboard.press("Escape");
  await openDrawer(page);
  await expect(page.getByLabel("Wrecks on the river")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await button("Journal").click();
  await expect(page.getByText(/salvaged 6 lamp oil from the wreck of the freight barge on Heron Reach/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("posts a Bell order in a live room and a rival hauler delivers it", async ({ page }) => {
  test.setTimeout(200_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Live market", exact: true }).click();
  await page.getByLabel("Display name").fill("Bell captain");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Create private room" }).click();
  await expect(page.locator("[data-room-code]")).toBeVisible();
  await openDrawer(page);
  await page.getByRole("button", { name: "Post an order" }).click();
  await page.getByLabel("Order item").selectOption("oil");
  await page.getByLabel("Order quantity").fill("2");
  await page.getByLabel("Price per unit").fill("12");
  await expect(page.getByText("Reserve 24 coins")).toBeVisible();
  await page.getByRole("button", { name: /^Ring the bell/ }).click();
  const order = page.getByLabel("Your Bell order");
  await expect(order).toContainText("2 lamp oil at 12 coins each");
  await expect(order).toContainText("24 coins held at the Harbor Bell");
  // A rival weighs the job on its next turn, sails upriver and back.
  await expect(order).toContainText(/is hauling 2/, { timeout: 120_000 });
  await expect(order).toContainText("2 delivered", { timeout: 90_000 });
  await expect(order).toContainText("0 coins held");
  expect(errors).toEqual([]);
});

test("buys visible barge tiers and finishes, refits free, reloads and casts off with the fitted look", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  await page.goto("/");
  await button("Start").click();
  const save = execFileSync(process.execPath, [join("node_modules", "tsx", "dist", "cli.mjs"), join("tests", "e2e", "fixtures", "barge-looks-save.ts")]);
  page.on("dialog", dialog => void dialog.accept());
  await openSettings(page);
  await page.locator('input[type="file"]').setInputFiles({ name: "looks.json", mimeType: "application/json", buffer: save });
  await expect(page.getByText("NIGHT 04")).toBeVisible();
  await page.keyboard.press("Escape");
  await openDrawer(page);
  const preview = page.getByRole("img", { name: "Barge preview" });
  const pixels = () => preview.evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL());
  let previous = await pixels();
  await page.getByText("Barge upgrades", { exact: true }).click();
  for (const [name, feature] of [["Hold I", "Deck crates"], ["Hold II", "Two cargo rows"], ["Hull I", "Iron bands"],
    ["Hull II", "Full plating"], ["Cannon I", "Heavy mount"], ["Cannon II", "Twin barrels"],
    ["Engine I", "Twin stacks"], ["Engine II", "Stern paddle wheel"]]) {
    await page.getByRole("button", { name: new RegExp("^" + name + " ·") }).click();
    await expect(page.getByLabel("Visible barge upgrades")).toContainText(feature!);
    const current = await pixels();
    expect(current).not.toBe(previous); previous = current;
  }
  await page.getByText("Paint, lantern & prow", { exact: true }).click();
  await page.getByLabel("Hull paint", { exact: true }).selectOption("indigo");
  await button("Buy Indigo · 35 coins").click();
  await expect(button("Fitted Indigo")).toBeDisabled();
  await page.getByLabel("Bow lantern", { exact: true }).selectOption("violet");
  await button("Buy Violet · 25 coins").click();
  await page.getByLabel("Prow figure", { exact: true }).selectOption("heron");
  await button("Buy Heron · 30 coins").click();
  await expect(button("Fitted Heron")).toBeDisabled();
  await preview.screenshot({ path: "test-results/barge-w7-preview.png" });
  const fitted = await pixels();
  await page.getByLabel("Bow lantern", { exact: true }).selectOption("amber");
  await button("Fit Amber").click();
  await expect(button("Fitted Amber")).toBeDisabled();
  await page.getByLabel("Bow lantern", { exact: true }).selectOption("violet");
  await button("Fit Violet").click();
  await page.reload(); await button("Continue").click();
  await openDrawer(page);
  await expect(preview).toBeVisible();
  expect(await pixels()).toBe(fitted);
  await page.getByText("Paint, lantern & prow", { exact: true }).click();
  await expect(button("Fitted Indigo")).toBeDisabled();
  await expect(button("Fitted Violet")).toBeDisabled();
  await expect(button("Fitted Heron")).toBeDisabled();
  await page.getByRole("button", { name: /^Cast off/ }).click();
  const river = page.getByRole("region", { name: "River Run" });
  await expect(river).toBeVisible();
  await river.screenshot({ path: "test-results/barge-w7-river.png" });
  await river.getByRole("button", { name: /Moor at The Landing/ }).click();
  await expect(river).toHaveCount(0);
  expect(errors).toEqual([]);
});


test("a trusted hauler sees the village stamp and pays the discounted quote", async ({ page }) => {
  test.setTimeout(100000);
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  await page.goto("/"); await button("Start").click();
  const save = execFileSync(process.execPath, [join("node_modules", "tsx", "dist", "cli.mjs"), join("tests", "e2e", "fixtures", "trusted-save.ts")]);
  page.on("dialog", dialog => void dialog.accept());
  await openSettings(page);
  await page.locator('input[type="file"]').setInputFiles({ name: "trusted.json", mimeType: "application/json", buffer: save });
  await expect(page.getByText("NIGHT 03")).toBeVisible();
  await page.clock.install(); await page.keyboard.press("Escape");
  await openDrawer(page);
  await expect(page.getByLabel("Upriver prices")).toContainText("Trusted: 10% off");
  await page.getByRole("button", { name: /^Cast off/ }).click();
  const river = page.getByRole("region", { name: "River Run" });
  await expect(river).toBeVisible();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  for (const key of ["w", "Shift", " "]) await page.keyboard.down(key);
  await page.clock.runFor(7100);
  await page.keyboard.down("d");
  const trade = river.getByRole("button", { name: /Trade at Reedmarsh/ });
  for (let i = 0; i < 160 && !(await trade.isVisible()); i++) await page.clock.runFor(200);
  for (const key of ["w", "d", "Shift", " "]) await page.keyboard.up(key);
  await expect(trade).toBeVisible(); await page.keyboard.press("e");
  const market = page.getByRole("dialog", { name: "Village market" });
  await expect(market.getByText("Trusted hauler · 10% off village purchases", { exact: true })).toBeVisible();
  const reed = market.locator(".river-trade").filter({ hasText: "Reed frame" });
  const buy = reed.getByRole("button", { name: /^Buy 5/ });
  await expect(buy).toBeEnabled();
  const quote = (await buy.innerText()).match(/(\d+)\s*$/);
  expect(quote).not.toBeNull();
  await buy.click(); await page.clock.runFor(100);
  await expect(river.getByRole("status").filter({ hasText: "Loaded 5 Reed frame · " + quote![1] + " coins" })).toBeVisible();
  await page.screenshot({ path: "test-results/river-w8-trust.png" });
});


test("Night 4 schedules Floodtide with the Firefly and returns through both lock gates", async ({ page }) => {
  test.setTimeout(150000);
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  await page.goto("/"); await button("Start").click();
  const save = execFileSync(process.execPath, [join("node_modules", "tsx", "dist", "cli.mjs"), join("tests", "e2e", "fixtures", "floodtide-save.ts")]);
  page.on("dialog", dialog => void dialog.accept());
  await openSettings(page);
  await page.locator('input[type="file"]').setInputFiles({ name: "floodtide.json", mimeType: "application/json", buffer: save });
  await expect(page.getByText("NIGHT 04")).toBeVisible();
  await page.clock.install(); await page.keyboard.press("Escape");
  await openDrawer(page);
  await expect(page.getByLabel("Floodtide forecast")).toContainText("1:10");
  await page.locator(".dock-job").filter({ hasText: "3 dye from Reedmarsh" }).getByRole("button", { name: "Accept", exact: true }).click();
  await page.getByRole("button", { name: /^Cast off for Reedmarsh/ }).click();
  const river = page.getByRole("region", { name: "River Run" });
  await expect(river).toBeVisible();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const sail = async (keys: string[], ms: number) => {
    for (const key of keys) await page.keyboard.down(key);
    await page.clock.runFor(ms);
    for (const key of keys) await page.keyboard.up(key);
  };
  await sail(["w", "Shift", " "], 7100);
  for (const key of ["w", "d", "Shift", " "]) await page.keyboard.down(key);
  const trade = river.getByRole("button", { name: /Trade at Reedmarsh/ });
  for (let i = 0; i < 160 && !(await trade.isVisible()); i++) await page.clock.runFor(200);
  for (const key of ["w", "d", "Shift", " "]) await page.keyboard.up(key);
  await expect(trade).toBeVisible(); await page.keyboard.press("e");
  const market = page.getByRole("dialog", { name: "Village market" });
  await market.locator(".river-trade").filter({ hasText: "Dye" }).getByRole("button", { name: /^Buy 5/ }).click();
  await page.clock.runFor(100);
  await button("Back to the barge").click();
  for (let i = 0; i < 50 && !(await river.getByLabel("Floodtide locks").isVisible()); i++) await page.clock.runFor(500);
  await expect(river.getByLabel("Floodtide locks")).toHaveText("Floodtide locks: 0 / 2");
  await page.screenshot({ path: "test-results/river-w9-floodtide.png" });
  await sail(["s", "a", "Shift"], 16000);
  await expect(river.getByLabel("Floodtide locks")).toHaveText("Floodtide locks: 1 / 2");
  await page.screenshot({ path: "test-results/river-w9-gate.png" });
  await page.keyboard.down("s"); await page.keyboard.down("Shift");
  for (let i = 0; i < 100 && await river.isVisible(); i++) await page.clock.runFor(200);
  await page.keyboard.up("s"); await page.keyboard.up("Shift");
  await expect(river).toHaveCount(0);
  await page.clock.resume(); await page.keyboard.press("Escape");
  await button("Journal").click();
  await expect(page.getByText(/passed both Floodtide locks and brought the barge home/).first()).toBeVisible();
});
