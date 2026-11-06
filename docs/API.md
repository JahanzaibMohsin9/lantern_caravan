# Lantern Caravan API

The reference server speaks JSON. Requests use `POST /v1/rpc` with an `Authorization: Bearer <credential>` header. The shared types are in `packages/protocol/src/index.ts`, with Zod schemas in `packages/protocol/src/schemas.ts` and generated request, response, method, and data schemas in `packages/protocol/market.schema.json`.

```json
{
  "version": 1,
  "request_id": "req-001",
  "method": "get_quote",
  "params": {
    "session_id": "the-row",
    "night_id": "night-1",
    "intent": { "type": "buy", "stall_id": "oil_wharf", "item_id": "oil", "quantity": "2" }
  }
}
```

Replies echo `version` and `request_id`. A success has `ok: true`, a `result`, and `error: null`. An error has `ok: false`, `result: null`, and `error: {code, message}`. Match the code when possible and show the message to the player. Supported groups include quote expiry and price changes, stock and cargo failures, order conflicts, cooldown, phase restrictions, offering and share errors, identity, and action conflicts. Use a fresh quote for an expired quote, changed price, or newly unavailable stock.

## Endpoints

| Endpoint | Access |
| --- | --- |
| `POST /v1/auth/dev` with `{ "displayName": "Ari" }` | Public dev sign-in, returns `credential` and `player` |
| `GET /v1/health` | Versions and uptime |
| `GET /v1/public/snapshot` | Public spectator view |
| `GET /v1/public/history?range=day` | Public market samples, with `day`, `week`, and `all` ranges |
| `GET /v1/public/chronicle?cursor=...` | Public paginated chronicle |
| `GET /v1/chain/status` | NEAR settlement: contract, operator, queued and settled transactions, the last transaction's explorer link, and any error. `{ enabled: false }` without NEAR settlement. |
| `POST /v1/rpc` | Methods listed in the generated schema |

`create_session` makes a private live room. `join_room` joins the public `the-row` or a room code. Four human seats are available per night. Viewers on the waiting list can get a seat during preparation. The server returns `spectator` when a viewer cannot trade. Public Watch uses the public snapshot, even when a display name is stored locally.

Quotes are bound to an actor, room, and night and expire after 15 game seconds. Submit the quote with a client action UUID. Reuse that UUID for transport retries. The same UUID with a different quote returns `ACTION_CONFLICT`. A successful action can have a receipt with a label and optional details URL. A timeout leaves the action unresolved. Poll `get_action_status` and keep the UUID until the action is confirmed or rejected.

## River history and village trust

W8 keeps the public history endpoint and its `day`, `week` and `all` ranges. `HistoryRow` is now a union: existing stall rows retain their fields (optional `kind: "stall"`); village rows carry `kind: "village", village, item, coins, price, stock, time, night`; reach rows carry `kind: "reach", reach, danger, boom, time, night`. No authentication is needed for public Watch/history. Samples are appended at room creation, market ticks/phase changes and confirmed player settlements. Stock is unreserved village stock; source asks exclude personal discounts. File-store downsampling preserves each timestamp group across all series. The local backend returns current samples. Old history files remain readable.

`snapshot.villages[id]` adds `contractsCompleted` and `trusted`. The save codec defaults `villageContracts` to `{}`: this is a count of completed supply contracts, not a second reputation score. The second paid delivery for that village raises its existing relationship to at least 3 and unlocks trust for that trader across nights/reloads. Ordinary purchases and escorts keep their relationship benefits but do not count as supply deliveries. A failed or refunded contract does not count. Manifest lots carry optional `trusted` (omission preserves old prices). Trusted purchase cost is `base - floor(base / 10)`, calculated cumulatively per good per run; split batches pay the same total. It replaces the old one-coin batch discount for trusted buyers. The village receives only that discounted amount. No new intent is needed.

The river strip uses public `river.reaches`, village cash bands, `traders` and `river.upriver`. Barge icons indicate that a trader is upriver; they do not claim a precise unreported position. Player hauls and losses join existing boom, freight and relief events in the chronicle.

## River Run intents

W7 adds `buy_barge_cosmetic { cosmetic_id }` and `fit_barge_cosmetic { cosmetic_id }`, through the existing quote → submit → status flow. Buying transfers the catalog price to `sys:rescue`, records permanent ownership and fits the finish. Fitting a free or owned finish has no ledger effects. Neither is allowed during a run. Invalid IDs, unowned refits, duplicate purchases and insufficient funds return `BARGE_COSMETIC`, `BARGE_COSMETIC_OWNERSHIP`, `BARGE_COSMETIC_OWNED` and `BARGE_COSMETIC_FUNDS` respectively. `snapshot.barge` adds `look: { paint, lantern, prow }` and `cosmetics` (purchased IDs); manifests have optional `look`. Old saves default to Riverwood, Amber and a plain prow, with the four free catalog entries available. Looks never change stats.

