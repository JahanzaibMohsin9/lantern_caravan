# Lantern Caravan · river-first redesign

7 November 2026. The game becomes a barge trading game: action on the river, trading at the dock, AI merchants with real wallets. Everything below reuses the existing River Run, economy, ledger and NEAR settlement.

## Why

- The barge is hard to find: it hides behind one of eight locations, is "under repair" on Night 1, and the Landing only opens before the market does.
- Too many systems come before anything is fun: walking, buying ingredients, crafting, the order board, shares, votes, rescues.
- Trading doesn't pay. At normal stock a village sells oil for 3 and the Row pays 2 to 3, and every price is 1 to 3 coins, so there are no good or bad deals to find.

## The loop (about 2 minutes, repeated)

1. **The Dock** (the one hub screen). It shows what the Row is short of and pays, what the villages sell for, and the jobs on the Harbor Bell. One big **Cast off** button.
2. **The river.** Buy upriver, fight pirates, salvage, race the clock home. Same River Run as now.
3. **Sell at the Dock.** Each merchant is a card: their cash, their stock and what they pay you for your cargo, with a Sell button. Prices react as you sell. Profit is shown on the summary.
4. **Spend.** Barge upgrades and trims, then (later in the game) shares in the merchants you supply.

## What changes

| Area | Change |
|---|---|
| Title | **Start** puts you at the Dock. The Row's art stays as the backdrop, with no walking. |
| Barge | Available from Night 1, before or during the night. Cast off from the Dock at any time with 45 seconds left. |
| Economy | A merchant short of a river good pays a captain its full asking price for it (up to 3× base when Scarce), not the 70% buy-back, so oil bought upriver for 3 sells for 6 to 9. Rival freight is still paid wholesale, which keeps the AI economy stable in the 5-seed soak. Reedmarsh harvests 16 dye a night (was 14), and a stall closed for lack of stock gets a harbor relief bell even after a cash rescue. (A ×10 price rescale was planned but dropped: it touched about 100 constants for no gain in feel.) |
| Jobs | Harbor Bell contracts are the steady income: guaranteed pay for a delivery, more on dangerous reaches. |
| Campaign | Four river nights (endless nights and live rooms: **Keep the Row supplied**, 2 runs and 12 goods sold): **First Haul** (sell a load at a profit), **The Dark Wharf** (relief haul), **Pirates on the Reach** (break the boom, deliver a contract), **Floodtide** (make it home through the locks). |
| Cut from the player's loop | Lantern crafting, the Order Board and festival boats, dock jobs, the handcart, walking. The merchants still craft and trade among themselves, so the economy and the chain stay the same underneath. |
| Kept | AI merchants and rivals with wallets, wrecks, the almanac, Bell orders, trims, barge looks, shares and rescues (later in the game), live rooms, Watch, NEAR settlement. |

## Order of work

1. **Dock hub and flow** (day 1): Start → Dock, barge from Night 1, sell from the Dock, new campaign objectives.
2. **Economy** (day 2): a profitable haul at fair hauler prices; tuned with the 5-seed soak. Done with day 1.
3. **Feel** (day 3): first-run guidance with one obvious next step, a profit summary after each run, clearer combat and trading feedback.
4. **Tests, live server, README screenshots** (day 4).
