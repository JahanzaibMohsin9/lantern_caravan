# Lantern Row: game build specification

Version 2.0, 4 November 2026. Target handoff: Monday 9 November 2026.

This is the complete brief for building the game Lantern Row. It is self-contained.
Everything in it is in scope unless a section marks it as a lower tier or out
of scope.

---

## 0. Instructions for the coding agent

You are building a complete, polished, playable browser game from this specification.

1. Read the whole document before writing any code.
2. Make a task checklist that follows the priority tiers in section 22.
   Finish Tier 1 before starting Tier 2, and Tier 2 before Tier 3. A polished
   Tier 1 game is worth more than an unfinished Tier 3 game.
3. Work in a git repository called `lantern-row`. Commit after each working
   milestone, using the developer's configured git identity.
4. Run the tests and the game yourself. Never report a feature done until you
   have run it. Record real results in `docs/HANDOFF.md`.
5. Keep the seams in section 4 exactly as specified. Build the local and
   development implementations completely. **Do not integrate any third-party
   account, payment, analytics or external-ledger service.** Other
   implementations of the seams will be added after handoff, so the game must
   depend only on the interfaces.
6. Where the spec is ambiguous, choose sensibly, write the choice down in
   `docs/DECISIONS.md` and continue.
7. All numbers are starting tuning values. Rebalance after the simulator and
   bot playthrough tests (section 21), and record every change in
   `docs/DECISIONS.md`.
8. **Game feel matters as much as correctness.** Section 15 is a requirement,
   not decoration.

---

## 1. The game

**Lantern Row is a night-market game where every merchant is an AI-run
business, and you can own a piece of it.**

The player arrives at a riverside night market with a handcart. They buy
materials from merchant stalls, craft lanterns, sell them, and fill festival
orders that light up boats on the river. Each merchant runs its own business
with its own coins and stock. It sets prices from scarcity, haggles, remembers
how you treated it, raises money by selling shares, and goes dark when it runs
out of cash.

Players can **buy shares** in a stall, **vote on its strategy**, and **earn
dividends** when it does well. The shared market keeps running day and night,
even when nobody is playing, so it is a little different every time someone
visits.

### Design pillars

1. **You don't just trade with merchants. You own them.** The game's
   signature system is shares, strategy votes and dividends (section 11).
2. **Light shows the economy.** A thriving stall blazes with light, a
   struggling one flickers, and a broke one goes dark and shutters. The whole
   market grows brighter as it prospers and as boats are lit. A player can
   read the economy at a glance, without any numbers (section 12).
3. **Merchants are characters with memory.** They explain every price, haggle
   within visible limits, and remember whether you saved them or dumped goods
   on them (section 9).
4. **A living market.** The shared market never stops. It has a public
   history page that tells its story (section 13.3).
5. **A meaningful decision every 20–40 seconds.** The decisions are what to
   carry, what to craft, which offer to take, whether to haggle, and where to
   invest. Walking is short.
6. **Readable for non-experts.** After one night, someone new to trading
   games should understand scarcity, pricing, opportunity cost and investment
   risk.

### Session shape

| Time scale | What the player does |
|---|---|
| Every 30 seconds | Read the prices and lights, buy or sell, haggle, craft, fill an order |
| Every night (5 min) | Plan a route, react to events, save a dark stall, light boats |
| Between nights | Vote on the strategy of stalls they own, collect dividends, buy upgrades |
| Across sessions | Finish the 3-night campaign, then join the live market, which has changed since the last visit |

---

## 2. Technology (pinned)

Use one language, TypeScript, everywhere.

| Part | Choice |
|---|---|
| Runtime | Node.js 24 LTS, pinned in `.nvmrc` and `engines` |
| Package manager | npm workspaces with a committed `package-lock.json` |
| Language | TypeScript, strict mode |
| 2D world | **Phaser** (current stable 3.x; pin the exact version), using its tweens, particles, cameras and sound |
| UI overlay | React 19 for HTML/CSS panels over the canvas. Phaser and React talk through a small typed event bus. |
| Charts | A lightweight chart library such as uPlot or Chart.js, or hand-drawn SVG |
| Bundler / dev | Vite |
| Server | Node HTTP server (Fastify is fine) |
| Tests | Vitest for unit tests, Playwright (Chromium) for end-to-end |
| Validation | Zod schemas in `packages/protocol`, exported to JSON Schema |

Requirements:

- `npm ci && npm run dev` starts the game in local mode on a clean machine,
  with **no environment variables and no accounts**.
- Desktop Chrome and Firefox must work. The layout must work at 1280×720 and
  1920×1080.
- The game must hold 60 FPS on an ordinary laptop. The initial download must
  be under 15 MB.
- No 3D and no external modeling tools. All art is 2D (section 14).

---

## 3. Repository layout

```text
lantern-row/
  README.md  LICENSE (MIT)  package.json  package-lock.json  .nvmrc  .gitignore
  packages/
    protocol/      # Shared types, Zod schemas, JSON Schema export, seam interfaces
    content/       # Items, recipes, merchants, strategies, scenarios, events, dialogue, wishes
    game-core/     # Pure deterministic rules engine + merchant/rival policies
  apps/
    web/
      src/world/     # Phaser scenes: the Row, river, boats, characters, lighting
      src/ui/        # React panels
      src/backend/   # LocalBackend, HttpBackend (implement MarketBackend)
      src/auth/      # AuthClient interface + dev implementations
      src/art/       # Procedural art generators (silhouettes, glow textures)
      src/config.ts
    server/
      src/providers/ # IdentityProvider, SettlementProvider, StateStore + dev implementations
      src/live/      # The always-on public market loop + chronicle
  tools/simulate/    # Headless economy simulator CLI
  tests/golden/  tests/e2e/
  docs/  ARCHITECTURE.md  API.md  RUNNING.md  DECISIONS.md  ASSETS.md
         KNOWN_ISSUES.md  HANDOFF.md  BALANCE_REPORT.md
```

Required root scripts:

| Script | Does |
|---|---|
| `dev` | Runs the web client in local mode, with no server |
| `dev:server` | Runs the server, with the live market, plus a web client in server mode |
| `test` | Runs the unit, golden, invariant and bot playthrough tests |
| `test:e2e` | Runs Playwright, including the two-client shared market test |
| `build` | Typechecks and builds everything. The client goes to `apps/web/dist`. |
| `simulate` | Runs the headless economy simulator (section 13.4) |

`.gitignore` must exclude `node_modules`, `dist`, `coverage`, `sim-output`, `.env*`
(except `.env.example`) and `apps/server/data/`.

---

## 4. Architecture and seams

```text
┌──────────────────────────── apps/web ───────────────────────────┐
│ Phaser world ◄─ event bus ─► React UI ◄──► MarketBackend (iface) │
│                                         LocalBackend │ HttpBackend│
│ AuthClient (iface): DevGuestAuth / DevNameAuth                   │
└─────────────────────────────────────────────────────────────────┘
                                   │ HTTP JSON
┌──────────────────────────── apps/server ────────────────────────┐
│ RPC router ─► game-core (authoritative) ─► providers:            │
│   IdentityProvider (dev)  SettlementProvider (dev)  StateStore   │
│ Live loop: runs the public market 24/7, writes the chronicle     │
└─────────────────────────────────────────────────────────────────┘
```

