# Architecture

First Light runs locally in one browser tab.

- `packages/content` holds the authored goods, merchants, recipes, orders, and wishes.
- `packages/protocol` validates intents, haggling offers, quotes, and ledger operations. `first-light.schema.json` contains the JSON Schema export for those four contracts.
- `packages/game-core` handles pricing and settlement without browser or storage access. Balances live in one integer ledger. The engine accepts time from its caller and returns a new world on commit.
- `apps/web/src/backend/local.ts` binds quotes to a session, night, and revision. Local actions settle synchronously in memory, deduplicate action IDs for the open session, then write the resulting world to IndexedDB. The save encodes amounts as strings and keeps a backup in the same transaction.
- `apps/web/src/ui` presents market snapshots. The typed event bridge in `apps/web/src/world/bridge.ts` sends snapshots and effects to the Phaser scene and reports avatar arrivals back to React. Walking only controls which panel is shown.

The shared server, reservation lifecycle, full provider interfaces, and multi-room persistence are later milestones.
