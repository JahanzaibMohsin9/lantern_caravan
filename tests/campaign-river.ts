import { createRiver, distance, replayRiver, stepRiver, type Point } from "@lantern/river-sim";
import { runReport } from "../packages/river-sim/src/report";
import { landing, reaches, villages } from "@lantern/content/river";
import type { RunManifest } from "@lantern/protocol";

/** Sail using ordinary recorded inputs; no teleports or changed physics. */
export function reachVoyage(manifest: RunManifest, cargo = { item: manifest.contract!.item, quantity: manifest.contract!.quantity }) {
  const river = createRiver(manifest);
  const steer = (target: Point, radius = 100) => {
    for (let i = 0; i < 3600 && distance(river.player, target) > radius && !river.outcome; i++) {
      const range = distance(river.player, target);
      stepRiver(river, { x: (target.x - river.player.x) / range, y: (target.y - river.player.y) / range, boost: true, fire: true });
    }
    if (distance(river.player, target) > radius) throw new Error("Could not sail to " + JSON.stringify(target));
  };
  for (const stop of river.stops) {
    steer(stop, 70);
    stepRiver(river, { stop: { id: stop.id, choice: stop.kind === "shed" ? "ammo" : "patch" } });
  }
  steer(reaches.heron_reach.to);
  steer(villages.reedmarsh);
  for (let i = 0; i < 5 * 60; i++) stepRiver(river, { fire: true });
  stepRiver(river, { trade: { village: "reedmarsh", item: cargo.item, quantity: cargo.quantity, side: "buy" } });
  steer(reaches.heron_reach.to);
  steer(landing);
  stepRiver(river, { moor: true });
  return { river, report: runReport(river), replay: runReport(replayRiver(manifest, river.log, river.frame)) };
}