### 4.1 game-core is pure

- No I/O: no `Date.now()`, no `Math.random()`, no fetch, no storage. Pass time
  and a seeded PRNG (mulberry32 or xoshiro128, documented) in explicitly.
- Every amount and quantity is an **integer**. Assert `Number.isSafeInteger`.
  At every serialized boundary (API, saves, golden files), encode amounts as
  **strings**.
- The same core runs in the browser, on the server and in the simulator.

Core API. Names may vary, but document them.

```ts
createWorld(scenario, seed, startTime): WorldState
quote(state, actorId, intent, now): Quote | RuleError
haggle(state, actorId, offer, now): HaggleResult          // accept → Quote, counter → Quote, refuse
validate(state, quote, now): ok | RuleError
reserve(state, quote, actionId): WorldState
effectsOf(state, quote): LedgerOp[]
commit(state, actionId): WorldState
release(state, actionId): WorldState
tick(state, now, rng): { state, agentActions[], chronicle[] }
closeNight(state): { state, results, chronicle[] }         // dividends, drift, votes applied
snapshotFor(state, viewerId): Snapshot
```

### 4.2 Everything is a ledger

All balances for all accounts live in **one ledger** in `WorldState`. That
covers coins, every item and every stall's shares. The only way a balance
changes is by applying `LedgerOp`s.

```ts
type AccountId = string;   // "p:<playerId>", "m:paper_mill", "r:1", "sys:crowd", ...
type AssetId   = string;   // "coin", "paper", "lantern_paper", "share:oil_wharf", ...
type LedgerOp =
  | { op: "transfer"; asset: AssetId; amount: string; from: AccountId; to: AccountId; memo: string }
  | { op: "mint";     asset: AssetId; amount: string; to: AccountId;   memo: string }
  | { op: "burn";     asset: AssetId; amount: string; from: AccountId; memo: string };
```

| Account | Purpose |
|---|---|
| `p:<id>` | Human player |
| `m:<stall_id>` | Merchant business: its coins, stock and its own unsold (treasury) shares |
| `r:<n>` | Simulated rival trader |
| `sys:scenario` | Source of grants and scheduled shipments (always recorded mints) |
| `sys:crowd` | Visitor buying budget at the Lantern House |
| `sys:rescue` | Dock job fund |
| `sys:festival` | Delivered festival lanterns (light the boats) |
| `esc:order:<id>` | Escrowed festival order payouts |
| `esc:offer:<id>` | Escrow for a share offering until it completes or refunds |
| `esc:listing:<id>` | Escrow for a share listing on the share board |
| `pool:div:<stall>` | Dividend pool for the current night |

The ledger follows these rules:

- Crafting **burns** inputs and **mints** outputs.
- Shares are a fungible asset per stall, `share:<stall_id>`. The total per
  stall is at most 20 (section 11).
- **Invariants** are checked after every action in tests:
  - no balance is ever negative
  - supply changes only through recorded mint and burn
  - trades, dividends and share sales conserve coins

### 4.3 Seams (interfaces in `packages/protocol`)

Other implementations of these will be plugged in after handoff. Build the dev
and local versions completely, and keep game code talking only to these
interfaces.

**Client**

```ts
interface MarketBackend {
  readonly kind: "local" | "server";
  readonly environmentLabel: string;              // shown in HUD: "Local", "Dev server", ...
  listProfiles(): Promise<ProfileSummary[]>;
  createSession(req: CreateSessionReq): Promise<SessionInfo>;
  joinRoom(roomId: string, opts?: { spectate?: boolean }): Promise<SessionInfo>;
  getCatalog(contentVersion: string): Promise<Catalog>;
  getSnapshot(sessionId: string): Promise<Snapshot>;
  getQuote(sessionId: string, nightId: string, intent: Intent): Promise<Quote>;
  haggle(sessionId: string, nightId: string, offer: HaggleOffer): Promise<HaggleResult>;
  submitAction(sessionId: string, nightId: string, quoteId: string, actionId: string): Promise<ActionStatus>;
  getActionStatus(sessionId: string, nightId: string, actionId: string): Promise<ActionStatus>;
  advancePhase(sessionId: string, actionId: string): Promise<Snapshot>;
  getChronicle(roomId: string, cursor?: string): Promise<ChroniclePage>;
  getHistory(roomId: string, range: HistoryRange): Promise<MarketHistory>;
  getSaveStatus(sessionId: string): Promise<SaveStatus>;
}

interface AuthClient {
  getState(): AuthState;   // { status: "signed_out"|"signing_in"|"signed_in"|"error", player?: {id, displayName}, detailsUrl?: string, error?: string }
  signIn(): Promise<AuthState>;              // implementation owns any UI it needs
  signOut(): Promise<void>;
  getCredential(): Promise<string | null>;   // sent as Authorization: Bearer <credential>
  onChange(cb: (s: AuthState) => void): () => void;
}
```

Required client implementations:

- `LocalBackend`: game-core runs in the browser, with saves in IndexedDB.
  Chronicle and history are kept locally.
- `HttpBackend`.
- `DevGuestAuth` for local mode.
- `DevNameAuth` for server mode. It asks for a display name and calls the
  dev login.

The implementation is chosen in `apps/web/src/config.ts` from
`VITE_BACKEND=local|server`, `VITE_SERVER_URL` and `VITE_AUTH=dev`. Adding a new
option there must be the only client change needed to plug in a new
implementation.

**Server**

```ts
interface IdentityProvider {
  verify(credential: string): Promise<{ playerId: string; displayName: string }>;   // throws AUTH_REQUIRED
  onFirstSeen?(playerId: string): Promise<void>;                                     // optional hook on first login
}

interface SettlementProvider {
  prepare(a: PreparedAction): Promise<void>;   // { actionId, roomId, nightId, actorId, intent, effects: LedgerOp[], expectedRevision, kind: "player" | "agent" }
  submit(actionId: string): Promise<void>;     // idempotent per actionId
  status(actionId: string): Promise<SettlementStatus>;
  // { state: "pending"|"confirmed"|"rejected"|"unknown", receipt?: { id: string; label?: string; url?: string }, reason?: string }
  settleBatch?(batch: { batchId: string; roomId: string; nightId: string; effects: LedgerOp[] }): Promise<SettlementStatus>;
}

interface StateStore {
  load(roomId: string): Promise<{ state: WorldState; revision: number } | null>;
  save(roomId: string, state: WorldState, expectedRevision: number): Promise<number>;   // compare-and-set
  appendActionLog(entry: ActionLogEntry): Promise<void>;
  appendHistory(roomId: string, rows: HistoryRow[]): Promise<void>;
  appendChronicle(roomId: string, entries: ChronicleEntry[]): Promise<void>;
  queryHistory(roomId: string, range: HistoryRange): Promise<HistoryRow[]>;
  queryChronicle(roomId: string, cursor?: string, limit?: number): Promise<ChroniclePage>;
}
```

