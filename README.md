# Lantern Row

A night market where every merchant is an AI-run business, and you can own a piece of it.

This first playable build covers **First Light**, the opening night of the local campaign.

```sh
npm ci
npm run dev
```

Use Node.js 24. Open the local URL printed by Vite.

## Play First Light

- Enter the Row and craft paper lanterns at the Workshop. Your cart starts with two paper and two lamp oil.
- Take lanterns to the Order Board to light the festival boats, or sell them to the crowd at Lantern House.
- Buy more supplies at Paper Mill and Oil Wharf. Use **Make an offer** to haggle.
- Deliver three lanterns and select **Close the night** to see your results.

Click a stall or route button to walk there. Use **A/D** or the arrow keys to walk, **E** to interact, **1–8** for route shortcuts, **I** for the cart, and **Esc** to close a panel or pause. **Continue** restores the browser's local save.

`npm test` runs the rules tests. `npm run build` type-checks and builds the static client into `apps/web/dist`.

Built with TypeScript, Phaser, React, Vite, Zod, Lucide, and procedurally drawn artwork. See [asset credits](docs/ASSETS.md), [milestone status](docs/HANDOFF.md), and [the build specification](GAME_BUILD_SPEC.md).
