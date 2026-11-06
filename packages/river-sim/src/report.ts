import { runReportSchema, type RunManifest, type RunReport } from "@lantern/protocol";
import { hz, replayRiver, type River } from "./sim";

export function runReport(state: River): RunReport {
  if (!state.outcome) throw new Error("Moor at The Landing to settle the run.");
  // Mooring can end a run before a ram-spill's recovery window expires.
  // Cargo still floating on departure is lost, never silently discarded.
  const lost = { ...state.lost };
  for (const drop of state.drops) for (const [item, units] of Object.entries(drop.cargo ?? {}))
    lost[item] = (lost[item] ?? 0) + units;
  const failedFlood = !!state.floodtide && state.outcome !== "moored";
  return { run_id: state.manifest.id, seed: state.manifest.seed, durationMs: Math.round(state.frame * 1000 / hz),
    bought: Object.values(state.bought), soldBack: Object.values(state.sold), delivered: failedFlood ? {} : { ...state.player.cargo },
    lost, flaresUsed: state.flaresUsed,
    pirates: Object.entries(state.kills).map(([reach, count]) => ({ reach, count, roles: state.roleKills[reach as keyof typeof state.roleKills] })), boomsBroken: [...state.broken],
    escort: state.manifest.contract?.kind === "escort"
      ? { id: state.manifest.contract.id, completed: state.escort === "completed" } : undefined,
    savedBoats: [...state.savedBoats],
    salvaged: Object.entries(state.salvaged).flatMap(([wreck_id, cargo]) => Object.entries(cargo).map(([item_id, quantity]) => ({ wreck_id, item_id, quantity }))),
    stops: [...state.stopsTaken], outcome: state.outcome,
    floodtide: state.floodtide ? { gates: state.floodtide.next, completed: state.outcome === "moored", returned: failedFlood ? { ...state.player.cargo } : {} } : undefined,
    inputLog: structuredClone(state.log), inputLogHash: inputLogHash(state.log) };
}


/** Stable object ordering survives schema parsing and transport without changing the binding. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => JSON.stringify(key) + ":" + canonical(entry)).join(",") + "}";
  return JSON.stringify(value);
}
export function inputLogHash(log: unknown): string {
  let hash = 2166136261;
  for (const char of canonical(log)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}


/** Bounded replay is authoritative: no claimed result can bypass the recorded voyage. */
export function verifyRunReport(manifest: RunManifest, submitted: unknown): RunReport {
  const parsed = runReportSchema.safeParse(submitted);
  if (!parsed.success) throw new Error("RIVER_REPLAY · Malformed or oversized input log.");
  const report = parsed.data, log = report.inputLog;
  const frames = Math.round(report.durationMs * hz / 1000);
  if (!log?.length || report.run_id !== manifest.id || report.seed !== manifest.seed || frames < 1 || frames > 9000 ||
    Math.round(frames * 1000 / hz) !== report.durationMs || log[0]!.frame !== 0 ||
    log.some((entry, i) => entry.frame >= frames || (i > 0 && entry.frame <= log[i - 1]!.frame)) ||
    inputLogHash(log) !== report.inputLogHash) throw new Error("RIVER_REPLAY · The input log does not match this voyage.");
  const replay = replayRiver(manifest, log, frames);
  if (!replay.outcome || replay.frame !== frames || canonical(runReport(replay)) !== canonical(report))
    throw new Error("RIVER_REPLAY · The recorded voyage does not match the report.");
  return report;
}
