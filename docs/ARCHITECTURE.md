# Lantern Caravan architecture

Lantern Row is the in-world night market. The four-night campaign ends with the Lantern Caravan, a procession of six festival boats; Floodtide opens with the final festival order and is carried in the manifest, so the simulation, replay and settlement agree on it. Repository, package, protocol and save identifiers retain their existing names. Night 3 objective counters live on each trader, persist through the shared codec, and reset at dusk. Its authored stop layout is bound to the manifest and interpreted identically by simulation and settlement.

```text
React UI ── MarketBackend ── LocalBackend ── game-core ── IndexedDB
   │                └────── HttpBackend ── Node HTTP ── game-core
   │                                           ├── IdentityProvider
   └──── typed events ─── Phaser               ├── SettlementProvider
                                               └── StateStore
```

- `packages/content` contains authored items, stalls, strategies, recipes, events, wishes, and the campaign schedule.
- `packages/game-core` is deterministic. It takes a seed and supplied game time, keeps every asset in an integer ledger, validates a quote, and commits to a fresh world. NPC trades and crafting use the same rules as a player. Merchant wholesale restocks apply validated ledger operations directly. Empty wallets are removed.
- `packages/protocol` owns the typed seams and Zod contracts. Money, quantities, and share counts cross JSON boundaries as strings. Time and revisions remain numbers.
- `LocalBackend` settles immediately, stores the previous good save beside the current one, and snapshots the start of each night for retry. This keeps a scenario's grant and earlier progress stable.
- `HttpBackend` uses bearer credentials, polls every two seconds, and refreshes after actions or when the window regains focus. It stores an action UUID before sending and resolves unresolved IDs on rejoin.
- `apps/server/src/live.ts` owns room time, seats, quotes, and pending reservations. Its serialized queue orders contesting actions. Each player action follows prepare, submit, and status. A persisted reservation protects the quoted ledger effects and resolves after restart. Agent changes commit immediately. The server keeps their net effects and settles them with `settleBatch` every 12th night close (`LANTERN_AGENT_BATCH_NIGHTS`) and before every player action.
- `packages/game-core/src/river.ts` applies harvest, freight, contracts, reservations, and River Run settlement to the same ledger. Village accounts hold available goods. Run escrow holds reserved cargo and contract escrow holds payout. Closing refunds outstanding escrow before calculating dividends.
- `packages/river-sim` is the deterministic 60 Hz simulation. It takes a seed and manifest from game-core, uses shared trade pricing, and produces a report and an input log. The Canvas2D scene takes over from Phaser during a run. LocalBackend checks the report and applies ledger effects when the quote is confirmed.
- The Phaser scene receives read-only snapshots and reports arrivals. Moving a character is presentation. The UI can draw the market, boat lights, and avatar positions with the same snapshot in both modes.
- `apps/web/src/river/barge.ts` draws both the Landing preview and the player's river sprite. Upgrade tiers and manifest-bound cosmetic IDs determine appearance; simulation stats depend only on upgrades and trim. Purchases and refits use shared game-core rules and the existing local/live backend action flow.

The reference FileStateStore targets one server process per data directory. The live clock is wall-clock based, while the local clock advances during active play and freezes on pause or a hidden tab.


W8 river history extends the existing timestamp-grouped history stream with village and reach variants; legacy stall rows need no migration. Live settlements append public samples after confirmation, and the local backend exposes current samples. Village trust is recorded as completed-contract facts alongside the existing per-village relationship. Game-core's cumulative `villagePurchaseCost` is shared with river-sim and the village dialog, so replay, settlement and displayed prices agree.
