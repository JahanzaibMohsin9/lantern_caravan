import { describe, expect, test } from "vitest";
import { landing, pirateRoleCaps, pirateRoles, reachIds, reaches, villages, type BargeTrimId, type PirateRole } from "@lantern/content/river";
import { tradePrice } from "@lantern/game-core/pricing";
import type { RunManifest } from "@lantern/protocol";
import { createRiver, distance, marketQuote, replayRiver, stepRiver, type Point, type River, type RiverInput } from "./sim";
import { runReport } from "./report";

function manifest(override: Partial<RunManifest> = {}): RunManifest {
  return {
    id: "test-run", seed: 42, deadline: 150000, wallet: 30, hold: 12,
    items: [{ village: "ember_falls", item: "oil", stock: 20, target: 24, coins: 40, discount: false,
      prices: Array.from({ length: 8 }, (_, unit) => tradePrice("buy", 4, 20 - unit, 24, 7000, 1)) }],
    reaches: reachIds.map(id => ({ id, danger: 0, boom: false })),
    boats: [], upgrades: [], bounty: 36, glow: .5, ...override,
  };
}
function advance(state: River, seconds: number, input: RiverInput = {}) {
  for (let frame = 0; frame < seconds * 60 && !state.outcome; frame++) stepRiver(state, input);
}
function steer(state: River, target: Point, radius = 120) {
  for (let i = 0; i < 45 * 60 && distance(state.player, target) > radius && !state.outcome; i++) {
    const { player } = state, range = distance(player, target);
    stepRiver(state, { x: (target.x - player.x) / range, y: (target.y - player.y) / range, boost: true, fire: true });
  }
  expect(distance(state.player, target)).toBeLessThanOrEqual(radius);
}
const order = (side: "buy" | "sell", quantity: number) => ({
  trade: { village: "ember_falls", item: "oil", side, quantity },
});

describe("Caravan Zero engine port", () => {
  test("preserves acceleration, drag, capped cruise speed, and boost fuel use at 60 Hz", () => {
    const coast = createRiver(manifest()), boost = createRiver(manifest());
    advance(coast, 1, { y: -1 });
    advance(boost, 1, { y: -1, boost: true });
    expect(coast.frame).toBe(60);
    expect(Math.abs(coast.player.vy)).toBe(235);
    expect(Math.abs(boost.player.vy)).toBe(345);
    expect(boost.player.fuel).toBeLessThan(coast.player.fuel);
    expect(boost.player.y).toBeLessThan(coast.player.y);
    advance(coast, 1);
    expect(Math.abs(coast.player.vy)).toBeLessThan(3);
  });

  test("requires a village visit, quotes each unit, respects hold, wallet and reservations", () => {
    const s = createRiver(manifest({ hold: 4 }));
    stepRiver(s, order("buy", 4));
    expect(s.player.cargo).toEqual({});
    Object.assign(s.player, villages.ember_falls);
    const quote = marketQuote(s, "ember_falls", "oil", "buy", 8);
    expect(quote).toEqual({ quantity: 4, amount: tradePrice("buy", 4, 20, 24, 7000, 4) });
    stepRiver(s, order("buy", 8));
    expect(marketQuote(s, "ember_falls", "oil", "buy", 1).quantity).toBe(0);
    const sell = marketQuote(s, "ember_falls", "oil", "sell", 2);
    expect(sell.amount).toBe(tradePrice("sell", 4, 20, 24, 7000, 2));
    stepRiver(s, order("sell", 2));
    expect(s.player.cargo.oil).toBe(2);
    expect(s.player.wallet).toBe(30 - quote.amount + sell.amount);
  });

  test.each<BargeTrimId>(["balanced", "runner", "ironclad", "gunner"])("replays %s steering, combat, trade and mooring into the same report", trim => {
    const input = manifest({ trim, reaches: reachIds.map(id => ({ id, danger: id === "heron_reach" ? 2 : 0, boom: false })) });
    const s = createRiver(input);
    steer(s, villages.ember_falls);
    stepRiver(s, order("buy", 5));
    stepRiver(s, order("sell", 1));
    steer(s, landing);
    stepRiver(s, { moor: true });
    const original = runReport(s);
    expect(original.delivered).toEqual({ oil: 4 });
    expect(original.pirates[0]?.count).toBeGreaterThan(0);
    expect(runReport(replayRiver(input, s.log, s.frame))).toEqual(original);
    expect(runReport(replayRiver(input, structuredClone(s.log), s.frame))).toEqual(original);
  });
});