Every action by a human player goes through `prepare → submit → status`.
Actions between agents only (merchants and rivals) are committed immediately
in game-core. At night close, the server sends their **net** effects for that
night as one `settleBatch`, if the provider implements it. Document this split
in `ARCHITECTURE.md`.

The server flow for a player action is:

1. Verify the credential.
2. Load the room and check the quote.
3. Reserve the effects.
4. Call `prepare`, then `submit`, then poll `status`.
5. On `confirmed`, commit. On `rejected`, release. On `pending` or `unknown`,
   keep the reservation. A transport timeout is never a rejection.

A background loop and every `getActionStatus` call resolve outstanding actions.

Dev implementations, all complete:

- **`DevIdentityProvider`**: `POST /v1/auth/dev {displayName}` returns a signed
  dev credential.
- **`DevSettlementProvider`**: confirms instantly by default. These
  environment variables change its behavior:
  - `DEV_SETTLE_DELAY_MS`
  - `DEV_SETTLE_FAIL_RATE`
  - `DEV_SETTLE_UNKNOWN_RATE` (stays unknown for a while, then resolves)
  - `DEV_SETTLE_DUPLICATE`

  Its receipts look like `{ id: "dev-000123", label: "Dev receipt" }`.
- **`FileStateStore`**: JSON or NDJSON files under `apps/server/data/`, written
  atomically (write, then rename) with revision checks.

Select providers with server environment variables (`IDENTITY=dev`,
`SETTLEMENT=dev`, `STORE=file`) and document them in `.env.example`.

**Optional seams.** Their defaults are complete.

```ts
interface MerchantPolicy  { decide(view: MerchantView, rng: Rng): { action: AgentAction | null; reason: string } }
interface DialogueProvider { line(ctx: DialogueContext): Promise<string> }   // default: authored lines from content
```

An alternate policy that returns an illegal action is rejected, and the game
falls back to the deterministic policy.

---

## 5. Night structure

| Phase | Duration | Behavior |
|---|---|---|
| Preparation | Ends when the player clicks Ready, or after 30 s in shared rooms | Objectives, events, recipes, upgrades, **strategy votes** for stalls you own, last night's dividends |
| Open market | **5 minutes** (set per scenario) | Trade, haggle, craft, fill orders, buy shares, dock jobs, events |
| Closing | Instant | No new actions. Pending actions resolve. Dividends are paid, votes take effect and demand drift is applied. |
| Results | Ends on Continue, or after 30 s in shared rooms | Income and expenses, objectives, boats, dividends per stall, share value changes, a teaser for the next night |

Rules:

- In local single-player mode, pausing freezes time. The shared market keeps
  running, and the pause screen must say so.
- An action reserved before closing completes after the deadline. Anything
  submitted later gets `NIGHT_CLOSED`.
- The client interpolates the timer from the snapshot's `serverTime`.

---

## 6. World layout and controls

### 6.1 The Row (2D side view)

The world is **one horizontal riverside street**, seen from the side and about
2.5 screens wide. The camera follows the player horizontally.

| Layer, back to front | Contents |
|---|---|
| Sky | Night gradient, stars, moon. Brightness rises with market prosperity (section 12). |
| Far parallax | Silhouettes of distant rooftops, a temple, a bridge, with a few distant lights |
| The Row | From left to right: storage shed, Paper Mill, Oil Wharf, workshop (centre), Reed & Thread, Indigo Atelier, notice board, Lantern House |
| Promenade | The walkway where the player, merchants, rivals, other players and visitors walk |
| River | Water with shimmering reflections of every light, six festival boats, a small dock |
| Foreground parallax | Foreground silhouettes of reeds, posts and hanging lantern strings |

Stall identities:

| Stall ID | Merchant | Personality | Primary goods | Secondary good |
|---|---|---|---|---|
| `paper_mill` | Mira | Cautious. Keeps a paper reserve. Hard to haggle with when low. | paper | oil |
| `oil_wharf` | Sami | Anticipates demand. Stocks up before festival orders. | oil | reed |
| `reed_thread` | Toma | Easygoing. Cheap when stocked. Easiest to haggle with. | reed, cord | dye |
| `indigo_atelier` | Nila | Discerning. Prizes colored work and dye. | dye | paper |
| `lantern_house` | Asha | Buyer. Posts festival orders and serves the visitor crowd. | (buyer) | none |

### 6.2 Controls

- Click a stall, board or the dock to walk there. The panel opens on arrival.
  A/D or the arrow keys also walk.
- **E** interacts with the nearest target. **Esc** closes the current panel,
  then opens the pause menu. **I** opens inventory, **J** opens the journal,
  **H** opens market history.
- **Tab or the number keys 1–8** jump to stalls. Walking is fast: the whole
  Row takes about 4 s to cross.
- All panels work by keyboard and show a visible focus outline.

Walking is presentation only. The rules must stay safe if a valid action
arrives without the player having walked to the stall.

---

## 7. Items, recipes and pricing

### 7.1 Items and recipes

| ID | Name | Base ask | Sold by |
|---|---|---|---|
| `paper` | Paper | 2 | Paper Mill (primary), Indigo Atelier (secondary) |
| `oil` | Lamp oil | 4 | Oil Wharf (primary), Paper Mill (secondary) |
| `reed` | Reed frame | 3 | Reed & Thread (primary), Oil Wharf (secondary) |
| `cord` | Cord | 2 | Reed & Thread (primary) |
| `dye` | Dye | 3 | Indigo Atelier (primary), Reed & Thread (secondary) |
| `lantern_paper` | Paper lantern | crafted | Night 1 |
| `lantern_float` | Floating lantern | crafted | Unlocked in night 2 |
| `lantern_color` | Colored lantern | crafted | Unlocked in night 3 |

| Recipe | Inputs | Output | Lantern House standard price | Typical festival payout |
|---|---|---|---|---|
| `paper_lantern` | 1 paper + 1 oil | 1 lantern_paper | 7 | 10 |
| `floating_lantern` | 1 paper + 1 oil + 1 reed | 1 lantern_float | 10 | 15 |
| `colored_lantern` | 1 paper + 1 oil + 1 dye + 1 cord | 1 lantern_color | 12 | 18 |

- Crafting happens at the workshop. Inputs, outputs and cargo are validated
  together.
- Cargo starts at 6 units. Each unit of any item takes one slot.
- There is no storage system in this version. The storage shed is decorative.

### 7.2 Pricing (`packages/game-core/src/pricing.ts`)

All pricing lives in **one short, readable, heavily commented file** that a
non-programmer can follow. It returns a price **and** a plain-language
reason, for example "Oil is scarce here (3 of 12): ×2.0".

| Stock / target | Multiplier (bp) | Label |
|---|---|---|
| below 25 % | 20000 | Scarce |
| 25 % to below 75 % | 12000 | Low |
| 75 % to 125 % inclusive | 10000 | Normal |
| above 125 % | 6000 | Flooded |

