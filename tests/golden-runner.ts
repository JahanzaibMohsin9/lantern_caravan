import { closeNight, commitFor, createWorld, newNight, openNight, quoteFor, snapshotFor } from "@lantern/game-core";
import { haggle } from "@lantern/game-core/haggle";
import type { HaggleOffer, Intent, LedgerOp, Quote } from "@lantern/protocol";
import { apply } from "../packages/game-core/src/ledger";

const actor = "p:guest";
type Step = { at: number; intent: Intent; commitAt?: number } | { at: number; offer: HaggleOffer; accept?: boolean };
export type Fixture = { seed: number; scenario: "first" | "dark" | "reach" | "festival" | "closed" | "prepared"; setup?: LedgerOp[]; steps: Step[] };

export function runFixture(fixture: Fixture) {
  let world = createWorld("campaign", fixture.seed);
  if (fixture.scenario !== "prepared") world = openNight(world);
  if (fixture.scenario === "closed") world = closeNight(world);
  if (fixture.scenario === "dark") world = openNight(newNight(closeNight(world)));
  if (fixture.scenario === "reach" || fixture.scenario === "festival") {
    for (let night = 1; night < (fixture.scenario === "reach" ? 3 : 4); night++) world = openNight(newNight(closeNight(world)));
  }
  if (fixture.setup) world = { ...world, ledger: apply(world.ledger, fixture.setup) };
  const statuses = fixture.steps.map((step, index) => {
    world = { ...world, elapsed: step.at / 1000 };
    const id = "quote-" + index;
    try {
      let deal: Quote;
      if ("offer" in step) {
        const result = haggle(world, step.offer, id, step.at);
        world = result.state;
        if (!result.result.quote || !step.accept) return { state: result.result.outcome, quote: result.result.quote };
        deal = result.result.quote;
      } else {
        deal = quoteFor(world, actor, step.intent, id, step.at);
      }
      world = commitFor(world, actor, deal, "commitAt" in step && step.commitAt !== undefined ? step.commitAt : step.at);
      if (Object.values(world.ledger).some(wallet => Object.values(wallet).some(amount => !Number.isSafeInteger(amount) || amount < 0))) {
        throw new Error("Invalid ledger balance.");
      }
      return { state: "confirmed", quote: deal };
    } catch (error) {
      return { state: "rejected", error: (error as Error).message };
    }
  });
  const snapshot = snapshotFor(world, "golden");
  return { statuses, ...(fixture.scenario === "reach" || fixture.scenario === "festival" ? {
    night: snapshot.night, name: snapshot.nightName, objective: snapshot.objective, orders: snapshot.orders,
  } : {}), balances: { coins: snapshot.coins, cargo: snapshot.cargo,
    shares: snapshot.merchants.oil_wharf?.owned, delivered: snapshot.delivered, crafted: snapshot.crafted } };
}
