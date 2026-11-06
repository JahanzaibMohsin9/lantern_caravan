// Earn trust through two real settled, replayed voyages; import via Settings in the browser.
import { closeNight, commit, createWorld, newNight, openNight, quote, snapshotFor } from "@lantern/game-core";
import { pack } from "../../../apps/web/src/backend/saves";
import { reachVoyage } from "../../campaign-river";
let world = newNight(closeNight(openNight(newNight(closeNight(openNight(createWorld()))))));
for (const contract of Object.values(world.river.contracts).filter(c => c.kind === "supply" && c.village === "reedmarsh")) {
  world = commit(world, quote(world, { type: "start_run", contract_id: contract.id, barge_plan: [] }, "trust-" + contract.id, 0), 0);
  const manifest = snapshotFor(world, "fixture").river.myRun!.manifest;
  const { report } = reachVoyage(manifest);
  world = commit(world, quote(world, { type: "finish_run", run_id: manifest.id, report }, "home-" + contract.id, report.durationMs), report.durationMs);
}
process.stdout.write(JSON.stringify(pack(world, world)));