The ask is calculated as follows:

- `unitAsk = ceil(baseAsk × stockMult × eventMult × driftMult × strategyMult /
  10000⁴)`. Every multiplier defaults to 10000.
- Clamp the result to `[2, 3 × baseAsk]`.

Player buys and sells:

- When the player **buys**, use the stock *before* that unit is removed.
- When the player **sells**, use the stock *after* the unit is added. The
  merchant pays `max(1, floor(ask × 70 %))`.
- Quote batches **one unit at a time**. A batch of N must cost exactly the
  same as N single trades.
- A buy-then-sell round trip at one merchant must always lose coins, at every
  threshold and including haggling. Test this.

Demand drift and starting stock:

- **Demand drift**, in the live market and in endless mode: at night close,
  compare units sold with target, and move `driftMult` by ±500 bp toward
  demand, clamped to [5000, 20000].
- A merchant's normal night starts with 12 of each primary good (target 12),
  4 of its secondary good (target 4) and 40 coins. Scenarios may override
  these.

### 7.3 Lantern House

- The visitor crowd buys standard lanterns from `sys:crowd`, with a budget of
  120 per night and at most 6 lanterns per player per night. The panel shows
  the remaining budget.
- Festival order payouts are escrowed in `esc:order:*` when an order opens.
  The two budgets never mix.
- Crowd lanterns are burned. Festival lanterns go to `sys:festival`.

---

## 8. Merchant agents and rivals

### 8.1 Merchants

- Each merchant ticks every **10 simulated seconds** and takes at most one
  legal action. The action and its reason appear in the stall's **"Thinking"**
  line and in the activity log.
- **Restocking.** A merchant may buy one unit from a cheaper supplier when it
  is below half its target and the margin covers the cost.
- **Fundraising.** A merchant may open a share offering (section 11.2) when
  its cash is tight but demand is good.
- **Buybacks.** A merchant may buy back shares when it is rich (section
  11.4).
- Personality and current strategy (section 11.3) set its parameters: cash
  reserve, markup, how much stock it buys ahead, and haggle tolerance.
- Scheduled shipments come from the scenario as recorded mints.
- Every merchant action uses the same `quote → reserve → commit` path as
  players.

### 8.2 Rivals

- There are 2 rivals in the campaign. Rivals also fill empty seats, up to 4
  traders, in shared rooms. In the live market, 3 rivals keep trading when no
  human is present.
- Rivals use exactly the same rules and intents as players. Every 20–30 s a
  rival picks the most profitable legal route. Rivals also buy shares, vote
  according to a simple policy, and haggle.
- Each rival has a name and a style: "Bargain-hunter Pell" haggles hard, and
  "Investor Juno" buys shares in struggling stalls.
- Rivals never take the player's **personal** order (section 10).

---

## 9. Haggling and merchant memory

### 9.1 Haggling (`packages/game-core/src/haggle.ts`)

This file must also be short and commented.

- In any trade panel, the player can **Make an offer** instead of taking the
  quoted price.
- An offer is a whole-unit price for the selected quantity.
- The merchant responds **Accept**, **Counter** (one counter only) or
  **Refuse**.
- Accept and Counter produce a normal quote (15 s expiry) at the agreed
  price.
- **Tolerance** is how far from the ask the merchant will go, in basis points
  toward the player. It is calculated as follows:
  - **Start**: 500 (5 %).
  - **Stock**: +500 when the merchant is Flooded and the player is buying; 0
    when the merchant is Scarce and the player is buying (no discount).
  - **Strategy**: from section 11.3.
  - **Relationship**: from −300 to +500 (section 9.2).
  - **Clamp**: the final tolerance is clamped to [0, 1000], so it is never
    more than 10 %.
- How the merchant answers an offer:
  - Within tolerance: accept.
  - Up to 2× tolerance away: counter at the tolerance limit.
  - Further away: refuse, with a characterful line.
- A player may haggle at most once per stall every 20 s. This stops anyone
  probing for the exact limit.
