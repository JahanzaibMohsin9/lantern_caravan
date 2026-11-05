# Architecture

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
- `apps/server/src/live.ts` owns room time, seats, quotes, and pending reservations. Its serialized queue orders contesting actions. Each player action follows prepare, submit, and status. A persisted reservation protects the quoted ledger effects and resolves after restart. Agent changes commit immediately and the server coalesces their net effects at night close for `settleBatch`.
- The Phaser scene receives read-only snapshots and reports arrivals. Moving a character is presentation. The UI can draw the market, boat lights, and avatar positions with the same snapshot in both modes.

The reference FileStateStore targets one server process per data directory. The live clock is wall-clock based, while the local clock advances during active play and freezes on pause or a hidden tab.