W6 moves the campaign finale to Night 4; Endless starts on Night 5. Night 3's existing `objective.steps` now shows the player's boom, successful contract/escort and colored-lantern progress. `boomsTonight`, `contractsTonight` and the Night 2 `wharfBonus` survive saves and reset at the next night (missing fields in old saves default to zero). Only a confirmed finish earns river credit; an empty return or refunded contract does not.

A pre-W6 campaign Night 3 save (all traders lack the new counters) represents the old festival: the codec moves it to Night 4 without changing its ledger, orders or progress. Both the current save and the retry checkpoint use this migration.

Night 3 manifests carry optional `stopLayout: "campaign_reach"`. Both simulation and settlement call `stopPlan(seed, stopLayout)` to derive two Heron Reach stops. Omission preserves the ordinary seeded layout for existing manifests. No new intent or backend endpoint is required. The Night 2 pledge-plus-oil-haul bonus transfers up to 2 coins from `sys:rescue` and never mints goods or coins.

W9 makes the server re-run every voyage. A `finish_run` report carries `inputLog`: an array of `{ frame, input }` changes, at most 9,000 entries and 2 MiB, with each input limited to the barge controls (`x`, `y`, `boost`, `fire`, `flare`, `moor`, `aim`, `trade`, `salvage`, `stop`). The live server checks that the log is well formed, starts at frame 0, rises strictly, ends inside the reported duration and matches `inputLogHash`, then replays it with `replayRiver` against the stored manifest and requires the replayed report to equal the submitted one, field by field. Any mismatch returns `RIVER_REPLAY` and cancels that player's run, returning its reservations; other players' runs are untouched. LocalBackend settles offline runs with the existing manifest checks.

W9 also schedules **Floodtide** on festival nights: campaign Night 4, and endless and live nights whose plan has the festival rush. `floodtideOpens(night, mode, seed)` in `@lantern/content/nights` gives the game second of the final festival order (1:10 on Night 4). A run that is out at that moment gets `manifest.floodtideAtMs`; the simulation starts Floodtide then, and the barge has 60 seconds to cross both lock gates and moor. Departures close once Floodtide opens (`RIVER_FLOOD_CLOSED`). If the run carries a supply contract, the contract's premium over the village cost is escrowed from the issuer in `esc:flood:<run>` at departure (`RIVER_FLOOD_FUNDS` if it cannot pay), as `manifest.floodPremium` and `floodPayer`. The report adds `floodtide: { gates, completed, returned }`. A completed return delivers as usual and pays the premium a second time out of that escrow. A failed return delivers nothing: cargo still aboard is bought back by its source village at the buyback price (as far as the village's coins reach), and the escrow returns to the issuer. Cancelling a run also refunds it. A report that contradicts the schedule returns `RIVER_FLOOD`.

W5 adds player Bell orders, two more river intents that go through the usual quote, submit and status flow on both backends:

| Intent | Fields | Effect |
| --- | --- | --- |
| `post_bell_order` | `item_id` (a village good), `quantity` 1–12, `unit_price` 3–20 | Moves `quantity × unit_price` coins from the player to `esc:bell:<quote id>`. One order per player at a time. |
| `cancel_bell_order` | `order_id` | Refunds the units still waiting for a hauler at once. Units already aboard a haul still deliver and are paid. |

Rival haulers weigh every open order on their turn like any other route: a hauler takes up to 6 units only if the escrowed price beats the village price for those units, scored by margin over distance and danger. A delivery moves the goods from the hauler to the player and pays the hauler from the escrow; a haul lost on the river becomes a wreck and reopens those units for another hauler (or refunds them if the order was cancelled). At the night's end every escrow left refunds to its player. `snapshot.river.myOrder` shows the player's order: `quantity`, `unitPrice`, `escrow`, `delivered`, `waiting`, `hauling` (name, quantity, seconds to arrival), `cancelled` and the latest `news`; `snapshot.river.bellOrders` counts open orders in the room. In the campaign, Bell orders open on Night 4 (`BELL_ORDER_LOCKED` earlier).

W4 adds `snapshot.river.almanac: { tonight?, tomorrow? }`, each `{ id, name, village, item, detail }`. An almanac event changes one good's harvest target for one night (`harvestTarget` in `@lantern/content/river`); nothing else about the night changes, and no new intent is needed. `almanacFor(mode, night, seed)` is pure, so both backends and clients agree on the schedule: the campaign has Night 3's pressing strike, and endless and live rooms have one event on every odd night from Night 3, rotating through the villages. Each event is visible as `tomorrow` for the whole night before it acts, and is written to the activity feed at dusk on both nights.

