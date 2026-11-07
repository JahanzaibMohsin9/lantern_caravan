import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";

/** Plays all four river nights from the Dock: haul, relight the wharf, clear the reach, ride the Floodtide. */
export async function playCampaign(page: Page) {
  const capture = async (name: string) => {
    if (process.env.LANTERN_CAPTURE_DIR && page.context().browser()?.browserType().name() === "chromium") {
      await page.screenshot({ path: join(process.env.LANTERN_CAPTURE_DIR, name + ".png") });
    }
  };
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  const heading = (name: string) => page.getByRole("heading", { name, exact: true });
  const dock = page.getByRole("region", { name: "The Dock" });
  const river = page.getByRole("region", { name: "River Run" });
  const market = page.getByRole("dialog", { name: "Village market" });
  const hold = async (keys: string[], until: () => Promise<boolean>, steps = 160) => {
    for (const key of keys) await page.keyboard.down(key);
    for (let i = 0; i < steps && !(await until()); i++) await page.clock.runFor(200);
    for (const key of keys) await page.keyboard.up(key);
  };
  const sail = async (keys: string[], ms: number) => {
    for (const key of keys) await page.keyboard.down(key);
    await page.clock.runFor(ms);
    for (const key of keys) await page.keyboard.up(key);
  };
  const castOff = async (to = "") => {
    await dock.getByRole("button", { name: new RegExp("^Cast off" + (to ? " for " + to : "")) }).click();
    await expect(river).toBeVisible();
  };
  /** Pick an order size (1, 5 or 10), then buy as many of the good as that size allows. */
  const buy = async (item: string, size: number) => {
    await market.getByLabel("Order size").getByRole("button", { name: String(size), exact: true }).click();
    await market.locator(".river-trade").filter({ hasText: item }).getByRole("button", { name: /^Buy \d/ }).click();
    await page.clock.runFor(150);
  };
  const moor = async () => {
    const moor = river.getByRole("button", { name: /Moor at The Landing/ });
    await hold(["s", "Shift", " "], () => moor.isVisible());
    await expect(moor).toBeVisible();
    await page.keyboard.press("e");
    await page.clock.runFor(400);
    await expect(river).toHaveCount(0);
  };
  /** Ember Falls is straight up the river from the Landing. */
  const emberFalls = async (size: number) => {
    const trade = river.getByRole("button", { name: /Trade at Ember Falls/ });
    await hold(["w", "Shift", " "], () => trade.isVisible());
    await expect(trade).toBeVisible();
    await page.keyboard.press("e");
    await expect(market.getByRole("heading", { name: "Ember Falls" })).toBeVisible();
    await buy("Lamp oil", size);
    await expect(river.getByText(/Lamp oil × \d/)).toBeVisible();
    await button("Back to the barge").click();
  };
  /** Up Heron Reach, through the boom at Marsh Bend, to Reedmarsh. */
  const reedmarsh = async () => {
    await sail(["w", "Shift", " "], 7_100);
    const trade = river.getByRole("button", { name: /Trade at Reedmarsh/ });
    await hold(["w", "d", "Shift", " "], () => trade.isVisible());
    await expect(trade).toBeVisible();
    await page.keyboard.press("e");
    await expect(market.getByRole("heading", { name: "Reedmarsh" })).toBeVisible();
  };
  /** Sell everything in the hold, best buyer first, until tonight's goal is done. */
  const sellHaul = async () => {
    const sell = dock.getByLabel("Sell your haul").getByRole("button", { name: /^Sell \d+/ });
    for (let i = 0; i < 12 && !(await heading("Night complete").isVisible()); i++) {
      await sell.first().click();
      await page.waitForTimeout(150);
    }
    await expect(dock.getByRole("heading", { name: "Night complete" })).toBeVisible();
  };
  const closeNight = async () => {
    await dock.getByRole("button", { name: "Close the night" }).click();
    await expect(page.getByLabel("Night results")).toBeVisible();
  };

  await page.goto("/");
  await expect(button("Start")).toBeEnabled();
  await page.locator("canvas").waitFor();
  await page.evaluate(() => document.fonts.ready);
  await capture("the-row");
  await page.clock.install();
  await button("Start").click();

  // Night 1: one run upriver, then sell the haul to the Row.
  await expect(dock.getByRole("heading", { name: "Your first haul" })).toBeVisible();
  await expect(dock.getByRole("status")).toContainText("Cast off");
  await capture("dock");
  await castOff();
  await emberFalls(10);
  await moor();
  await expect(dock.getByText("River run 1/1")).toBeVisible();
  await sellHaul();
  await closeNight();
  await button("Next night").click();

  // Night 2: the wharf is dark; the Harbor Bell asks for a relief haul.
  await expect(dock.getByRole("heading", { name: "Relight the wharf" })).toBeVisible();
  const relief = dock.locator(".dock-job.relief").filter({ hasText: "Relight Oil Wharf" });
  await relief.getByRole("button", { name: "Accept" }).click();
  await castOff("Ember Falls");
  await emberFalls(5);
  await moor();
  await expect(page.getByText("Oil Wharf relit!")).toBeVisible();
  await expect(dock.getByRole("heading", { name: "Night complete" })).toBeVisible();
  await closeNight();
  await button("Next night").click();

  // Night 3: break the pirates' boom and deliver the dye contract.
  await expect(dock.getByRole("heading", { name: "Clear the reach" })).toBeVisible();
  await dock.locator(".dock-job").filter({ hasText: "3 dye from Reedmarsh" }).getByRole("button", { name: "Accept" }).click();
  await castOff("Reedmarsh");
  await reedmarsh();
  for (let i = 0; i < 3; i++) await buy("Dye", 1);
  await button("Back to the barge").click();
  await sail(["s", "a", "Shift", " "], 16_000);
  await moor();
  await expect(dock.getByRole("heading", { name: "Night complete" })).toBeVisible();
  await closeNight();
  await button("Next night").click();

  // Night 4: buy upriver, then race the Floodtide home through both lock gates and sell.
  await expect(dock.getByRole("heading", { name: "Ride the Floodtide" })).toBeVisible();
  await castOff();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await reedmarsh();
  await buy("Dye", 5);
  await buy("Reed frame", 5);
  await button("Back to the barge").click();
  // The Floodtide comes 70 seconds into the night.
  for (let i = 0; i < 120 && !(await river.getByLabel("Floodtide locks").isVisible()); i++) await page.clock.runFor(500);
  await expect(river.getByLabel("Floodtide locks")).toHaveText("Floodtide locks: 0 / 2");
  await sail(["s", "a", "Shift"], 16_000);
  await expect(river.getByLabel("Floodtide locks")).toHaveText("Floodtide locks: 1 / 2");
  await hold(["s", "Shift"], async () => !(await river.isVisible()), 100);
  await expect(river).toHaveCount(0);
  await page.clock.resume();
  await expect(dock.getByText("Home through Floodtide 1/1")).toBeVisible();
  await sellHaul();
  await closeNight();
  await expect(heading("Master of the Row")).toBeVisible();
  if (process.env.LANTERN_CAPTURE_DIR) {
    await page.waitForTimeout(950);
    await capture("festival");
    if (process.env.LANTERN_RECORD) await page.waitForTimeout(8500);
  }
  await page.reload();
  await button("Continue").click();
  await expect(heading("Master of the Row")).toBeVisible();
  await button("Play Endless").click();
  await expect(dock.getByRole("heading", { name: "Keep the Row supplied" })).toBeVisible();
}

test("plays the four river nights from the Dock to the ending and resumes it", async ({ page }) => {
  test.setTimeout(480000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await playCampaign(page);
  expect(errors).toEqual([]);
});
