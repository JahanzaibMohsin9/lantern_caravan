import type { RunReport } from "@lantern/protocol";
import { hz, type River } from "./sim";

export function runReport(state: River): RunReport {
  if (!state.outcome) throw new Error("Moor at The Landing to settle the run.");
  // Mooring can end a run before a ram-spill's recovery window expires.
  // Cargo still floating on departure is lost, never silently discarded.
  const lost = { ...state.lost };
  for (const drop of state.drops) for (const [item, units] of Object.entries(drop.cargo ?? {}))
    lost[item] = (lost[item] ?? 0) + units;
  let hash = 2166136261;
  for (const char of JSON.stringify(state.log)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return { run_id: state.manifest.id, seed: state.manifest.seed, durationMs: Math.round(state.frame * 1000 / hz),
    bought: Object.values(state.bought), soldBack: Object.values(state.sold), delivered: { ...state.player.cargo },
    lost, flaresUsed: state.flaresUsed,
    pirates: Object.entries(state.kills).map(([reach, count]) => ({ reach, count, roles: state.roleKills[reach as keyof typeof state.roleKills] })), boomsBroken: [...state.broken],
    escort: state.manifest.contract?.kind === "escort"
      ? { id: state.manifest.contract.id, completed: state.escort === "completed" } : undefined,
    savedBoats: [...state.savedBoats],
    salvaged: Object.entries(state.salvaged).flatMap(([wreck_id, cargo]) => Object.entries(cargo).map(([item_id, quantity]) => ({ wreck_id, item_id, quantity }))),
    stops: [...state.stopsTaken], outcome: state.outcome, inputLogHash: (hash >>> 0).toString(16) };
}
