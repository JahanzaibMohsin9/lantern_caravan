import { expect, test, type Page } from "@playwright/test";

async function identify(page: Page, name: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Live market", exact: true }).click();
  await page.getByLabel("Display name").fill(name);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Join The Row", exact: true })).toBeVisible();
}

test("two browser sessions share one Row: a sale at the Dock shows on the other captain's stall", async ({ browser }) => {
  test.setTimeout(100000);
  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    const a = await first.newPage();
    const b = await second.newPage();
    const salt = Math.random().toString(16).slice(2, 8);
    await Promise.all([identify(a, "Ari " + salt), identify(b, "Bo " + salt)]);
    await a.getByRole("button", { name: "Create private room" }).click();
    await expect(a.locator("[data-room-code]")).toBeVisible();
    const code = await a.locator("[data-room-code]").getAttribute("data-room-code");
    await b.getByRole("textbox", { name: "Room code" }).fill(code!);
    await b.getByRole("button", { name: "Join", exact: true }).click();
    await expect(b.locator("[data-room-code]")).toHaveAttribute("data-room-code", code!);
    // Ari sells the starter oil from the Dock once the market opens.
    const oil = a.getByRole("region", { name: "The Dock" }).getByLabel("Sell your haul").locator(".dock-hold").filter({ hasText: "Lamp oil" });
    const sell = oil.getByRole("button", { name: /^Sell \d/ });
    await expect(sell).toBeEnabled({ timeout: 37000 });
    const buyer = (await oil.locator("small").innerText()).match(/^(.+?) pays/)![1]!;
    const coins = Number(await a.locator(".meter.gold b").innerText());
    await sell.click();
    await expect.poll(async () => Number(await a.locator(".meter.gold b").innerText())).toBeGreaterThan(coins);
    // Bo opens the same stall from the Dock and sees who supplied it tonight.
    await b.getByRole("region", { name: "The Dock" }).locator(".dock-merchant").filter({ hasText: buyer }).click();
    await b.getByRole("button", { name: "Ownership", exact: true }).click();
    await expect(b.getByText(new RegExp("Supplied tonight by .*Ari " + salt))).toBeVisible();
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});

test("watch and history open without sign-in", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Watch", exact: true }).click();
  await expect(page.getByTitle("Spectator")).toBeVisible();
  await page.keyboard.press("h");
  await expect(page.getByRole("heading", { name: "Market History" })).toBeVisible();
  await expect(page.getByText("Chronicle", { exact: true }).last()).toBeVisible();
});

test("Verify on NEAR opens from the title without sign-in", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Verify on NEAR" }).click();
  await expect(page.getByRole("heading", { name: "Verify on NEAR" })).toBeVisible();
  await expect(page.getByText("RECENT PLAYER TRADES")).toBeVisible();
  // The test server settles locally, so there are no chain receipts to list.
  await expect(page.getByText("No player trades yet.", { exact: false })).toBeVisible();
});


test("an unsigned watcher sees a departing barge, village history and reach danger", async ({ browser }) => {
  test.setTimeout(90000);
  const captain = await browser.newContext(), observer = await browser.newContext();
  try {
    const a = await captain.newPage(), watch = await observer.newPage();
    const name = "Hauler " + Math.random().toString(16).slice(2, 8);
    await identify(a, name);
    await a.getByRole("button", { name: "Join The Row", exact: true }).click();
    await a.getByRole("region", { name: "The Dock" }).getByRole("button", { name: /^Cast off/ }).click();
    await expect(a.getByRole("region", { name: "River Run" })).toBeVisible();
    await watch.goto("/"); await watch.getByRole("button", { name: "Watch", exact: true }).click();
    const strip = watch.getByRole("complementary", { name: "River watch" });
    await expect(strip).toContainText(name + " · Upriver");
    await expect(strip).toContainText("Heron Reach");
    await expect(strip).toContainText("Ember Falls");
    await watch.screenshot({ path: "test-results/river-w8-watch.png" });
    await watch.keyboard.press("h");
    await watch.getByRole("button", { name: "Villages", exact: true }).click();
    await watch.getByLabel("Village", { exact: true }).selectOption("ember_falls");
    await expect(watch.getByRole("img", { name: /^Village coins, range/ })).toBeVisible();
    await expect(watch.getByRole("img", { name: /^Lamp oil source ask, range/ })).toBeVisible();
    await expect(watch.getByRole("img", { name: /^Lamp oil village stock, range/ })).toBeVisible();
    await watch.getByRole("button", { name: "Reaches", exact: true }).click();
    await watch.getByLabel("Reach", { exact: true }).selectOption("marsh_bend");
    await expect(watch.getByRole("img", { name: /^Reach danger, range/ })).toBeVisible();
    await expect(watch.getByRole("img", { name: /^Boom present, range/ })).toBeVisible();
    await watch.screenshot({ path: "test-results/river-w8-history.png" });
    await watch.keyboard.press("Escape");
    await a.keyboard.press("e");
    await expect(a.getByRole("region", { name: "River Run" })).toHaveCount(0);
    await expect(strip).toContainText(name + " · At the Row");
  } finally { await Promise.all([captain.close(), observer.close()]); }
});
