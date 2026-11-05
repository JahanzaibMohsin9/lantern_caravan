// Prints a campaign save at the start of Night 3, built by the real game code. Night 2's storm sinks the
// freight barge's oil at Heron Reach, so the wreck is open for salvage on Night 3.
import { closeNight, createWorld, newNight, openNight } from "@lantern/game-core";
import { pack } from "../../../apps/web/src/backend/saves";

const night2 = newNight(closeNight(openNight(createWorld())));
const night3 = newNight(closeNight(openNight(night2)));
process.stdout.write(JSON.stringify(pack(night3, night3)));