W3 adds wrecks and riverside stops. When a freight, rival or village-boat haul is lost, its goods move to an escrow account `esc:wreck:<id>` instead of burning. The wreck opens at the next dusk and stays two nights; after that, whatever is left burns with `sink: "sys:river"`. `snapshot.river.wrecks` lists each wreck with `reach`, `name`, `cargo`, `open`, `nightsLeft` and `claimed`. `start_run` claims every open, unclaimed wreck into `manifest.wrecks` (`id`, `reach`, `at`, `name`, `cargo`), so two barges never salvage the same goods; finishing or cancelling the run releases the claim. A report may include `salvaged: [{ wreck_id, item_id, quantity }]`: each entry must name a wreck in the manifest that this run still claims and fit what the wreck holds, otherwise `RIVER_SALVAGE`. Salvaged goods transfer from the wreck to the actor and count as cargo inflow alongside village purchases. Riverside stops come from `stopPlan(manifest.seed)` in `@lantern/content/river`, so the server derives them itself. A report may include `stops: [{ stop_id, choice }]`, one choice per stop, otherwise `RIVER_STOP`. Stop gains (hull, fuel, ammo) stay in the run. The fisher's "mend" choice moves 1 cord from the actor to Millbrook and adds 6 coins to the bounty transfer, still capped by the manifest and the `sys:bounty` balance.

W2 extends each `report.pirates` entry with optional `roles: {skiff, raider, gunboat}` counts. Counts must sum to `count` and fit the role mix possible at that reach's manifest danger and reported duration, otherwise `RIVER_COMBAT`. New clients report roles and earn 6/8/14 coins per kill respectively. Legacy reports without roles retain the old 3-coin reward. Total bounty is capped by both the departure manifest and the remaining `sys:bounty` balance; all payment is a transfer. Skiff spills enter `delivered` when recovered or `lost` on expiry/end-of-run, using the same cargo-conservation check. No new backend route is needed.

W1 adds optional `trim` to `start_run`: `balanced`, `runner`, `ironclad` or `gunner`. Omission retains the actor's previous trim, defaulting to Balanced for old saves. Submission fits it for free and includes it in the authoritative manifest and `snapshot.barge.trim`; quoting alone changes nothing. Refitting is only possible between runs. Non-Balanced trims unlock on campaign Night 3 (`RIVER_TRIM_LOCKED` earlier); endless and live rooms have them immediately. Old manifests without `trim` replay as Balanced. Both backends use the shared rules and codec for this field.

Both LocalBackend and the live server accept the four intents during preparation and during the open night while at least 45 seconds remain (`RIVER_LATE` otherwise). River intents use wall-clock milliseconds for quote expiry (15 seconds) and run timing, on both backends. Submit and check the receipt as for a Row trade.

