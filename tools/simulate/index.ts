import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { finished } from "node:stream/promises";
import { parseArgs } from "node:util";
import { items, type ItemId } from "@lantern/content";
import { addTrader, advanceClock, createWorld, newNight, openNight, snapshotFor } from "@lantern/game-core";

const { values } = parseArgs({ options: { nights: { type: "string", default: "200" }, seed: { type: "string", default: "42" },
  traders: { type: "string", default: "3" }, "check": { type: "boolean", default: false } } });
const nights = Number(values.nights);
const seed = Number(values.seed);
const count = Number(values.traders);
if (!Number.isSafeInteger(nights) || nights < 1 || nights > 10000 || !Number.isSafeInteger(seed) || seed < 0 || seed > 2147483647 ||
    !Number.isSafeInteger(count) || count < 0 || count > 4) throw new Error("Use 1–10000 nights, a nonnegative 32-bit seed, and 0–4 traders.");

await mkdir("sim-output", { recursive: true });
const csv = createWriteStream(`sim-output/${seed}.csv`);
csv.write("night,seconds,stall,coins,item,price,strategy,boats\n");
let world = createWorld("live", seed);
if (count === 4) world = addTrader(world, "r:ivy", "Ivy");
for (const actor of Object.keys(world.traders).slice(count)) {
  delete world.traders[actor];
}
const report = { seed, nights, traders: count, closures: 0, rescues: 0, expansions: 0, buybacks: 0, boats: 0, stableNights: 0,
  priceMin: Infinity, priceMax: 0, merchantCoinMin: Infinity, merchantCoinMax: 0, maxDarkStreak: 0, invariantErrors: 0,
  strategyWins: { steady: 0, bold: 0, bargain: 0, festival: 0 } };
const streaks = new Map<string, number>();
for (let night = 1; night <= nights; night++) {
  world = openNight(world);
  for (let elapsed = 10; elapsed <= 300; elapsed += 10) {
    world = advanceClock(world, elapsed);
    const view = snapshotFor(world, "sim", "");
    const boats = view.orders.filter(order => order.state === "filled").length;
    let lines = "";
    for (const [stall, merchant] of Object.entries(view.merchants)) {
      for (const [item, hint] of Object.entries(merchant.prices)) {
        const price = Number(hint.buy);
        report.priceMin = Math.min(report.priceMin, price);
        report.priceMax = Math.max(report.priceMax, price);
        if (!Number.isSafeInteger(price) || price < 2 || price > items[item as ItemId].price * 3) report.invariantErrors++;
        lines += `${night},${elapsed},${stall},${merchant.coins},${item},${price},${merchant.strategy},${boats}\n`;
      }
      const supply = Object.values(world.ledger).reduce((sum, assets) => sum + (assets["share:" + stall] ?? 0), 0);
      if (supply > 20) report.invariantErrors++;
    }
    if (!csv.write(lines)) await new Promise<void>(resolve => csv.once("drain", resolve));
    for (const assets of Object.values(world.ledger)) {
      if (Object.values(assets).some(value => !Number.isSafeInteger(value) || value < 0)) report.invariantErrors++;
    }
  }
  const view = snapshotFor(world, "sim", "");
  const merchants = Object.entries(view.merchants);
  const strategies = new Map<keyof typeof report.strategyWins, number[]>();
  for (const [stall, merchant] of merchants) {
    const streak = merchant.band === "dark" ? (streaks.get(stall) ?? 0) + 1 : 0;
    streaks.set(stall, streak);
    report.maxDarkStreak = Math.max(report.maxDarkStreak, streak);
    if (stall !== "lantern_house" && merchant.shareholders.length) {
      const dividends = strategies.get(merchant.strategy) ?? [];
      dividends.push(Number(merchant.dividendHistory.at(-1) ?? 0));
      strategies.set(merchant.strategy, dividends);
    }
  }
  const scored = [...strategies].map(([strategy, dividends]) =>
    [strategy, dividends.reduce((a, b) => a + b, 0) / dividends.length] as const).sort((a, b) => b[1] - a[1]);
  if (scored[0] && scored[0][1] > (scored[1]?.[1] ?? 0)) report.strategyWins[scored[0][0]]++;
  const coins = merchants.reduce((total, [, merchant]) => total + Number(merchant.coins), 0);
  report.merchantCoinMin = Math.min(report.merchantCoinMin, coins);
  report.merchantCoinMax = Math.max(report.merchantCoinMax, coins);
  if (merchants.filter(([, merchant]) => merchant.band !== "dark").length >= 3) report.stableNights++;
  const entries = world.activity.filter(entry => entry.night === night);
  report.closures += entries.filter(entry => entry.line.includes("went dark")).length;
  report.rescues += entries.filter(entry => entry.line.includes("relit!")).length;
  report.expansions += entries.filter(entry => entry.line.includes("opened an expansion")).length;
  report.buybacks += entries.filter(entry => entry.line.includes("Buyback")).length;
  report.boats += view.orders.filter(order => order.state === "filled").length;
  if (night < nights) world = newNight(world);
}
csv.end();
await finished(csv);
const json = JSON.stringify(report, null, 2);
await writeFile(`sim-output/${seed}.json`, json + "\n");
console.log(json);
if (values.check && (report.invariantErrors || report.maxDarkStreak > 5 || report.stableNights / nights < .95 ||
    report.merchantCoinMin < 50 || report.merchantCoinMax > 500)) process.exitCode = 1;