describe("barge trims", () => {
  test.each([
    ["balanced", 1, 1, 1, 1, 1], ["runner", 1.15, .85, 1, 1, 1],
    ["ironclad", .85, 1, .75, 1, 1], ["gunner", 1, 1, 1, 1.2, 1.2],
  ] as const)("%s applies its movement, damage, protection, cadence and fuel modifiers once", (trim, speed, damage, incoming, rate, fuel) => {
    for (const boost of [false, true]) {
      const s = createRiver(manifest({ trim, upgrades: ["engine_i"] }));
      const base = createRiver(manifest({ upgrades: ["engine_i"] }));
      // Isolate engine consumption from the seeded floating fuel pickups.
      s.barrels = []; base.barrels = [];
      advance(s, 1, { y: -1, boost }); advance(base, 1, { y: -1, boost });
      expect(s.player.vy / base.player.vy).toBeCloseTo(speed, 9);
      expect((landing.y - s.player.y) / (landing.y - base.player.y)).toBeCloseTo(speed, 9);
      // Measure fuel at cruising speed, after acceleration stops affecting consumption.
      const priorFuel = s.player.fuel, baseFuel = base.player.fuel;
      advance(s, 1, { y: -1, boost }); advance(base, 1, { y: -1, boost });
      expect((priorFuel - s.player.fuel) / (baseFuel - base.player.fuel)).toBeCloseTo(fuel, 9);
    }
    const turn = createRiver(manifest({ trim }));
    turn.player.angle = 0;
    stepRiver(turn, { y: -1 });
    expect(turn.player.angle).toBeCloseTo(-Math.PI / 2 / 60 * 10 * speed, 9);
    const shot = createRiver(manifest({ trim, upgrades: ["cannon_i"] }));
    stepRiver(shot, { fire: true, aim: { x: landing.x, y: landing.y - 100 } });
    expect(shot.bullets[0]!.damage).toBeCloseTo(26 * damage, 9);
    expect(shot.player.cooldown).toBeCloseTo((.23 - .035) / rate, 9);
    const hull = createRiver(manifest({ trim, upgrades: ["hull_i"] }));
    hull.bullets.push({ ...landing, vx: 0, vy: 0, life: 1, friendly: false, damage: 20 });
    stepRiver(hull);
    expect(hull.player.maxHp - hull.player.hp).toBeCloseTo(20 * .87 * incoming, 9);
    const storm = createRiver(manifest({ trim }));
    Object.assign(storm.player, reaches.heron_reach.to);
    stepRiver(storm, { floodtide: true });
    expect(100 - storm.player.hp).toBeCloseTo(1.7 / 60 * incoming, 9);
  });

  test("Gunner fires more actual shots over the same interval", () => {
    const standard = createRiver(manifest()), gunner = createRiver(manifest({ trim: "gunner" }));
    const input = { fire: true, aim: { x: landing.x, y: landing.y - 100 } };
    advance(standard, 3, input); advance(gunner, 3, input);
    expect(gunner.player.ammo).toBeLessThan(standard.player.ammo);
  });
});

