import type { RunReport } from "@lantern/protocol";
import { hz, type River } from "./sim";

export function runReport(state: River): RunReport {
  if (!state.outcome) throw new Error("Moor at The Landing to settle the run.");
  let hash = 2166136261;
  for (const char of JSON.stringify(state.log)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return { run_id: state.manifest.id, seed: state.manifest.seed, durationMs: Math.round(state.frame * 1000 / hz),
    bought: Object.values(state.bought), soldBack: Object.values(state.sold), delivered: { ...state.player.cargo },
    lost: { ...state.lost }, flaresUsed: state.flaresUsed,
    pirates: Object.entries(state.kills).map(([reach, count]) => ({ reach, count })), boomsBroken: [...state.broken],
    escort: state.manifest.contract?.kind === "escort"
      ? { id: state.manifest.contract.id, completed: state.escort === "completed" } : undefined,
    savedBoats: [...state.savedBoats], outcome: state.outcome, inputLogHash: (hash >>> 0).toString(16) };
}
