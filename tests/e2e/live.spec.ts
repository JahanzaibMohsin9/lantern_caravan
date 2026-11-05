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