describe("Caravan Zero road port", () => {
  test("a boom blocks the shortcut, can be shelled, and pays once", () => {
    const s = createRiver(manifest({ reaches: [{ id: "heron_reach", danger: 0, boom: true }] }));
    const boom = s.booms[0]!;
    const towardBoom = { y: -1, boost: true };
    advance(s, 7, towardBoom);
    expect(s.player.y).toBeGreaterThan(boom.y + 35);
    expect(s.player.y).toBeLessThan(boom.y + 50);
    advance(s, 3, { ...towardBoom, fire: true });
    expect(s.player.y).toBeLessThan(boom.y);
    expect(s.broken).toEqual(["heron_reach"]);
    expect(s.bounty).toBe(32);
    expect(s.player.wallet).toBe(34);
  });

  test("an oil flare jams threats and cannot be repeated during cooldown", () => {
    const s = createRiver(manifest());
    Object.assign(s.player, villages.ember_falls);
    stepRiver(s, order("buy", 2));
    stepRiver(s, { flare: true });
    advance(s, 2, { flare: true });
    expect(s.flaresUsed).toBe(1);
    expect(s.player.cargo.oil).toBe(1);
    expect(s.flareCooldown).toBeGreaterThan(7);
  });

  test("a sinking spills cargo, with a recovery window and a terminal state", () => {
    for (const recover of [true, false]) {
      const s = createRiver(manifest());
      Object.assign(s.player, villages.ember_falls);
      stepRiver(s, order("buy", 3));
      s.player.hp = 0;
      stepRiver(s);
      const spill = s.drops.find(drop => drop.cargo)!;
      expect(s.player.cargo).toEqual({});
      if (recover) {
        steer(s, spill, 25);
        stepRiver(s, { moor: true });
      } else advance(s, 20);
      expect(runReport(s)).toMatchObject({ outcome: "sunk", delivered: recover ? { oil: 3 } : {},
        lost: recover ? {} : { oil: 3 } });
      const frame = s.frame;
      stepRiver(s, { fire: true });
      expect(s.frame).toBe(frame);
    }
  });

  test("Floodtide checks both lock gates before accepting shelter", () => {
    const s = createRiver(manifest());
    Object.assign(s.player, reaches.heron_reach.to);
    stepRiver(s, { floodtide: true });
    expect(s.floodtide?.gates).toHaveLength(2);
    for (const gate of s.floodtide!.gates) steer(s, gate, 60);
    expect(s.floodtide?.next).toBe(2);
    steer(s, landing);
    expect(s.outcome).toBe("moored");
  });

  test("the 150-second timeout tows the barge with its cargo", () => {
    const s = createRiver(manifest());
    Object.assign(s.player, villages.ember_falls);
    stepRiver(s, order("buy", 3));
    advance(s, 151);
    expect(runReport(s)).toMatchObject({ outcome: "towed", durationMs: 150_000, delivered: { oil: 3 } });
  });
});

describe("Caravan Zero escort port", () => {
  const escorted = () => createRiver(manifest({
    boats: [{ id: "haul-1", name: "Juno", village: "ember_falls", departs: 1, arrives: 41, ambient: false }],
    contract: { id: "escort", village: "ember_falls", item: "oil", quantity: 4, payout: 8, kind: "escort", haul: "haul-1" },
  }));

  test("joining then following the actual haul completes the escort at arrival", () => {
    const s = escorted();
    Object.assign(s.player, villages.ember_falls);
    advance(s, 2);
    for (let i = 0; i < 40 * 60; i++) {
      const boat = s.boats[0]!;
      const range = Math.max(1, distance(s.player, boat));
      stepRiver(s, { x: (boat.x - s.player.x) / range, y: (boat.y - s.player.y) / range });
    }
    expect(s.escort).toBe("completed");
  });

  test("missing the convoy or leaving it for fourteen seconds fails the escort", () => {
    const missed = escorted();
    advance(missed, 22);
    expect(missed.escort).toBe("failed");
    const left = escorted();
    Object.assign(left.player, villages.ember_falls);
    advance(left, 2);
    expect(left.escortJoined).toBe(true);
    Object.assign(left.player, landing);
    advance(left, 14.1);
    expect(left.escort).toBe("failed");
  });
});

describe("River Run additions", () => {
  test("dangerous reaches send an armored gunboat with every third crew", () => {
    const state = createRiver(manifest({ reaches: reachIds.map(id => ({ id, danger: id === "heron_reach" ? 3 : 0, boom: false })) }));
    advance(state, 40);
    const crews = [...state.pirates];
    expect(state.spawned.heron_reach).toBeGreaterThanOrEqual(3);
    expect(crews.some(pirate => pirate.heavy && pirate.maxHp === 96)).toBe(true);
    expect(crews.filter(pirate => !pirate.heavy).every(pirate => pirate.maxHp === pirateRoles[pirate.role].hp)).toBe(true);
  });

  test("floating supplies sit inside the channel and refill the barge once", () => {
    const state = createRiver(manifest());
    expect(state.barrels).toHaveLength(10);
    const fuel = state.barrels.find(barrel => barrel.kind === "fuel")!;
    state.player.fuel = 40;
    state.player.x = fuel.x; state.player.y = fuel.y;
    stepRiver(state, {});
    expect(fuel.taken).toBe(true);
    expect(state.player.fuel).toBeGreaterThanOrEqual(69);
    expect(state.effects.some(effect => effect.kind === "pickup")).toBe(true);
    const before = state.player.fuel;
    stepRiver(state, {});
    expect(state.player.fuel).toBeLessThanOrEqual(before);
  });

  test("a manifest time limit tows the barge early", () => {
    const state = createRiver(manifest({ limitMs: 30_000 }));
    advance(state, 31);
    expect(state.outcome).toBe("towed");
    expect(runReport(state).durationMs).toBe(30_000);
  });
});

