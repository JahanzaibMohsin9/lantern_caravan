import { floodWorld } from "../../flood-river";
import { pack } from "../../../apps/web/src/backend/saves";
const world = floodWorld();
process.stdout.write(JSON.stringify(pack(world, floodWorld(false))));