- The panel shows a mood hint before the offer ("Toma looks relaxed: open to
  offers" or "Mira is guarding her stock"). It shows a hint, never the exact
  number.
- Haggling must never make a buy-then-sell round trip profitable. Test this
  at every threshold, including the best relationship.

### 9.2 Relationships

Each merchant stores a relationship score from −5 to +10 for each player and
rival. Relationships are shown in the journal and in the merchant's greeting.
They change as follows:

| Event | Change |
|---|---|
| Player helped reopen this stall | +3 |
| Player holds shares in this stall (once per night) | +1 |
| A fair trade (at the Normal band, no lowball) | +1, at most twice per night |
| Selling to this merchant while it is Flooded | −1 |
| An offer that gets refused | −1, at most once per night |

The relationship sets haggle tolerance (from −300 at −5 to +500 at +10) and
dialogue only. It never changes the listed price. Merchants refer to what
they remember, for example: "You're the one who relit my wharf. For you, 3
coins."

---

## 10. Festival orders and boats

- An order has these fields:
  - ID, item and quantity
  - payout per unit
  - open and close times
  - remaining quantity
  - boat (1–6)
- Orders open at 0:00, 1:15, 2:30 and 3:45 of a night. All of the night's
  orders are visible from the start, with countdowns.
- Partial fills are allowed. A fill reserves remaining quantity atomically. If
  two players race for the same quantity, the action accepted first wins.
- **Lighting a boat is the game's big moment.** When an order is completely
  filled, the boat's lanterns rise and light in that lantern type's color. A
  chime plays, the river reflection blooms and the sky brightens a step.
  Everyone in the room sees it.
- **Wish lanterns.** When filling a festival order, the player may attach a wish
  chosen from about 40 preset phrases in `content/wishes.json`, such as "May
  the river be kind" or "For my grandmother". There is no free text. Each of
  that player's lanterns on the boat carries the wish, and hovering a
  lantern shows the wish and the player's name. The chronicle records each
  night's wishes.
- In each campaign night, one order is marked **personal** and only the player
  can fill it. Every order in shared rooms is contested.
- When a fill fails (`ORDER_FILLED`, `MISSING_INGREDIENTS`), the panel explains
  why and offers to sell to the visitor crowd instead.

---

## 11. Owning the merchants (signature system)

### 11.1 Shares

- Each supplier stall has a fungible share asset, `share:<stall_id>`. At most
  **20 shares** can exist per stall.
- When the world is created, every stall starts with 0 shares outstanding and
  is fully owned by its merchant.
- Shares are minted only by offerings and burned only by buybacks. They
  **persist across nights**.
- The stall panel has an **Ownership** tab that shows:
  - the share price (the last trade or offering price)
  - book value per share, defined as (coins + stock at base ask) ÷ shares
    outstanding
  - who owns the shares, as a pie chart with names
  - the current strategy
  - dividends paid over the last 5 nights, as a sparkline

### 11.2 Offerings: how shares are created

Shares come into existence through offerings, of which there are two kinds.

**Rescue offering**

- When a stall closes (its coins drop below 5 and no scheduled income can
  restore them), it goes **dark** and opens a rescue offering: 4 shares at 5
  coins each.
- At most 2 shares per buyer per offering.
- Contributions sit in `esc:offer:<id>`. When all 4 shares are sold, the 20
  coins go to the merchant, the shares are minted to the buyers, and the
  stall **relights** with a celebration.
- If the offering is not complete when the night ends, every buyer is
  refunded.
- A stall can be rescued at most once per night.
- A closed stall shows a shutter and a sign with the reason, such as "Out of
  cash: 2 coins, needs 5".

**Expansion offering**

- A merchant agent opens an expansion offering when its coins are at the
  Tight level or lower, its demand drift is above 10000, and fewer than 20
  shares exist.
- It offers 2 shares at `max(5, ceil(book value per share))`. Before any
  shares exist, book value is (coins + stock at base ask) ÷ 10.
- The offering stays open for 90 s. If it doesn't fill, it refunds.
- Its reason appears in the Thinking line, for example "Demand for reed is
  up. I need cash to restock."

**Both kinds**

- The offering panel states the risk plainly before the player confirms:
  "Shares pay dividends only when this stall makes a profit. They can be sold
  back only if the merchant or another player buys them. You may lose
  everything you put in."

### 11.3 Strategy votes

- During preparation, every shareholder of a stall votes for its strategy that
  night. Each share counts as one vote. Rivals vote according to their
  policy. If no shareholder votes, or the vote ties, the stall keeps its
  current strategy. A stall with no shares outstanding uses its
  personality's default.
- Strategies are data in `content/strategies.json`:

  | Strategy | Cash reserve | Price multiplier | Buys ahead | Haggle tolerance | Effect |
  |---|---|---|---|---|---|
  | Steady (Mira's default) | High (15) | 10000 | Low | −100 | Rarely closes; modest dividends |
  | Bold (Sami's default) | Low (5) | 10500 | High | 0 | Bigger profits and a higher chance of going dark |
  | Festival | Medium (10) | 10000 | Stocks goods for open festival orders | +200 | Sells festival inputs fast; thrives on event nights |
  | Bargain (Toma's default) | Medium (10) | 9500 | Medium | +300 | High volume, thin margins |

- The chosen strategy shows on the stall's sign as an icon and label. The
  results screen shows how each strategy performed that night.

### 11.4 Dividends and buybacks

- **Dividends.** At night close, a stall's **net trading profit** for the night
  is its sales revenue minus its purchase costs. If that profit is positive,
  30 % of it (rounded down) goes into `pool:div:<stall>`. The pool pays out
  `floor(pool ÷ shares outstanding)` per share. Any remainder stays with the
  merchant. If no shares are outstanding, there is no pool.
- **Buybacks.** When a merchant's coins are more than 3× its strategy's cash
  reserve plus 30, it offers to buy back 1 share from the holders at book value.
  It buys from the first holder who accepts, either in the Ownership tab or by
  the holder's standing "sell to merchant" toggle. The share is burned.
- **Share board (Tier 2).** At the notice board, players and rivals can list
  shares at an asking price. A listing's shares go into `esc:listing:<id>`.
  The buyer pays the seller directly. Listings can be cancelled, which
  returns the shares.
- A dark stall pays no dividends. Its shares remain, and a later rescue
  offering dilutes them. That is intended.

---

## 12. Light shows the economy

Light is the visual language of the economy. Every light level comes from game
state and is never random.

| Merchant state (cash band) | Visual |
|---|---|
| Thriving: coins ≥ 60 | Bright warm glow, an extra string of lanterns, busy visitors, the merchant animated and cheerful |
| Healthy: 25–59 | Normal warm glow |
| Tight: 5–24 | Dimmer and cooler light, one lantern flickering, the merchant pacing |
| Dark (closed) | Lights out, shutter down, a "Closed" sign with the reason, the merchant sitting outside |
| Relit (on rescue) | A burst of light, lanterns re-igniting one by one, a cheer |

Market-wide light:

- **Sky and ambient brightness** = 40 % average merchant health + 60 %
  festival progress (boats lit out of 6). Each lit boat adds a visible step.
- **Visitors** on the promenade scale with the crowd budget and demand.
- **The river reflects every light source.** As the market thrives, the
  reflections fill in.

Every light state also has a text label and an icon. Light is never the only
signal, and reduced-motion mode removes the flicker.

---

## 13. Modes

### 13.1 Campaign (3 nights, single player, works offline)

| Night | Teaches | Objective | Setup |
|---|---|---|---|
| 1. First Light | Buy, craft, sell, fill an order, haggle once | Deliver 3 paper lanterns (1 order is personal) | Guided tutorial. Gentle rivals. Grant of 30 coins, 2 paper, 2 oil. |
| 2. The Dark Wharf | Scarcity pricing, cargo limits, rescue offering, dividends | Relight the Oil Wharf (buy 2 of its 4 rescue shares; resident investors hold the other 2), then deliver 2 floating + 2 paper lanterns | Oil shortage. The Oil Wharf starts dark. Unlocks floating lanterns and Cart I. The results screen pays the player's first dividend. |
| 3. Festival of Lights | Strategy votes, expansion offering, events, wishes | Light all 6 boats (a shared goal with rivals) | During preparation, vote the Oil Wharf to "Festival". Paper Mill opens an expansion offering mid-night. Events: `wind_rises`, `visiting_artists`, `festival_rush`. Colored lanterns unlocked. |

Campaign rules:

- A night counts as completed only through confirmed deliveries.
- A player can retry a night from its starting checkpoint. Grants are never
  given twice.
- **Tutorial.** It introduces one thing at a time with a pointer and a short
  line from a merchant, then waits for the player's action. The first
  meaningful action must happen within 20 s, and the whole tutorial must take
  under 90 s. It can be skipped, is saved once done, and can be replayed from
  the journal.
- There is always a way forward after a mistake: sell to the crowd, sell back
  at a loss, haggle, or take a dock job.

**Ending.** All six boats rise with lanterns and fireworks, and the player's
wishes float up. A summary shows:

- coins earned and lanterns crafted
- the stall the player saved
- shares owned and dividends earned
- the merchant who likes the player most

It then offers **Join the live market** and **Endless (offline)**.

### 13.2 Endless (offline, Tier 3)

After night 3, each new night is generated from a seed. Merchant coins, stock,
shares, strategies and drift carry over. Difficulty rises until night 10. The
same conditions never repeat within 3 nights. Each night's seed and content
version are stored.

### 13.3 The live market (server, always on)

- The server runs one public room, **"The Row"**, around the clock with these
  rules:
  - nights cycle continuously (30 s preparation, 5 min open, 30 s results)
  - 3 rivals always trade
  - merchants, shares, strategies and drift all carry over
- Up to **4 human traders** can be active per night. Others can join as
  spectators and become active at the next preparation phase.
- Each player gets a one-time starting grant of 30 coins, 2 paper and 2 oil
  per room.
- Players can also create private rooms (4 seats, rivals fill empty seats),
  which run the same rules.
- Every client sees the same orders, prices, stock, boats, lights, events and
  activity. Other players appear as named carts that glide to the stall
  they last used. Real-time avatar sync is not needed.
- Clients poll `getSnapshot` every 2 s, right after an action, and on focus or
  reconnect. They skip overlapping polls and ignore older revisions.
- **Watch mode.** From the title screen, anyone can watch The Row live
  without signing in. The title screen's background *is* the live market (in
  local mode, the local world).
- **Chronicle.** The server writes a story feed of notable events, for
  example:
  - "Night 412: the Oil Wharf went dark at 2:14. Juno and Ari relit it 40
    seconds later."
  - "Night 413: shareholders voted Bold."
  - "Night 415: all six boats lit, with 14 wishes on the river."

  It records closures, rescues, offerings, buybacks, vote results, record
  prices, boats lit, wishes and players' first visits.
- **Market history page (H).** It has:
  - charts of each good's price at each stall over the last 24 h, 7 days or
    all time
  - each merchant's coins and share price
  - the number of nights each strategy has been used, and its average
    dividend
  - the chronicle beside the charts

  This page shows that the economy evolves without anyone changing the code.
- **Stability.** The live market must run unattended for weeks (section
  21.5).

### 13.4 Market Simulator (fast-forward)

- **CLI**: `npm run simulate -- --nights 200 --seed 42 --traders 4` runs a
  rivals-only simulation headless. It writes `sim-output/<seed>.json`, a CSV
  per tick, and a text summary: closures, rescues, offerings, buybacks,
  strategy outcomes, price extremes, boats lit and invariant checks.
- **In-game**: the title screen's **Market Simulator** button runs a
  rivals-only world at 10×, 60× or 300× speed, with live price and coins charts,
  the chronicle, and pause and seed controls. Seven nights at 300× take about a
  minute.

---

## 14. Art direction: silhouettes and light

The look is **silhouettes against a night sky, where the only color comes
from light**:

- Buildings, people, boats and props are near-black or deep-indigo
  silhouettes with crisp, characterful outlines: curved roofs, awnings,
  hanging goods.
- Color comes only from lantern glows (warm amber, plus each lantern type's
  color), lit stall interiors, signs, the moon and reflections on the water.
- Generate art in code. Draw the silhouettes as vector shapes (Phaser Graphics,
  or SVG built at compile time). Make glows as procedurally generated radial
  gradient textures with additive blending. Make reflections as a flipped,
  vertically squashed, gently wobbling copy of the light layer. CC0 assets
  (for example Kenney) are allowed for icons or sound. List every external
  asset with its source and license in `docs/ASSETS.md`.
- **Characters** are silhouettes with distinct shapes and one personal lantern
  color each. Mira has a wide hat and amber light. Sami has a long coat and
  oil-gold light. Toma is round with green light. Nila is tall with
  indigo-violet light. Asha has a bun and crimson light. The player has a
  handcart and a teal light. Rivals have distinct hats.
- **Animation** is done in code: walk bob, cart wheels, idle sway, talking
  bounce, craft hammering, flag flutter, water shimmer, lantern rise.
- **Stock you can see.** Each stall's crates and hanging goods grow and shrink
  with its stock.
- **Icons** are crisp and readable, for all 8 items, coins, cargo, shares,
  strategies and events.
- **Typography.** One characterful display font for signs and titles and one
  clean UI font, both under OFL or a similar free license and listed in
  ASSETS.md.

---

## 15. Game feel (required)

Every action must feel good. Required feedback:

| Moment | Feedback |
|---|---|
| Buy | Goods fly from the stall into the cart, the coin counter ticks down, a soft "clink" |
| Sell | Coins arc to the HUD counter and land with a sparkle |
| Haggle accepted | The merchant nods, a speech bubble appears, a light "deal!" sting |
| Haggle refused | The merchant shakes their head with a characterful line. No harsh error. |
| Craft | Pieces assemble at the bench in about 1.2 s, a light pops on, the new lantern bobs |
| Price change | The stall sign's arrow flips (▲/▼) with the reason in a tooltip |
| Stall goes dark | Lights fade out one by one, the shutter drops, a low gong |
| Stall relit | Lanterns re-ignite in sequence, visitors cheer, a bright chord |
| Boat lit | Lanterns rise from the dock onto the boat, a chime, the reflection blooms, the sky steps brighter |
| Dividend paid | On results, coins rain into a "Dividends" bar, and each stall shows its contribution |
| Last 60 s of night | Music gains a percussion layer, and the timer pulses gently |
| Pending action | The item shimmers with "Confirming…". Input for other actions stays available. |

Interaction and audio:

- Merchants have speech bubbles: greetings when you approach, reactions to
  events, and memory lines.
- Tooltips explain every number on hover.
- Hover states appear on everything clickable, and the cursor changes.
- **Audio:**
  - river and market ambience
  - one music loop that gains layers as boats light
  - a distinct sound for each action
  - sound sources are CC0 recordings or Web Audio synthesis
  - independent sliders for master, music and effects
- **Reduced motion** removes the screen shake, the flicker and the large
  particles.

---

## 16. Upgrades and progression

| Upgrade | Cost | Effect | Unlock |
|---|---|---|---|
| Cart I | 25 | Cargo 6 → 8 | Night 2 |
| Cart II | 50 | Cargo 8 → 10 | After the campaign |
| Lantern strings (cosmetic) | 15 | Decorates the player's cart with their color | After night 1 |

- Upgrades are permanent for the profile, charged once, and priced before
  purchase.
- **Profile record** (journal): nights played, boats the player helped light,
  stalls rescued, shares held, lifetime dividends, and relationships with each
  merchant. It also shows **titles**: "Lamplighter" for a first boat,
  "Patron" for a first rescue, "Shareholder" for holding shares in 3 stalls,
  and "Master of the Row" for finishing the campaign.

---

## 17. Saving

**Local mode**

- There are 3 save slots in IndexedDB. Writes are atomic, and the previous
  good save is kept as a backup. A failed save shows an "Unsaved" badge.
- Saves can be exported and imported as JSON from Settings, with a version
  check. Corrupt saves offer the backup. Overwriting or deleting a slot asks
  for confirmation and names the slot.
- A save contains:
  - the profile, mode, rules and content versions, and seed
  - unlocks, upgrades and titles
  - relationships
  - the full ledger
  - the active night
  - pending action IDs
- The game saves after every confirmed action and every phase change.

**Server mode**

The server is authoritative. The client caches display data only, always
refetches on load, and never treats local data as a server balance.

---

## 18. Screens

Every screen handles loading, empty, success and error states and works with
mouse and keyboard. A price or health change is never shown by color alone.
Always pair the color with an icon and a word.

| Screen | Contents |
|---|---|
| Title | Live market background; Continue, New campaign, Live market, Watch, Market Simulator, Market history, Settings, Credits; version |
| Profiles | 3 slots with progress and timestamps; overwrite and delete confirmation; corrupt-save recovery |
| Sign-in (server mode) | Uses `AuthClient`. States: signing in, cancel, error with retry. When signed in, shows the name and an optional "Account details" link if `detailsUrl` is set. |
| Rooms | Join The Row, create a private room, join by code, spectate |
| Preparation | Objectives, events, recipes, upgrades, **strategy votes for owned stalls**, last night's dividends, Ready |
| HUD | Coins, cargo, timer, personal objective, boats 0/6, active event, environment label, connection and save status |
| Stall (tabs: Trade / Ownership) | Merchant, health band, stock vs target, price and reason, Thinking line, quantity picker with exact total and cargo change, **Make an offer**, mood hint, 15 s quote countdown, pending/confirmed/failed states; Ownership tab per section 11.1 |
| Offering | Kind (rescue or expansion), reason, price, shares left, your limit, a plain-language risk statement, time left |
| Workshop | Recipes, owned/required inputs, cargo change, locked reason, craft result |
| Notice board | Orders (open, upcoming, filled, expired) with countdowns; dock jobs; share board (Tier 2) |
| Journal | Objectives, recipes, relationships, titles, profile record, tutorial replay, and the activity/transaction history, where each confirmed action shows its receipt label and a "Details" link if `receipt.url` is set |
| Market history | Charts and chronicle (section 13.3) |
| Results | Income and expenses, objectives, boats, dividends per stall, share values, strategy outcomes, next/retry |
| Ending | Celebration and summary, Live market, Endless, Title |
| Settings | Volume sliders, reduced motion, UI scale, graphics quality (low turns off reflections and particles), save export/import |
| Credits | Contributors, tools, asset licenses |
| Pause | Resume, Settings, Journal, Quit. In shared rooms: "The market keeps running." |

Pressing Esc must never cancel a pending action.

---

## 19. Events and recovery

A scenario uses at most 3 events. Each is announced 30 s ahead with a banner
that explains its effect in plain words.

| Event | Effect | Cue |
|---|---|---|
| `oil_late` | A scheduled oil shipment is delayed by 60 s | Empty berth; Sami grumbles |
| `paper_barge` | +8 paper to Paper Mill (a recorded mint) | A barge silhouette docks |
| `wind_rises` | New floating-lantern orders pay +25 % (rounded down) | Flags stream; wind sound |
| `visiting_artists` | New colored-lantern orders pay +25 % | Visitors cluster at the Atelier |
| `quiet_patch` | The crowd buys nothing for 45 s | Fewer visitors; countdown |
| `festival_rush` | A funded bonus order opens for 60 s | A bell rings |

Events change only future quotes. A reserved action keeps its price.

**Dock job.** If a player has fewer than 4 coins and can't craft anything
sellable, the notice board offers a dock job. It takes 20 s of game time and
pays 4 coins from `sys:rescue`, at most twice per night. The player starts it,
carries a parcel to the dock and finishes it. The rules check the elapsed time
and the job ID, so the animation alone never pays.

---

## 20. API contract (server mode)

The client sends every call to `POST /v1/rpc` with `Authorization: Bearer
<credential>`. There is also `POST /v1/auth/dev`. `GET /v1/health` returns
versions and uptime. `GET /v1/public/history` and `GET /v1/public/chronicle`
are read-only and need no credential, for Watch mode and the history page.

```json
{ "version": 1, "request_id": "req-001", "method": "get_quote",
  "params": { "session_id": "the-row", "night_id": "n412",
              "intent": { "type": "buy", "stall_id": "oil_wharf", "item_id": "oil", "quantity": "2" } } }
```

Responses:

- Success: `{ version, request_id, ok: true, result, error: null }`.
- Failure: `{ version, request_id, ok: false, result: null, error: { code,
  message } }`.
- An unknown version fails with `UNSUPPORTED_VERSION`.

Methods mirror `MarketBackend`:

- `list_profiles`, `create_session`, `join_room`
- `get_catalog`, `get_snapshot`
- `get_quote`, `haggle`, `submit_action`, `get_action_status`
- `advance_phase`
- `get_chronicle`, `get_history`
- `get_save_status`

**Intents**

| Type | Fields |
|---|---|
| `buy` / `sell` | `stall_id`, `item_id`, `quantity` |
| `craft` | `recipe_id`, `quantity` |
| `fill_order` | `order_id`, `quantity`, optional `wish_id` |
| `sell_crowd` | `item_id`, `quantity` |
| `buy_upgrade` | `upgrade_id` |
| `buy_offering` | `offering_id`, `shares` |
| `vote_strategy` | `stall_id`, `strategy_id` (preparation only; no coins move, but it uses the same action lifecycle) |
| `accept_buyback` | `buyback_id` |
| `list_shares` / `cancel_listing` / `buy_listing` | `stall_id`, `shares`, `price_per_share` / `listing_id` |
| `start_job` / `finish_job` | — / `job_id` |

A haggle offer is `{ stall_id, item_id, side: "buy" | "sell", quantity,
price_per_unit }`. The reply is `{ outcome: "accept" | "counter" | "refuse",
quote?, line, retry_after_ms }`.

The player's identity comes only from the verified credential. A client never
sends balances.

**Quote**

A quote contains:

- `quote_id` (opaque)
- the intent
- `effects: LedgerOp[]`
- a human-readable summary
- `expires_at`, 15 s after issue

It is bound to the player, room, night and exact amounts.

**Action lifecycle**

An action is `pending`, then `confirmed` or `rejected`. It may instead be
`unknown`, which is still unresolved.

- The client creates `action_id` (a UUID) and saves it **before** submitting.
- Repeating the same ID returns the existing result. The same ID with a
  different quote returns `ACTION_CONFLICT`.
- Each player can have only one unresolved economic action at a time.
- A confirmed action never settles at a worse price than its quote.
- On reconnect, the client resolves its saved pending IDs before allowing new
  actions.

**Snapshot**

A snapshot contains:

- `session_id`, `night_id`, `revision`
- `server_time` in ms, `mode`, `environment_label`, `content_version`,
  `rules_version`
- the phase and its timing
- the player's coins, cargo, upgrades, unlocks, relationships, objectives and
  shares
- for each merchant:
  - stock and target
  - cash band (`thriving`, `healthy`, `tight` or `dark`)
  - price hints with reasons
  - Thinking line, strategy and mood hint
  - share info and any open offering or buyback
- orders, boats (with wishes), events, dock jobs and share listings
- other traders (name, coins band, last stall)
- market light level (0–100)
- the activity log (the last 50 entries, with a cursor)
- pending actions with status and receipt
- save status

Money, quantities and IDs are strings. Revisions and timestamps are safe
integers.

**Error codes.** Each comes with a friendly message and a one-click retry or
re-quote:

- Quotes and prices: `QUOTE_EXPIRED`, `PRICE_CHANGED`
- Orders and haggling: `ORDER_FILLED`, `HAGGLE_COOLDOWN`
- Funds and stock: `INSUFFICIENT_FUNDS`, `OUT_OF_STOCK`,
  `MERCHANT_CANNOT_AFFORD`, `CARGO_FULL`, `MISSING_INGREDIENTS`
- Stalls and shares: `RECIPE_LOCKED`, `STALL_CLOSED`, `OFFERING_CLOSED`,
  `SHARE_LIMIT`, `NOT_SHAREHOLDER`
- Night and phase: `NIGHT_CLOSED`, `WRONG_PHASE`
- Action state: `ACTION_PENDING`, `ACTION_CONFLICT`
- Auth and connection: `AUTH_REQUIRED`, `CONNECTION_UNAVAILABLE`,
  `UNSUPPORTED_VERSION`

Commit Zod schemas and the generated JSON Schema, with examples, for every
request, response, intent, snapshot, `LedgerOp`, history row and chronicle
entry. `docs/API.md` must be complete enough for someone to write a new
`SettlementProvider`, `IdentityProvider`, `StateStore` or `AuthClient` from it
alone.

---

## 21. Tests (all pass on a clean checkout)

### 21.1 Rules (Vitest)

The rules tests cover:

- Recipes and pricing: every recipe, every price threshold for buys and
  sells, batch equals sequential, round trip always loses (including with the
  best haggle), clamps
- Haggling: tolerance bounds, counters, refusals and cooldown
- Relationships: every change and its caps
- Lantern House: crowd budget and per-player limit
- Orders: reservation, partial fills and race
- Wishes: wish attachment
- Crafting: the cargo capacity check
- Events and the dock job: every event, plus dock job timing and limits
- Closure: when a stall closes
- Rescue offerings: escrow, completion and refund
- Expansion offerings: trigger, pricing and timeout refund
- Shares: the 20-share cap and the per-buyer limit
- Votes: share weighting, ties and no voters
- Dividends: net profit only, the 30 % pool, per-share floor and remainder
- Buybacks and the share board: buyback trigger and burn, plus share-board
  escrow and cancel
- Night close: demand drift clamps
- Grants: one-time grants survive retry and reload without duplicating

### 21.2 Ledger invariants

Check after every action in every test that:

- no balance is negative
- supply changes only through mint and burn
- trades, dividends and share sales conserve coins

### 21.3 Golden cases

Write at least 30 JSON files in `tests/golden/`. Each holds a world, timed
intents, and the expected quotes, `LedgerOp`s, statuses and final balances.
Together they cover:

- success and every rejection code
- duplicate `action_id` and `ACTION_CONFLICT`
- reconnect with a pending action
- a late settlement after night close
- a deadline race
- an `unknown` that later confirms
- an `unknown` that later rejects
- a full rescue → vote → dividend cycle
- a buyback

### 21.4 Bot playthroughs

A scripted player drives `MarketBackend` and completes campaign nights 1–3
with fixed seeds, asserting every objective is reachable. It does this both
locally and against the server. A second bot plays 20 nights in a server room.

### 21.5 Economy soak (stability)

Run `npm run simulate -- --nights 2000` with 5 seeds and check:

- no invariant breaks
- prices stay within clamps
- no stall stays dark for more than 5 nights in a row
- at least 3 stalls are open on 95 % of nights
- total coins in merchant accounts stay within a documented band, without
  runaway growth or collapse
- every strategy wins (has the highest average dividend) on at least some
  nights, so no strategy dominates

Add stabilizers (scheduled shipments, crowd budget scaling) as scenario data
until these hold. Commit the results to `docs/BALANCE_REPORT.md`.

### 21.6 Server tests

- Two clients in one room contest the last unit of an order. Exactly one wins,
  and both then see identical stock, boats and lights.
- The dev settlement provider gives correct final states in its delay,
  failure, unknown and duplicate modes.
- A server restart mid-action resolves correctly.
- The live loop runs 500 accelerated nights with no humans and passes the
  soak checks.

### 21.7 End-to-end (Playwright, against the production build)

- **Local**: start a campaign, skip the tutorial, buy, haggle, craft, sell, and
  check that the HUD and stall light update.
- **Server**: two browser contexts join The Row, one fills an order, and both
  see the boat light.
- **Watch mode** and the history page load without signing in.

In dev builds, expose `window.__lantern` with `getSnapshot()`,
`quoteAndSubmit(intent)`, `haggle(offer)` and `setTimeScale(n)`. Add a
`?debug=1` overlay with seed, revision, phase and FPS, plus time-scale and
jump-to-phase controls.

---

## 22. Priority tiers

**Tier 1: the game that must exist**

- Monorepo, protocol schemas, seams and dev implementations
- game-core:
  - ledger, pricing with reasons, haggling and relationships
  - recipes, merchants and rivals
  - orders, wishes, events and the dock job
  - closure, rescue offerings, expansion offerings, strategy votes and
    dividends
- The 2D Row with silhouette art, the full light-shows-the-economy system,
  boats lighting, and the game feel in section 15
- Local campaign nights 1–3 with the tutorial, saving and the ending
- Every screen in section 18 except Market history, Rooms and the share board
- Rules tests, invariants, golden cases, the bot playthrough and the
  simulator CLI
- README, RUNNING, ARCHITECTURE and API docs

**Tier 2: the living market**

- Reference server with dev providers, The Row live loop, private rooms,
  Watch mode
- Chronicle and the market history page
- Buybacks and the share board
- In-game Market Simulator
- The 2000-night soak test and balance report
- Music layers and the full audio set
- Playwright end-to-end tests

**Tier 3: extra polish**

- Offline endless mode, Cart II, extra dialogue and wish variety
- Performance and loading polish

---

## 23. Definition of done and handoff

The build is done when all of the following are true on a **fresh clone**:

1. `npm ci && npm run dev`, with no configuration, lets a new player finish
   nights 1–3, see the ending, and start playing again without help.
2. `npm run dev:server` runs The Row continuously. Two browsers can share it,
   Watch mode and the history page work, and the contested-order test passes.
3. `npm test` and `npm run test:e2e` pass. `npm run build` makes a static
   `apps/web/dist` that runs from any static host. The server URL setting is
   documented.
4. `npm run simulate` works, and `docs/BALANCE_REPORT.md` is committed.
5. Every screen handles loading, empty, error and pending states. No
   placeholder art or text is left in the player's path. Every item in
   section 15 is implemented.
6. In `docs/`, all the files listed in section 3 are complete and accurate.
7. `README.md` has:
   - a one-line pitch: "A night market where every merchant is an AI-run
     business, and you can own a piece of it"
   - a GIF and 3 screenshots
   - a 60-second "how to play"
   - controls and run commands
   - a "Built with" list of libraries, assets and AI tools
8. `HANDOFF.md` lists:
   - each tier, marked done, partial or not done
   - real test output summaries
   - known issues
   - a step-by-step guide, with file paths, to adding a new
     `IdentityProvider`, `SettlementProvider`, `StateStore` and `AuthClient`

**Hand over** the following:

- the repository (pushed to the agreed remote, or a zip including `.git`)
- the commit tagged `game-v1`
- a 2–3 minute screen recording that shows a stall going dark, being rescued
  and relit, and a boat lighting up

Leave no secrets in the repository.
