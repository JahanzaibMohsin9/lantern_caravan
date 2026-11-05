# Lantern Row

A night market where every merchant is an AI-run business, and you can own a piece of it.

![Festival boats lighting up in Lantern Row](docs/media/first-light.gif)

## Play

Use Node.js 24.

```sh
npm ci
npm run dev
```

Open the URL Vite prints. In **First Light**, your cart starts with two paper and two oil. Visit the Workshop, craft lanterns, then deliver them at the Order Board. Buy more supplies and deliver three lanterns to unlock **The Dark Wharf**. Help reopen the wharf, earn dividends, and cast a strategy vote before the **Festival of Lights**. After the festival, your cart and shares carry into Endless.

Click a location or use **1–8** to walk there. **A/D** or **←/→** walks manually, **E** interacts, **I** opens the cart, **J** opens the journal, **H** opens history, and **Esc** closes or pauses. Hover an ingredient for its name or click it to find a stall. A local save is automatic.

| First Light | The Dark Wharf | Festival of Lights |
| --- | --- | --- |
| ![The title over the riverside market](docs/media/the-row.png) | ![The closed Oil Wharf and rescue offering](docs/media/dark-wharf.png) | ![The completed festival](docs/media/festival.png) |

## Live market and tests

```sh
npm run dev:server
npm test
npm run build
npx playwright install chromium firefox
npm run test:e2e
npm run simulate -- --nights 2000 --seed 42 --check
```

**Live market** opens the shared public Row or a private room. **Watch** and **History** are public. The development server uses local providers and saves to `apps/server/data/`. See [Running](docs/RUNNING.md) for deployment and test options.

Built with TypeScript, Phaser, React, Vite, Zod, Vitest, Playwright, Lucide, Fontsource, and original procedural art and synthesized audio. OpenAI Codex assisted implementation and verification. [Asset credits](docs/ASSETS.md)

[Handoff](docs/HANDOFF.md) · [Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Balance](docs/BALANCE_REPORT.md) · [Known issues](docs/KNOWN_ISSUES.md)
