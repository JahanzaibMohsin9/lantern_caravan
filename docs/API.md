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
| `POST /v1/rpc` | Methods listed in the generated schema |

`create_session` makes a private live room. `join_room` joins the public `the-row` or a room code. Four human seats are available per night. Viewers on the waiting list can get a seat during preparation. The server returns `spectator` when a viewer cannot trade. Public Watch uses the public snapshot, even when a display name is stored locally.

Quotes are bound to an actor, room, and night and expire after 15 game seconds. Submit the quote with a client action UUID. Reuse that UUID for transport retries. The same UUID with a different quote returns `ACTION_CONFLICT`. A successful action can have a receipt with a label and optional details URL. A timeout leaves the action unresolved. Poll `get_action_status` and keep the UUID until the action is confirmed or rejected.

## River Run intents

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

**Relief contracts.** When a stall goes dark, from lack of cash or because it sold out of stock, and lacks at least 3 units of a good, the harbor posts a supply contract with `relief: true`, paid from the `sys:rescue` dock fund: the village's current price for the units plus a hauling premium of 2 coins and one coin per two units, for at most what the village can sell. Delivering it moves the goods to the stall, pays the hauler, mints a harbor restart float that brings the stall to 20 coins (the same level as the overnight Harbor relief, so it can afford to restock), refunds any open rescue offering for that stall, and relights it. Rival haulers can fill relief contracts too. All of these ledger effects are part of the `finish_run` quote. A report contains `run_id`, `seed`, `durationMs`, `bought`, `soldBack`, `delivered`, `lost`, `flaresUsed`, `pirates`, `boomsBroken`, optional `escort` and `savedBoats`, `outcome`, and `inputLogHash`. Report quantities and durations are numeric. The hash supports replay debugging. Server replay validation is scheduled for M6.

| Error prefix | Cause |
| --- | --- |
| `RIVER_PLAN` | The route names the wrong producer or lacks stock for the contract. |
| `RIVER_LATE` | Fewer than 45 seconds of the night remain. |
| `RIVER_CONTRACT_UNAVAILABLE`, `RIVER_CONTRACT_LIMIT` | The contract expired, belongs to another actor, or conflicts with the actor's existing contract. |
| `RIVER_RUN_UNKNOWN`, `RIVER_REPORT`, `RIVER_TIME` | Run identity, seed, or elapsed duration failed validation. |
| `RIVER_CARGO`, `RIVER_PRICE`, `RIVER_FUNDS` | Cargo conservation, manifest price, or coin coverage failed. |
| `RIVER_COMBAT`, `RIVER_BOAT`, `RIVER_ESCORT` | The claimed event exceeds the manifest's hazards, boats, or timing. |

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
