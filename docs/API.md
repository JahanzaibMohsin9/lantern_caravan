# Lantern Row API

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
