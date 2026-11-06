import { Ship, Waves } from "lucide-react";
import { villages } from "@lantern/content/river";
import type { Snapshot } from "@lantern/protocol";

export function RiverStrip({ snapshot }: { snapshot: Snapshot }) {
  const upriver = new Set(snapshot.river.upriver.map(run => run.actor));
  return <aside className="watch-river" aria-label="River watch">
    <div className="split"><strong><Waves size={15}/> Upriver</strong><small>Shared river conditions</small></div>
    <div className="watch-route">
      {snapshot.river.reaches.map(reach => <div className={"watch-reach danger-" + reach.danger} key={reach.id}>
        <b>{reach.name}</b><span>Danger {reach.danger}/5 · {reach.boom ? "Boom blocking" : "Clear passage"}</span>
      </div>)}
    </div>
    <div className="watch-villages">
      {Object.entries(villages).map(([id, village]) => <span key={id}>{village.name} <b className={"band " + snapshot.villages[id]?.band}>{snapshot.villages[id]?.band}</b></span>)}
    </div>
    <div className="watch-boats" aria-label="River seats">
      {snapshot.traders.map(trader => <span key={trader.id} className={upriver.has(trader.id) ? "upriver-seat" : ""}>
        {upriver.has(trader.id) && <Ship size={16}/>} {trader.name} · {upriver.has(trader.id) ? "Upriver" : "At the Row"}
      </span>)}
    </div>
  </aside>;
}
