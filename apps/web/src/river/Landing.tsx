import { useState } from "react";
import { Anchor, Bell, Coins, Flame, LifeBuoy } from "lucide-react";
import { items, merchants, type ItemId, type StallId } from "@lantern/content";
import { bargeUpgrades, routeDistance, villages, type VillageId } from "@lantern/content/river";
import { routeLead } from "@lantern/river-sim";
import type { Intent, Snapshot } from "@lantern/protocol";
import { cargoColor } from "./render";

/** Seconds of night that must remain to cast off once the market is open. */
const lateCutoff = 45;

export function Landing({ snapshot, busy, submit, castOff }: { snapshot: Snapshot; busy: boolean;
  submit: (intent: Intent) => Promise<void>; castOff: (intent: Extract<Intent, { type: "start_run" }>) => void }) {
  const unlocked = snapshot.mode !== "campaign" || snapshot.night >= 2;
  const left = snapshot.duration - snapshot.elapsed;
  const canCast = unlocked && !snapshot.spectator && (snapshot.phase === "preparation" || (snapshot.phase === "open" && left >= lateCutoff));
  const contracts = snapshot.river.contracts.filter(contract => !contract.taken);
  const [tab, setTab] = useState<"barge" | "bell">(contracts.some(contract => contract.relief) ? "bell" : "barge");
  const mine = snapshot.river.contracts.find(contract => contract.mine);
  const loads = Object.entries(snapshot.villages).flatMap(([village, port]) => Object.entries(port.stock).map(([item, stock]) => ({
    village, item, stock, price: port.prices[item]!.buy, label: port.prices[item]!.label,
  })));
  const leads = routeLeads(snapshot).slice(0, 3);
  const leaving = snapshot.phase === "open"
    ? snapshot.mode === "live" ? "The Row keeps trading while you're upriver." : "The night's clock moves on by the length of your trip."
    : "Runs before the market opens cost no market time.";
  const ordered = [...contracts].sort((a, b) => Number(!!b.relief) - Number(!!a.relief));
  return <div className="landing">
    <div className="button-pair">
      <button className={tab === "barge" ? "primary" : "subtle"} onClick={() => setTab("barge")}><Anchor size={15}/> Barge</button>
      <button className={tab === "bell" ? "primary" : "subtle"} onClick={() => setTab("bell")}><Bell size={15}/> Harbor Bell
        {contracts.length > 0 && <span className="bell-count">{contracts.length}</span>}</button>
    </div>
    {!unlocked && <p className="hint">The barge is under repair until Night 2.</p>}
    {unlocked && !canCast && !snapshot.spectator && <p className="hint">{snapshot.phase === "open" ? "Too late to cast off tonight. The barge leaves again at preparation." :
      "The river is closed until the next evening."}</p>}
    {tab === "bell" && <div className="prep-list">
      {ordered.map(contract => <div className={"order-row" + (contract.relief ? " relief-row" : "")} key={contract.id}>
        {contract.relief ? <LifeBuoy size={16}/> : <Bell size={16}/>}<div className="row-main">
          <strong>{contract.kind === "escort" ? "Escort a rival" : contract.relief
            ? "Relight " + merchants[contract.stall as StallId].name + " · " + contract.quantity + " " + items[contract.item as ItemId].name
            : contract.quantity + " " + items[contract.item as ItemId].name + " for " + merchants[contract.stall as StallId].name}</strong>
          <small>{villages[contract.village as VillageId].name} · {contract.payout} coins{contract.relief ? " from the harbor, plus a restart float for the stall" : " · Escrowed"}{contract.mine ? " · Accepted" : ""}</small>
        </div>
        <button className="subtle" disabled={busy || !canCast || !!mine} onClick={() => void submit({ type: "accept_contract", contract_id: contract.id })}>
          {contract.mine ? "Accepted" : "Accept"}
        </button>
      </div>)}
      {!contracts.length && <p className="hint">The Harbor Bell is quiet. You can still buy cargo upriver.</p>}
      {mine && canCast && <button className="primary wide" disabled={busy} onClick={() => castOff({ type: "start_run", barge_plan: [] })}>
        Cast off for {villages[mine.village as VillageId].name} <Anchor size={16}/>
      </button>}
    </div>}
    {tab === "barge" && <>
      {canCast && <p className="hint">{mine ? "Your accepted contract sets the course. " : "Buy freely at any village upriver, up to a full hold. "}{leaving}</p>}
      <div className="landing-board" aria-label="Upriver prices">
        {loads.map(({ village, item, stock, price, label }) => <div className="landing-load" key={item}>
          <i style={{ background: cargoColor[item] }}/>
          <span><strong>{items[item as ItemId].name}</strong><small>{villages[village as VillageId].name} · {stock} in stock · {label}</small></span>
          <b>{price}<Coins size={12}/></b>
        </div>)}
      </div>
      {leads.length > 0 && <div className="landing-leads"><small>Best spot hauls</small>
        {leads.map(lead => <span key={lead.item + lead.stall}><Flame size={12}/>{items[lead.item as ItemId].name}: {lead.port} {lead.buy} → {merchants[lead.stall as StallId].name} {lead.sell}</span>)}
      </div>}
      {canCast && <button className="primary wide" disabled={busy} onClick={() => castOff({ type: "start_run", barge_plan: [] })}>
        Cast off <small>{mine ? mine.kind === "escort" ? "escort" : "contract" : snapshot.barge.hold + "-unit hold"}</small><Anchor size={16}/>
      </button>}
      <details className="landing-upgrades"><summary>Barge upgrades</summary>
        {Object.entries(bargeUpgrades).filter(([id]) => !snapshot.barge.upgrades.includes(id) &&
          (!id.endsWith("_ii") || snapshot.barge.upgrades.includes(id.replace("_ii", "_i")))).map(([id, upgrade]) =>
          <button className="subtle" key={id} disabled={busy || Number(snapshot.coins) < upgrade.price || !canCast}
            onClick={() => void submit({ type: "buy_barge_upgrade", upgrade_id: id })}>{upgrade.name} · {upgrade.price} <Coins size={13}/></button>)}
      </details>
    </>}
  </div>;
}

export function routeLeads(snapshot: Snapshot) {
  return Object.entries(snapshot.villages).flatMap(([id, village]) => {
    const port = villages[id as VillageId];
    const risk = snapshot.river.reaches.filter(reach => reach.id === port.reach || reach.id === "heron_reach")
      .reduce((sum, reach) => sum + reach.danger * .6 + Number(reach.boom) * 2, 0);
    return Object.entries(village.prices).flatMap(([item, quote]) => Object.entries(snapshot.merchants)
      .filter(([, stall]) => stall.band !== "dark" && stall.prices[item] && Number(stall.stock[item]) < Number(stall.prices[item]!.target))
      .map(([stall, market]) => ({ item, stall, port: port.name, buy: Number(quote.buy), sell: Number(market.prices[item]!.sell),
        score: routeLead(Number(market.prices[item]!.sell), Number(quote.buy), routeDistance(id as VillageId), risk) })));
  }).sort((a, b) => b.score - a.score).slice(0, 5);
}
