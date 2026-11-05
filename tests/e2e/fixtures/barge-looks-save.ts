import { closeNight, createWorld, newNight, openNight } from "@lantern/game-core";
import { apply } from "../../../packages/game-core/src/ledger";
import { mint, player } from "../../../packages/game-core/src/model";
import { pack } from "../../../apps/web/src/backend/saves";

let world = createWorld();
for (let i = 0; i < 3; i++) world = newNight(closeNight(openNight(world)));
// Test-only wallet for buying the entire catalog through its ordinary controls. Goods remain harvested.
world = { ...world, ledger: apply(world.ledger, [mint(player, "coin", 1000, "Fixture wardrobe budget")]) };
process.stdout.write(JSON.stringify(pack(world, world)));