describe("skiffs and role bounties", () => {
  test.each([0, 1, 2, 3, 4, 5])("danger %i produces the prescribed mix and replay", danger => {
    const input = manifest({ reaches: [{ id: "ember_cut", danger, boom: false }] });
    const state = createRiver(input);
    advance(state, 150);
    const counts = { skiff: 0, raider: 0, gunboat: 0 };
    for (const pirate of state.pirates) {
      counts[pirate.role]++;
      expect(pirate.hp).toBe(pirateRoles[pirate.role].hp);
    }
    const expected = [
      { skiff: 0, raider: 0, gunboat: 0 }, { skiff: 0, raider: 2, gunboat: 0 },
      { skiff: 1, raider: 3, gunboat: 0 }, { skiff: 2, raider: 2, gunboat: 2 },
      { skiff: 3, raider: 3, gunboat: 2 }, { skiff: 3, raider: 4, gunboat: 3 },
    ][danger];
    expect(counts).toEqual(expected);
    expect(pirateRoleCaps(danger, 150)).toEqual(expected);
    const replay = replayRiver(input, state.log, state.frame);
    expect(replay.pirates).toEqual(state.pirates);
    expect(runReport(replay)).toEqual(runReport(state));
  });

  function encounter(role: PirateRole, gap = 20) {
    const state = createRiver(manifest());
    state.barrels = [];
    state.pirates.push({ x: landing.x, y: landing.y - gap, id: 1, reach: "heron_reach", role, breakoff: 0,
      hp: pirateRoles[role].hp, maxHp: pirateRoles[role].hp, heavy: role === "gunboat", phase: 0, cooldown: 0, angle: 0, stun: 0 });
    return state;
  }

  test.each([true, false])("a skiff rams, breaks off, and accounts for spilled cargo (recover=%s)", recover => {
    const s = encounter("skiff");
    s.player.cargo.oil = 1;
    stepRiver(s);
    expect(s.player.hp).toBe(92);
    expect(s.player.cargo.oil).toBe(0);
    expect(s.pirates[0]!.breakoff).toBeGreaterThan(2);
    const before = distance(s.pirates[0]!, s.player);
    stepRiver(s);
    expect(distance(s.pirates[0]!, s.player)).toBeGreaterThan(before);
    const drop = s.drops.find(drop => drop.cargo)!;
    s.pirates = []; // Isolate one ram's cargo lifecycle.
    if (recover) Object.assign(s.player, { x: drop.x, y: drop.y });
    advance(s, 21);
    expect((s.player.cargo.oil ?? 0) + (s.lost.oil ?? 0)).toBe(1);
    expect(s.lost.oil ?? 0).toBe(recover ? 0 : 1);
    expect(s.drops).toHaveLength(0);
  });

  test("spilled goods cannot overfill a hold when recovered", () => {
    const s = encounter("skiff");
    s.player.cargo.oil = 1;
    stepRiver(s);
    s.pirates = [];
    s.player.cargo.oil = s.manifest.hold;
    const drop = s.drops[0]!;
    Object.assign(s.player, { x: drop.x, y: drop.y });
    stepRiver(s);
    expect(s.player.cargo.oil).toBe(s.manifest.hold);
    expect(drop.cargo).toEqual({ oil: 1 });
  });

  test("mooring before a ram-spill expires reports that cargo lost exactly once", () => {
    const s = encounter("skiff");
    s.player.cargo.oil = 1;
    stepRiver(s);
    stepRiver(s, { moor: true });
    expect(s.outcome).toBe("moored");
    expect(runReport(s).lost).toEqual({ oil: 1 });
    expect(runReport(s).lost).toEqual({ oil: 1 });
    expect(s.lost).toEqual({}); // Reporting does not mutate the simulation.
  });

  test("gunboats fire twin shots beyond raider range and skiffs close without shooting", () => {
    for (const role of ["skiff", "raider", "gunboat"] as const) {
      const s = encounter(role, 400);
      const y = s.pirates[0]!.y;
      stepRiver(s);
      expect(s.pirates[0]!.y - y).toBeCloseTo(pirateRoles[role].speed / 60, 9);
      expect(s.bullets.length).toBe(role === "gunboat" ? 2 : 0);
    }
  });

  test.each(["skiff", "raider", "gunboat"] as const)("%s pays its bounty once, capped by the manifest fund", role => {
    for (const fund of [4, 36]) {
      const s = encounter(role, 100);
      s.bounty = fund;
      s.pirates[0]!.hp = 0;
      stepRiver(s);
      expect(s.player.wallet - 30).toBe(Math.min(fund, pirateRoles[role].bounty));
      expect(s.player.wallet + s.bounty).toBe(30 + fund);
      expect(s.roleKills.heron_reach?.[role]).toBe(1);
      stepRiver(s);
      expect(s.player.wallet + s.bounty).toBe(30 + fund);
    }
  });
});