| Intent | Fields and effects |
| --- | --- |
| `start_run` | `barge_plan` (may be empty; rows are only checked for a valid producer), optional `contract_id` or `escort_id`. Submission reserves every village good for the barge, up to a full hold of each (half a village's stock at most in shared rooms), moves it to run escrow and exposes the manifest in `snapshot.river.myRun`. Unbought units return when the run settles. |
| `finish_run` | `run_id` and `report`. Settles bought and returned cargo, losses, flares, bounties, contract or escort payout, and towing. |
| `accept_contract` | `contract_id`. Claims one already funded Harbor Bell contract. A supply contract adds its cargo reservation automatically at departure. |
| `buy_barge_upgrade` | `upgrade_id`. Buys a persistent barge tier with coins. Tier II requires tier I. |

The manifest contains the run ID, seed, wallet, hold, reserved item price curves, reach conditions, visible hauls, contract, nominal deadline, and `limitMs`. `limitMs` is 150 seconds, or less for a run that starts late in the open night, so the barge is towed home before the night closes; a towed report must use exactly `limitMs`. The timer excludes time paused in a local scene; shared rooms have no pause. On a local open night the Row clock waits while the barge is out and advances by the trip's duration when it moors. Contract deadlines are checked against the barge's arrival time.

**Relief contracts.** When a stall goes dark, from lack of cash or because it sold out of stock, and lacks at least 3 units of a good, the harbor posts a supply contract with `relief: true`, paid from the `sys:rescue` dock fund: the village's current price for the units plus a hauling premium of 2 coins, one coin per two units and 2 coins per danger point on the route, for at most what the village can sell. It asks for the most-needed good that a village can supply at least 3 of. Delivering it moves the goods to the stall, pays the hauler, mints a harbor restart float that brings the stall to 20 coins (the same level as the overnight Harbor relief, so it can afford to restock), refunds any open rescue offering for that stall, and relights it. Rival haulers can fill relief contracts too. All of these ledger effects are part of the `finish_run` quote. A report contains `run_id`, `seed`, `durationMs`, `bought`, `soldBack`, `delivered`, `lost`, `flaresUsed`, `pirates`, `boomsBroken`, optional `escort` and `savedBoats`, `outcome`, and `inputLogHash`. Report quantities and durations are numeric. Since W9 the report also carries `inputLog`, the recorded per-frame input changes (see below), and `inputLogHash` binds it.

| Error prefix | Cause |
| --- | --- |
| `RIVER_PLAN` | The route names the wrong producer or lacks stock for the contract. |
| `RIVER_LATE` | Fewer than 45 seconds of the night remain. |
| `RIVER_CONTRACT_UNAVAILABLE`, `RIVER_CONTRACT_LIMIT` | The contract expired, belongs to another actor, or conflicts with the actor's existing contract. |
| `RIVER_RUN_UNKNOWN`, `RIVER_REPORT`, `RIVER_TIME` | Run identity, seed, or elapsed duration failed validation. |
| `RIVER_CARGO`, `RIVER_PRICE`, `RIVER_FUNDS` | Cargo conservation, manifest price, or coin coverage failed. |
| `RIVER_COMBAT`, `RIVER_BOAT`, `RIVER_ESCORT` | The claimed event exceeds the manifest's hazards, boats, or timing. |
| `BELL_ORDER`, `BELL_ORDER_LIMIT`, `BELL_ORDER_FUNDS`, `BELL_ORDER_UNKNOWN`, `BELL_ORDER_LOCKED` | Not a village good; the player already has an order; not enough coins for the escrow; no such open order; or a campaign night before 4. |
| `RIVER_REPLAY` | The input log is missing, malformed, oversized or out of order, its hash differs, or replaying it does not produce the submitted report. The live server cancels that run. |
| `RIVER_FLOOD`, `RIVER_FLOOD_CLOSED`, `RIVER_FLOOD_FUNDS` | The Floodtide result contradicts the schedule; departures have closed for the night; or the contract issuer cannot fund the Floodtide premium. |
| `RIVER_SALVAGE` | A salvage entry names a wreck outside the manifest, one this run no longer claims, or more than it holds. |
| `RIVER_STOP` | A stop or choice is not in the run's stop plan, or a stop is reported twice. |

An invalid report for the actor's active run returns reserved goods and refunds its contract. Reloading an interrupted local run performs the same cleanup. A confirmed finish leaves delivered goods in the player's ledger, including any units above the cart's normal loading limit. The player can sell, craft, and otherwise reduce the load from there.

## Replace a development implementation

### IdentityProvider

1. Implement `IdentityProvider` from `packages/protocol/src/index.ts`. `verify(credential)` returns the stable player ID and display name for a valid credential. For an invalid credential, reject with `AUTH_REQUIRED`. Use the optional `onFirstSeen` hook for provider-specific onboarding.
2. Add a selector in `apps/server/src/main.ts` beside the dev provider. Keep `/v1/auth/dev` restricted to the dev provider or replace it with your provider's sign-in path.
3. Pair it with an AuthClient that obtains credentials for your verifier. The game uses the verified ID for all balances.

### SettlementProvider

1. Implement `prepare(action)`, `submit(actionId)`, and `status(actionId)` from the protocol. Persist prepared effects before submission and make both prepare and submit idempotent by action ID.
2. Return `pending` or `unknown` for an unresolved action. Return `confirmed` only after your authoritative ledger commits, and `rejected` only for a definitive failure.
3. Optionally implement `settleBatch` for the already-simulated agent effects at closing. Make the batch idempotent by batch ID. Player effects are settled individually.
4. Wire the provider in `apps/server/src/main.ts` and run the pending, restart, duplicate, and contention tests in `tests/live.test.ts`.

### StateStore

1. Implement the generic `StateStore<T>` interface for the persisted room envelope in `apps/server/src/live.ts`. Treat the encoded world as versioned data. Room state includes the clock, seats, receipts, and any unresolved reservation.
2. `load` returns state with its revision or null. `save` compares the expected revision atomically, stores the new state, and returns the next revision. Never publish a successful revision after a failed save.
3. Implement append and query methods for action logs, market history, and chronicle. Cursors mark a position in descending chronicle time. Preserve the last rows at a downsample boundary.
4. Add the provider in `apps/server/src/main.ts`. The sample file provider uses atomic replacement for room state and NDJSON logs.

### AuthClient

1. Implement `getState`, `signIn`, `signOut`, `getCredential`, and `onChange` from the protocol. Manage your provider's sign-in UI and emit state changes for signing in, success, error, and sign-out.
2. Return an opaque credential for the Authorization header. Use a stable player ID in the state, and supply an optional account details URL.
3. Configure it in `apps/web/src/config.ts` and pass it to HttpBackend. Use the shared interface for state, credential, and sign-out. The reference name form supplies the extra display-name input for DevNameAuth.
