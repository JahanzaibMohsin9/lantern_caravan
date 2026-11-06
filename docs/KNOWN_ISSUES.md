# Known issues and scope

## Current work-package verification (6 November 2026)

System Chrome is the browser used for this session. Firefox, real touch devices, a human new-player usability run, and a full manual playthrough have not been verified in this session. Historical browser claims below describe earlier work. The checked-in media predates the Lantern Caravan rename.

W0–W9 are all delivered. The automated new-player path uses Playwright's simulated river clock; it does not verify that a human unfamiliar with the game can finish it in under three minutes. On the live server, role counts and every other report field are now confirmed by replaying the input log. In shared rooms a run claims every open wreck for its duration, so a second barge sees no wrecks until the first moors; stops are per run and never shared.

- The four-night campaign runs offline. River Run unlocks on Night 2, the Marsh Bend objective is on Night 3, and the festival with Floodtide is on Night 4. Pre-W6 Night 3 festival saves migrate to Night 4.
- Shared rooms support River Runs with the same intents. Watch shows named active barges and shared river conditions; public history includes village and reach series. Barge icons indicate an active run, not a precise position.
- Reloading during an offline run returns its reserved goods and contract escrow. A fresh run can start from The Landing.
- Floodtide is scheduled on festival nights and the live server replays every run report against its manifest. LocalBackend (offline play) checks reports against the manifest but does not replay them: offline, the player is the only one affected.
- NEAR settlement covers the public Row only; private rooms and offline play use the dev ledger. Players settle to derived `*.players.lantern-caravan.testnet` holders until social login, and the operator still signs agents' transfers (NEP-366 agent signing is next). The smoke run is the only live testnet verification so far; a long-running hosted Row has not been tried.
- The reference file store and display-name sign-in are for a single development server. A delayed or unknown action serializes economic changes in that room until it resolves. A different provider can add stronger identity and infrastructure.
- Rival decisions use deterministic policies. They trade and craft profitable order routes, pledge shares, vote, and accept buybacks. They use the direct trade quote for supply purchases.
- The share board supports human listings and sales. Rival positions are traded through offerings and merchant buybacks.
- The game is tested on current desktop Chrome and Playwright Firefox. The UI adapts to narrow viewports; the design and browser regression focus on desktop sizes.
- Vite reports a large Phaser-containing bundle and two harmless Rollup annotations in the installed Zod package. See the size in [Handoff](HANDOFF.md).
