import { expect, test } from "vitest";
import { createWorld } from "@lantern/game-core";
import { fendOff } from "../packages/game-core/src/river";

test("three safe rival passages calm a reach by one, and a calm reach's boom is abandoned", () => {
  let world = createWorld("live");
  world = { ...world, river: { ...world.river, reaches: { ...world.river.reaches, ember_cut: { danger: 2, boom: true, lamps: 3, kills: 0 } } } };
  world = fendOff(fendOff(world, "ember_cut", "Pell"), "ember_cut", "Pell");
  expect(world.river.reaches.ember_cut).toMatchObject({ danger: 2, boom: true, kills: 2 });
  world = fendOff(world, "ember_cut", "Pell");
  expect(world.river.reaches.ember_cut).toMatchObject({ danger: 1, boom: false, kills: 0, lamps: 4 });
  expect(world.activity.map(entry => entry.line)).toEqual(expect.arrayContaining([
    "Pell’s convoys drove pirates off Ember Cut (danger 2 → 1).", "Pirates abandoned the boom at Ember Cut."]));
  // A calm, open reach has nothing left to fend off.
  const calm = { ...world, river: { ...world.river, reaches: { ...world.river.reaches, ember_cut: { danger: 0, boom: false, lamps: 5, kills: 0 } } } };
  expect(fendOff(calm, "ember_cut", "Pell")).toBe(calm);
});