describe("wrecks and riverside stops", () => {
  const wrecked = () => manifest({ wrecks: [{ id: "wreck-1-3", reach: "heron_reach", at: .5, name: "the freight barge", cargo: { oil: 9, paper: 7 } }] });

  test("a wreck loads up to the free hold with E, records the salvage, and keeps the rest aboard the wreck", () => {
    const state = createRiver(wrecked());
    const wreck = state.wrecks[0]!;
    expect(distance(wreck, state.player)).toBeGreaterThan(300);
    stepRiver(state, { salvage: wreck.id });
    expect(state.salvaged).toEqual({});
    steer(state, wreck, 40);
    stepRiver(state, { salvage: wreck.id });
    expect(Object.values(state.player.cargo).reduce((a, b) => a + b, 0)).toBe(12);
    expect(state.salvaged[wreck.id]).toEqual({ oil: 9, paper: 3 });
    expect(wreck.cargo).toEqual({ paper: 4 });
    stepRiver(state, { salvage: wreck.id });
    expect(state.notice).toMatch(/hold is full/);
    state.outcome = "moored";
    const report = runReport(state);
    expect(report.salvaged).toEqual([{ wreck_id: wreck.id, item_id: "oil", quantity: 9 }, { wreck_id: wreck.id, item_id: "paper", quantity: 3 }]);
    expect(report.delivered).toEqual({ oil: 9, paper: 3 });
  });

  test("the first crew on a dangerous reach guards its wreck", () => {
    const reachesAt = reachIds.map(id => ({ id, danger: id === "heron_reach" ? 3 : 0, boom: false }));
    const guarded = createRiver({ ...wrecked(), reaches: reachesAt });
    advance(guarded, 3);
    expect(distance(guarded.pirates[0]!, guarded.wrecks[0]!)).toBeLessThan(140);
    const open = createRiver(manifest({ reaches: reachesAt }));
    advance(open, 3);
    // Without a wreck the same seed spawns along the reach exactly as before.
    expect(open.pirates[0]!.reach).toBe("heron_reach");
    expect(open.seed).toBe(guarded.seed);
  });

  test("each stop takes one choice; the fisher needs cord and pays from the bounty fund", () => {
    let state: River | undefined;
    for (let seed = 1; seed < 200 && !state; seed++) {
      const candidate = createRiver(manifest({ seed,
        items: [{ village: "millbrook", item: "cord", stock: 16, target: 16, coins: 40, discount: false, prices: [2, 2, 2] }] }));
      if (candidate.stops.some(stop => stop.kind === "fisher")) state = candidate;
    }
    const fisher = state!.stops.find(stop => stop.kind === "fisher")!;
    expect(state!.stops.length).toBeGreaterThanOrEqual(2);
    Object.assign(state!.player, { x: fisher.x, y: fisher.y, hp: 50 });
    stepRiver(state!, { stop: { id: fisher.id, choice: "mend" } });
    expect(fisher.choice).toBeUndefined();
    expect(state!.notice).toMatch(/1 cord aboard/);
    state!.player.cargo.cord = 1;
    stepRiver(state!, { stop: { id: fisher.id, choice: "mend" } });
    expect(fisher.choice).toBe("mend");
    expect(state!.player.cargo.cord).toBeUndefined();
    expect(state!.player.hp).toBe(75);
    expect(state!.player.wallet).toBe(36);
    expect(state!.bounty).toBe(30);
    stepRiver(state!, { stop: { id: fisher.id, choice: "strip" } });
    expect(state!.stopsTaken).toEqual([{ stop_id: fisher.id, choice: "mend" }]);
  });
});
