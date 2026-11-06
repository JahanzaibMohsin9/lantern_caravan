import { expect, test, type Page } from "@playwright/test";

async function identify(page: Page, name: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Live market", exact: true }).click();
  await page.getByLabel("Display name").fill(name);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Join The Row", exact: true })).toBeVisible();
}

test("two browser sessions contest an order and see the same lit boat", async ({ browser }) => {
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
    for (const page of [a, b]) {
      const workshop = page.getByRole("navigation").getByRole("button", { name: /Workshop/ });
      await expect(workshop).toBeEnabled({ timeout: 37000 });
      await workshop.click();
      await page.getByRole("button", { name: "Craft one", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: /Craft / })).toBeVisible();
      await page.getByRole("navigation").getByRole("button", { name: /Order Board/ }).click();
      await expect(page.getByRole("heading", { name: "Order Board" })).toBeVisible();
    }
    const attempts = await Promise.allSettled([a, b].map(page => page.locator(".order-row").filter({ hasText: "The Heron" })
      .getByRole("button", { name: "Deliver 1", exact: true }).click({ timeout: 3500 })));
    expect(attempts.some(attempt => attempt.status === "fulfilled")).toBe(true);
    for (const page of [a, b]) {
      await expect(page.locator(".order-row").filter({ hasText: "The Heron" }).getByText("Lit", { exact: true })).toBeVisible();
    }
    const wallets = await Promise.all([a, b].map(page => page.locator(".meter.gold b").innerText()));
    expect(wallets.sort()).toEqual(["30", "40"]);
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


test("an unsigned watcher sees a departing barge, village history and reach danger", async ({ browser }) => {
  test.setTimeout(90000);
  const captain = await browser.newContext(), observer = await browser.newContext();
  try {
    const a = await captain.newPage(), watch = await observer.newPage();
    const name = "Hauler " + Math.random().toString(16).slice(2, 8);
    await identify(a, name);
    await a.getByRole("button", { name: "Join The Row", exact: true }).click();
    await a.getByRole("navigation").getByRole("button", { name: /The Landing/ }).click();
    await a.getByRole("button", { name: "Barge", exact: true }).click();
    await a.getByRole("button", { name: /^Cast off/ }).click();
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
