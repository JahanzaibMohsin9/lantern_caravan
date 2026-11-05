import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";

export async function playCampaign(page: Page) {
  const capture = async (name: string) => {
    if (process.env.LANTERN_CAPTURE_DIR && page.context().browser()?.browserType().name() === "chromium") {
      await page.screenshot({ path: join(process.env.LANTERN_CAPTURE_DIR, name + ".png") });
    }
  };
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  const heading = (name: string) => page.getByRole("heading", { name, exact: true });
  const visit = async (name: string) => {
    await page.getByRole("navigation").getByRole("button", { name: new RegExp(name, "i") }).click();
    await expect(heading(name)).toBeVisible();
  };
  const buy = async (stall: string, item: string, count = 1) => {
    await visit(stall);
    await page.locator(".panel").getByRole("button", { name: new RegExp("^" + item, "i") }).click();
    for (let i = 1; i < count; i++) await button("Increase quantity").click();
    await button("Review buy").click();
    await button("Confirm buy").click();
    await expect(button("Review buy")).toBeVisible();
  };
  const craft = async (kind = "Paper", count = 1) => {
    await visit("Workshop");
    if (await button(kind).count()) await button(kind).click();
    await button(count > 1 ? "Craft " + count : "Craft one").click();
    await expect(page.getByRole("status").filter({ hasText: /Craft / })).toBeVisible();
  };
  const fill = async (boat: string, n: number) => {
    const row = page.locator(".order-row").filter({ hasText: boat });
    await row.getByRole("button", { name: "Deliver " + n }).click();
    await expect(row.getByText("Lit", { exact: true })).toBeVisible();
  };
  const close = async () => {
    await page.keyboard.press("Escape");
    await button("Close the night").click();
    await expect(page.getByLabel("Night results")).toBeVisible();
  };

  await page.goto("/");
  await expect(button("Enter the Row")).toBeEnabled();
  await page.locator("canvas").waitFor();
  await page.evaluate(() => document.fonts.ready);
  await capture("the-row");
  await button("Enter the Row").click();
  await craft("Paper", 2);
  await buy("Paper Mill", "Paper");
  await buy("Oil Wharf", "Lamp oil");
  await craft();
  await visit("Order Board");
  await fill("The Heron", 1);
  await fill("The Kingfisher", 2);
  await close();
  await button("Next night").click();

  await expect(heading("The Dark Wharf")).toBeVisible();
  await page.locator(".order-row").filter({ hasText: "Cart I" }).getByRole("button").click();
  await button("Open the market").click();
  await visit("Oil Wharf");
  await button("Pledge 2 · 10 coins").click();
  await expect(page.getByText(/Dividends depend on profit/)).toBeVisible();
  await capture("dark-wharf");
  await button("Confirm pledge · 10 coins").click();
  await expect(page.getByRole("status").filter({ hasText: /Oil Wharf relit/ })).toBeVisible();
  await buy("Paper Mill", "Paper", 2);
  await buy("Oil Wharf", "Lamp oil", 2);
  await craft("Paper", 2);
  await visit("Order Board");
  await fill("The Kingfisher", 2);
  await buy("Paper Mill", "Paper", 2);
  await buy("Oil Wharf", "Lamp oil", 2);
  await buy("Reed & Thread", "Reed frame", 2);
  await craft("Floating", 2);
  await visit("Order Board");
  await fill("The Heron", 2);
  await close();
  await expect(page.getByText("Dividends", { exact: true })).toBeVisible();
  await button("Next night").click();

  await expect(heading("Festival of Lights")).toBeVisible();
  await page.getByRole("combobox", { name: "Oil Wharf strategy" }).selectOption("festival");
  await expect(page.getByRole("status").filter({ hasText: "Vote · Festival" })).toBeVisible();
  await button("Open the market").click();
  await buy("Paper Mill", "Paper", 2);
  await buy("Oil Wharf", "Lamp oil", 2);
  await craft();
  await visit("Order Board");
  await page.getByLabel("Attach a wish").selectOption("May the river be kind");
  await fill("The Heron", 1);
  await buy("Reed & Thread", "Reed frame");
  await craft("Floating");
  await visit("Order Board");
  await fill("The Kingfisher", 1);
  await buy("Paper Mill", "Paper");
  await buy("Oil Wharf", "Lamp oil");
  await buy("Reed & Thread", "Cord");
  await buy("Indigo Atelier", "Dye");
  await craft("Color");
  await visit("Order Board");
  await fill("The Swallow", 1);

  await page.keyboard.press("Escape");
  await expect(button("Close the night")).toBeVisible({ timeout: 115000 });
  await button("Close the night").click();
  await expect(heading("Master of the Row")).toBeVisible();
  await expect(page.getByLabel("6 of 6 boats lit")).toBeVisible();
  if (process.env.LANTERN_CAPTURE_DIR) {
    await page.waitForTimeout(950);
    await capture("festival");
    if (process.env.LANTERN_RECORD) await page.waitForTimeout(8500);
  }
  await page.reload();
  await button("Continue").click();
  await expect(heading("Master of the Row")).toBeVisible();
  await button("Play Endless").click();
  await expect(heading("Afterglow")).toBeVisible();
}

test("plays the campaign from first lantern to the ending and resumes it", async ({ page }) => {
  test.setTimeout(220000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await playCampaign(page);
  expect(errors).toEqual([]);
});
