import assert from "node:assert/strict";
import { landing, reaches, villages } from "@lantern/content/river";
import { advanceClock, closeNight, createWorld, newNight, openNight } from "@lantern/game-core";
import { apply } from "../packages/game-core/src/ledger";
import { move } from "../packages/game-core/src/model";
import { createRiver, distance, replayRiver, stepRiver, type Point } from "@lantern/river-sim";
import { runReport } from "@lantern/river-sim/report";
import { type RunManifest } from "@lantern/protocol";

export function floodWorld(open = true) {
  let world = createWorld();
  for (let i = 0; i < 3; i++) world = newNight(closeNight(openNight(world)));
  if (open) world = advanceClock(openNight(world), 30);
  const id = "flood-test";
  world.ledger = apply(world.ledger, [move("m:indigo_atelier", "esc:contract:" + id, "coin", 12, "Fixture funded contract")]);
  world.river.contracts[id] = { id, village: "reedmarsh", item: "dye", qty: 3, payout: 12,
    deadline: 300, kind: "supply", payer: "m:indigo_atelier", stall: "indigo_atelier" };
  return world;
}
export function floodVoyage(manifest: RunManifest, succeed = true) {
  const river = createRiver(manifest);
  const steer = (target: Point, radius = 70) => {
    for (let i = 0; i < 4000 && distance(river.player, target) > radius && !river.outcome; i++) {
      const range = distance(river.player, target);
      stepRiver(river, { x: (target.x - river.player.x) / range, y: (target.y - river.player.y) / range, boost: true, fire: true });
    }
    assert(distance(river.player, target) <= radius, "Could not reach the voyage waypoint");
  };
  steer(reaches.heron_reach.to); steer(villages.reedmarsh);
  for (let i = 0; i < 180; i++) stepRiver(river, { fire: true });
  stepRiver(river, { trade: { village: "reedmarsh", item: "dye", side: "buy", quantity: 3 } });
  assert.equal(river.player.cargo.dye, 3);
  while (!river.floodtide && !river.outcome) stepRiver(river, {});
  assert(river.floodtide);
  if (succeed) { for (const gate of river.floodtide!.gates) steer({ x: gate.x + gate.dx * 90, y: gate.y + gate.dy * 90 }, 40); steer(landing, 120); }
  else while (!river.outcome) stepRiver(river, {});
  assert(river.outcome);
  return { river, report: runReport(river), replay: runReport(replayRiver(manifest, river.log, river.frame)) };
}
