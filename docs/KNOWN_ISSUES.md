# Known issues and scope

- The three-night campaign runs offline. River Run unlocks on Night 2, where the harbor's relief haul can relight the Oil Wharf. The new Night 3 (Pirates on the Reach), the fourth campaign night and its guided tutorial copy are scheduled for M4.
- Shared rooms support River Runs with the same intents. The Watch river strip and public river history are scheduled for M5.
- Reloading during an offline run returns its reserved goods and contract escrow. A fresh run can start from The Landing.
- Floodtide's lock gates have engine tests and visuals. Scheduling it on festival nights, and server-side replay validation of run reports, are scheduled for M6. Run reports are checked against the manifest's prices, stock, hazards and wall-clock time.
- The reference file store and display-name sign-in are for a single development server. A delayed or unknown action serializes economic changes in that room until it resolves. A different provider can add stronger identity and infrastructure.
- Rival decisions use deterministic policies. They trade and craft profitable order routes, pledge shares, vote, and accept buybacks. They use the direct trade quote for supply purchases.
- The share board supports human listings and sales. Rival positions are traded through offerings and merchant buybacks.
- The game is tested on current desktop Chrome and Playwright Firefox. The UI adapts to narrow viewports; the design and browser regression focus on desktop sizes.
- Vite reports a large Phaser-containing bundle and two harmless Rollup annotations in the installed Zod package. See the size in [Handoff](HANDOFF.md).
