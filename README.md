# Lantern Caravan

A river trading game. Run a barge upriver, buy cargo where it's cheap, fight off pirates, and sell it to the merchants of **Lantern Row**, a night market where every merchant is an AI-run business with its own purse. The game is **Lantern Caravan**; the market is **Lantern Row**.

![The barge on Ember Cut, about to trade at Ember Falls](docs/media/river-run.png)

**Play it now: [lanterncaravan.duckdns.org](https://lanterncaravan.duckdns.org).** **Start** plays the four-night campaign in your browser. **Live market → Join The Row** puts you in the shared public market, which settles on NEAR testnet. **Watch** and **History** need no sign-in.

**Demo post on X:** [x.com/JahanzebM9/status/2119389585843327045](https://x.com/JahanzebM9/status/2119389585843327045) · **Demo video (2 min):** [`docs/media/lantern-caravan-demo.mp4`](docs/media/lantern-caravan-demo.mp4). Built at NEAR HACKATHON (November 2026), track **Games With Real Economies** (`games`).

## The track brief, requirement by requirement

| Requirement | Where it lives | How to see it |
| --- | --- | --- |
| NPC merchants with their own wallets and inventory, pricing from stock and demand | Each merchant, rival hauler and village is an agent with its own balance and its own NEAR account on the public Row. **Each merchant signs its own side of every trade** with its own key, which can only call `agent_settle` (see *On NEAR*) | **Verify on NEAR**: "Merchants sign their own trades" and a "Signed by …" link on every trade; step 7 below reads a merchant's balance from the contract |
| Flood a good and it gets cheap; a broke merchant closes until someone invests | Prices fall as stock passes its target ([`pricing.ts`](packages/game-core/src/pricing.ts)). A stall under 5 coins goes dark and opens a rescue offering that players buy shares in ([`ownership.ts`](packages/game-core/src/ownership.ts)) | **Simulator → Flood Oil Wharf with oil**; campaign Night 2, *The Dark Wharf* |
| Items are NEP-245 multi tokens in one contract | Every coin, good and stall share is a token on [`items.lantern-caravan.testnet`](https://testnet.nearblocks.io/address/items.lantern-caravan.testnet) ([`contracts/items/`](contracts/items/)) | Step 5: each sale is one `game_settle` with two `mt_transfer` events |
| Social or email login; no seed phrases, wallet pop-ups or gas prompts | **Sign in with Google or email** through Privy; the operator settles every action, so players never sign or pay gas | Step 5 |
| Merchant pricing rules in one readable file, with the reasoning in a tooltip | [`packages/game-core/src/pricing.ts`](packages/game-core/src/pricing.ts): the band table, `ask`, `tradePrice` and `explainPrice`. Every list price the game shows, and its explanation, comes from that file | Open any merchant: hover a price, or read the merchant's reasoning under the list (step 3) |
| Fast-forward mode: a week of trading in about a minute | **Simulator → Run a week** plays seven market nights at 60× in about 35 seconds | Step 9 |

## Check it in 5 minutes

Each step says what to do and what you should see. Steps 1 to 6 use the hosted demo; nothing needs a wallet.

1. **Open [lanterncaravan.duckdns.org](https://lanterncaravan.duckdns.org).** You see the Row at night. The footer reads **The Row settles on NEAR testnet · N transactions** and links to the latest one.
2. **Press Verify on NEAR.** With no sign-in you see the contract and its queue, the latest player trades on the public Row ("Sold 2 lamp oil to Paper Mill for 14 coins") with both token legs, each holder's NEAR account and the transaction, **Agents at work** (the latest merchant jobs and hauler decisions), and every agent's own account.
3. **Press Watch.** You see the live public Row, which runs around the clock. Click a stall's name in the bar along the bottom: you see its prices, stock and **Ownership** tab. Under the price list is the merchant's reasoning for the selected good, for example "Sami's reasoning: Scarce: 2 of 12 in stock, ×2.0. Strategy ×1.05. Base 4 → asks 9. Pays 6 for your next unit (full price while short, priced at stock 3)." Hover any price for the same line. The **Upriver** strip shows each reach's danger, booms, village cash and the rival haulers on the river.
4. **Press H (or History).** You see 24-hour and 7-day charts for every stall, village and reach, and the **Chronicle** of the AI agents' decisions with their reasons, such as "Juno: Hauling 3 lamp oil from Ember Falls to Paper Mill for its Harbor Bell job. The Harbor Bell pays 24, costs 8 upriver, danger 2."
5. **Live market → type a display name → Sign in with Google or email → Join The Row.** Privy creates your own NEAR testnet account in the background (no wallet, no seed phrase), and **Your NEAR account** links to it. Plain **Sign in** plays as a guest instead. You arrive at the Dock with a small starting hold. Press a **Sell** button. You see "Confirming…", then the sale in plain words ("Sold 2 lamp oil to Paper Mill for 14 coins") with a **Settled on NEAR** link. The sale has two NEP-245 `mt_transfer` legs: the merchant pays you its coins in an `agent_settle` call that the merchant signed with its own key (for example `mira.lantern-caravan.testnet`), and your goods go to the merchant in the operator's `game_settle`. **Verify on NEAR** links both transactions for every trade.
6. **Press J (Journal).** Every confirmed action is listed with a **Details** link to its transaction.
7. **Read a balance from the chain** (NEAR CLI): `near view items.lantern-caravan.testnet mt_balance_of '{"account_id":"mira.lantern-caravan.testnet","token_id":"coin"}'`. You see the Paper Mill merchant's coin balance on chain. Agents' own trades settle before every player action and otherwise about once an hour, so between those it can trail the game by a few coins.
8. **Run it locally** with no keys: `npm ci && npm run dev`, then **Start** for the four-night campaign. `npm test` passes, and `npm run simulate -- --nights 200 --seed 42 --check` prints the economy summary in a few seconds.
9. **Fast-forward a week.** From the title screen press **Simulator**, then **Run a week**. Seven market nights of rival haulers and merchants play at 60× in about 35 seconds and stop on their own; the chart tracks the Oil Wharf's oil price. Press **Flood Oil Wharf with oil** at any point: a trader sells 12 oil through the normal trade path, the price drops to *Flooded* (×0.6), Sami's reasoning says why, and over the next nights the haulers' buying brings it back. The simulator runs in your browser and sends no transactions.

## Play

Use Node.js 24.

```sh
npm ci
npm run dev
```

Open the URL Vite prints and press **Start**. You arrive at **the Dock**: tonight's goal, a hint for the next step, one **Cast off** button, the Harbor Bell's jobs, your hold, and the Row's merchants. The loop is simple:

1. **Cast off.** The Dock suggests the best run: which village sells a good cheap and which merchant is short of it.
2. **Upriver**, buy cargo at a village, fight off pirates, and race the clock home.
3. **Sell your haul** from the Dock. A merchant short of a good pays you its full asking price, up to three times the base price when it's scarce. Click a merchant's card for the full trade panel and shares.

### The game loop

| Every 30 seconds | Every 5 minutes (one market night) | Every session |
| --- | --- | --- |
| Steer the barge, dodge skiffs, fire at raiders, buy cargo at a village, sell a good to the stall that is shortest of it | Read the Dock for the best run, take a Harbor Bell job, make one or two runs and sell before the night closes. Prices, rival hauls and the river's danger all move in that time | Finish the night's goal, upgrade and repaint the barge, buy shares in stalls (or rescue one that went dark) and collect dividends, earn a village's trusted-hauler stamp |

### Merchant pricing

Every merchant and village list price comes from one file, [`packages/game-core/src/pricing.ts`](packages/game-core/src/pricing.ts); a haggled deal starts from that price. A stall's stock against its target picks a band, the band and the stall's strategy scale the good's base price, and the result is clamped between 2 and three times base:

| Stock vs target | Band | Multiplier |
| --- | --- | --- |
| under 25% | Scarce | ×2.0 |
| 25% to 74% | Low stock | ×1.2 |
| 75% to 125% | Normal | ×1.0 |
| over 125% | Flooded | ×0.6 |

Merchants buy at 70% of their ask, except a river good they are short of, which they buy at the full ask. `explainPrice` in the same file writes the merchant's reasoning shown in the trade panel, so the explanation can't drift from the price. `packages/game-core/src/pricing.test.ts` checks both.

The campaign is four river nights:

| Night | Goal |
| --- | --- |
| 1 · First Haul | **Your first haul**: one run and six goods sold to the Row. |
| 2 · The Dark Wharf | **Relight the wharf**: accept the Harbor Bell's relief job and haul oil from Ember Falls. |
| 3 · Pirates on the Reach | **Clear the reach**: break the Marsh Bend boom and deliver a contract. |
| 4 · The Floodtide | **Ride the Floodtide**: get home through both lock gates when the river rises, and sell eight goods. |

Endless nights and live rooms ask you to **keep the Row supplied**: two runs and twelve goods sold. A local save is automatic. **J** opens the journal, **H** the market history, and **Esc** pauses.

On the river, **WASD** or **arrows** steer, **Shift** boosts, **Space** fires at the nearest threat, and the **mouse** aims and fires manually. **E** trades, moors, salvages a wreck or visits a riverside stop, **Q** spends one oil on a flare, **M** opens the map, **J** opens the Harbor Bell, and **Esc** pauses outside shared rooms. On touchscreens, use the steering stick and the fire, boost and flare buttons. Each run has a 2:30 timer, shorter when you leave late in the night. Leaving during the night costs night time; shared rooms keep trading while you're away.

The **Harbor Bell** lists supply contracts, escorts and relief hauls: guaranteed pay for a delivery. Choose Balanced, Runner, Ironclad or Gunner **trim** on the Dock before you cast off; trims unlock on campaign Night 3 and are always available in Endless and live rooms.

The Dock's drawer (**Barge, upriver prices, wrecks and orders**) holds the rest:

- **Barge upgrades and finishes.** Upgrades add deck crates, iron bands and plating, larger cannons and twin barrels, extra stacks and a stern paddle wheel. Paint, bow lantern and prow figure change appearance only; paid finishes fund harbor relief.
- **Upriver prices** at each village, with the trusted-hauler discount once you've earned it.
- **The harbor almanac**, which warns of village events a night ahead: an oil glut or a pressing strike at Ember Falls, a mill flood at Millbrook, a dye bloom or reed blight at Reedmarsh. Merchants read it too and restock early.
- **Wrecks.** Hauls that pirates sink keep their cargo in the water and open for salvage at the next dusk, for two nights.
- **Bell orders** (live rooms and Endless): name a village good, how many and what you'll pay. Your coins wait at the bell, and rival haulers, each with their own purse, decide whether the job is worth the trip.

Gold **skiffs** ram your barge and spill cargo: recover it within 20 seconds. Coral **raiders** patrol at medium range; purple **gunboats** fire twin shots from farther away. Bounties are 6, 8 and 14 coins, while the harbor fund lasts. Two or three optional **riverside stops** appear on each run (a stranded fisher, a lock keeper's shed, an overturned punt), each offering one choice of hull, fuel or ammo.

On festival nights the river rises in a **Floodtide**. If you're upriver when it starts, you have 60 seconds to sail through both lock gates and moor at The Landing. Make it and a supply contract pays its premium twice; miss it and the village you bought from takes the cargo back at its buyback price.

| The Dock | Home with a haul | Campaign complete |
| --- | --- | --- |
| ![The Dock on Night 1: tonight's goal, Cast off, jobs and merchants](docs/media/dock.png) | ![Back at the Dock with twelve lamp oil to sell](docs/media/dock-haul.png) | ![The campaign's ending](docs/media/festival.png) |

## The agents

The Row's merchants, rival haulers and villages are agents with their own balances (and their own NEAR accounts on the public Row). They run the economy between players, and every decision goes in the public Chronicle with its reason. One shortage, from the live world:

1. **A merchant posts a funded job.** "Paper Mill rang the Harbor Bell: 3 lamp oil from Ember Falls for 24 coins (stock 1 of 4, 12 extra for the trip and danger 2)." The coins go into the Bell's escrow.
2. **A hauler decides it's worth it.** "Juno: Hauling 3 lamp oil from Ember Falls to Paper Mill for its Harbor Bell job. The Harbor Bell pays 24, costs 8 upriver, danger 2." Haulers score every job by margin against distance and route danger.
3. **The others coordinate.** "Ren left Paper Mill's lamp oil job to Juno, who took it first, and is hauling paper for Paper Mill instead." A hauler counts the cargo already on other barges before it sizes a load, so two haulers don't fill the same shortage.
4. **Delivery and pay.** "Juno delivered 3 lamp oil to Paper Mill and collected the Harbor Bell's 24 coins." The stall's stock rises and its price eases.
5. **The river changes for everyone.** Safe hauls fend off pirates: "Ren's convoys drove pirates off Heron Reach (danger 2 → 1)." Calmer reaches change which routes the next hauler, or captain, finds worth taking.

The rules live in `packages/game-core/src/river.ts` (`refreshContracts`, `startRivalHaul`, `supplyOptions`, `resolveHaul`, `fendOff`); `tests/agent-chain.test.ts` checks the whole chain on a seeded live world. **Verify on NEAR → Agents at work** shows the latest of these lines.

## On NEAR

The public Row's economy lives on NEAR testnet. Every coin, good and stall share is a token on one NEP-245 multi-token contract, [`items.lantern-caravan.testnet`](https://testnet.nearblocks.io/address/items.lantern-caravan.testnet) (source in [`contracts/items/`](contracts/items/)).

- **Players.** Each confirmed action in the public Row (a sale at the Dock, a purchase, a haul settled at the Landing) is its own `game_settle` transaction, keyed by the action's id so a retry can't settle twice. The game shows **Settled on NEAR** with a link to the transaction, and the Journal keeps a link for every action.
- **Merchants sign their own trades.** Each of the five merchants (`mira`, `sami`, `toma`, `nila` and `asha` `.lantern-caravan.testnet`) holds a function-call key that can call only `agent_settle` on the items contract, and `agent_settle` moves only the caller's own balances: it refuses mints, burns and any transfer out of another holder. Whenever a merchant's goods or coins leave its account, in a player trade or in the agents' own trading, the server signs that leg with the merchant's key as a NEP-366 delegate action, and the operator relays it and pays the gas, without being able to change it. `npm run near:agent-keys -- --check` has every merchant sign a transfer out of another merchant's account and shows the contract refusing each one ([key setup](tools/near-agent-keys.ts), [signing and relay](apps/server/src/near/chain.ts), [who signs which leg](apps/server/src/near/provider.ts)).
- **Rival haulers and villages** are registered agent accounts with their own balances too. Their legs, harvests and harbor funds are settled by the operator in `game_settle_batch` transactions: before every player action, and otherwise about once an hour.
- **Conservation.** Goods enter the economy only through village harvests and leave only when they're used up; every trade is a transfer between holders. `npm run near:verify -- --data <data folder>` reads every holder's balance from the contract and checks it against the live Row.
- **Social login.** **Sign in with Google or email** uses [Privy](https://privy.io): it creates the player's own NEAR testnet account (an implicit account from a Privy embedded wallet), and the server checks Privy's identity token against the app's public keys before trusting it. That account is the player's ID, so their coins, goods and shares settle to an account they own. The player never signs anything or pays gas; the game's operator settles every action.
- **What's local.** Private rooms and the offline campaign use a local ledger. Guests (display name only) settle to derived `*.players.lantern-caravan.testnet` holders. Players never sign: the operator settles their legs, so the game has no wallet prompts.

The footer links the contract and counts settled transactions, and `GET /v1/chain/status` reports the queue and the latest transaction. [Running](docs/RUNNING.md#near-testnet-settlement) covers settlement setup and checks.

## Live market and tests

```sh
npm run dev:server
npm test
npm run build
# PowerShell: use system Chrome; no browser download needed.
$env:LANTERN_CHROME_CHANNEL = "chrome"
npm run test:e2e -- --project=chrome
npm run simulate -- --nights 2000 --seed 42 --check
```

**Live market** opens the shared public Row or a private room. **Watch** and **History** are public. The river strip shows reach danger, booms, village cash bands and who is upriver. History includes village cash, source prices and available stock, plus reach danger and booms. Deliver two supply contracts for the same village to earn its trusted-hauler stamp and 10% off future village purchases. The development server uses local providers and saves to `apps/server/data/`. See [Running](docs/RUNNING.md) for deployment and test options.

## How it was made

- **Author.** Built by Jahanzeb Mohsin, solo developer.
- **Built during the hackathon.** Development started in November 2026; the first commit is dated 5 November 2026.
- **Other project.** Jahanzeb Mohsin's other, independent hackathon project is [Kinwarden](https://github.com/JahanzaibMohsin9/kinwarden). The two share no code or contracts.
- **Built with** TypeScript, Phaser, React, Vite, Zod, Vitest, Playwright, Lucide, Fontsource, Privy (social login), jose and near-sdk (Rust), with original procedural art and synthesized audio. [Asset credits](docs/ASSETS.md)
- **AI tools.** OpenAI Codex and Claude Code assisted implementation, testing and documentation. The demo video's narration was generated with Gemini TTS and its music with Lyria.
- **Testnet only.** Every token lives on NEAR testnet; nothing in the game has real-world value.

[Handoff](docs/HANDOFF.md) · [Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Balance](docs/BALANCE_REPORT.md) · [Known issues](docs/KNOWN_ISSUES.md)
