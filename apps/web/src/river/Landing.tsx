import { useState } from "react";
import { Anchor, Bell, Coins } from "lucide-react";
import { items, merchants, type ItemId, type StallId } from "@lantern/content";
import { bargeUpgrades, routeDistance, villages, type VillageId } from "@lantern/content/river";
import { routeLead } from "@lantern/river-sim";
import type { Intent, Snapshot } from "@lantern/protocol";

export function Landing({ snapshot, busy, submit, castOff }: { snapshot: Snapshot; busy: boolean;
  submit: (intent: Intent) => Promise<void>; castOff: (intent: Extract<Intent, { type: "start_run" }>) => void }) {
  const unlocked = snapshot.mode !== "live" && (snapshot.mode !== "campaign" || snapshot.night >= 2);
  const canCast = unlocked && snapshot.phase === "preparation";
  const [tab, setTab] = useState<"barge" | "bell">("barge");
  const [plan, setPlan] = useState<Record<string, number>>({ oil: 6 });
  const mine = snapshot.river.contracts.find(contract => contract.mine);
  const loads = Object.entries(snapshot.villages).flatMap(([village, port]) => Object.entries(port.stock).map(([item, stock]) => ({
    village, item, stock, price: port.prices[item]!.buy,
  })));
  const total = loads.reduce((sum, load) => sum + (plan[load.item] ?? 0), 0);
  return <div className="landing">
    <div className="button-pair">
      <button className={tab === "barge" ? "primary" : "subtle"} onClick={() => setTab("barge")}><Anchor size={15}/> Barge</button>
      <button className={tab === "bell" ? "primary" : "subtle"} onClick={() => setTab("bell")}><Bell size={15}/> Harbor Bell</button>
    </div>
    {!unlocked && <p className="hint">{snapshot.mode === "live" ? "Cast off from a local profile." : "The barge is under repair until Night 2."}</p>}
    {unlocked && !canCast && <p className="hint">The barge casts off during night preparation.</p>}
    {tab === "bell" && <div className="prep-list">
      {snapshot.river.contracts.filter(contract => !contract.taken).map(contract => <div className="order-row" key={contract.id}>
        <Bell size={16}/><div className="row-main">
          <strong>{contract.kind === "escort" ? "Escort a rival" :
            contract.quantity + " " + items[contract.item as ItemId].name + " for " + merchants[contract.stall as StallId].name}</strong>
          <small>{villages[contract.village as VillageId].name} · {contract.payout} coins · {contract.mine ? "Accepted" : "Escrowed"}</small>
        </div>
        <button className="subtle" disabled={busy || !canCast || !!mine} onClick={() => void submit({ type: "accept_contract", contract_id: contract.id })}>
          {contract.mine ? "Accepted" : "Accept"}
        </button>
      </div>)}
      {!snapshot.river.contracts.some(contract => !contract.taken) && <p className="hint">The Harbor Bell is quiet. You can still buy cargo upriver.</p>}
      {mine && canCast && <button className="primary wide" disabled={busy} onClick={() => castOff({ type: "start_run", barge_plan: [] })}>
        Cast off for {villages[mine.village as VillageId].name} <Anchor size={16}/>
      </button>}
    </div>}
    {tab === "barge" && canCast && <>
      <p className="hint">{mine ? "The barge will reserve cargo for your accepted contract." :
        "Reserve village stock before departure. You’ll pay for the units you buy upriver."}</p>
      {!mine && <div className="landing-loads" aria-label="Barge plan">
        {loads.map(({ village, item, stock, price }) => <label className="order-row" key={item}>
          <span className="row-main"><strong>{items[item as ItemId].name}</strong>
            <small>{villages[village as VillageId].name} · {price} coins · {stock} in stock</small></span>
          <input type="number" min={0} max={Math.min(Number(stock), Number(snapshot.barge.hold))}
            aria-label={"Reserve " + items[item as ItemId].name} value={plan[item] ?? 0}
            onChange={event => setPlan({ ...plan, [item]: Math.min(Number(stock), Math.max(0, Math.floor(Number(event.target.value) || 0))) })}/>
        </label>)}
      </div>}
      <button className="primary wide" disabled={busy || (!mine && total > Number(snapshot.barge.hold))} onClick={() =>
        castOff({ type: "start_run", barge_plan: mine ? [] : loads.flatMap(({ village, item }) => plan[item] ?
          [{ village_id: village, item_id: item, quantity: String(plan[item]) }] : []) })}>
        Cast off <small>{mine ? mine.kind : total + " / " + snapshot.barge.hold + " hold"}</small><Anchor size={16}/>
      </button>
      <details className="landing-upgrades"><summary>Barge upgrades</summary>
        {Object.entries(bargeUpgrades).filter(([id]) => !snapshot.barge.upgrades.includes(id) &&
          (!id.endsWith("_ii") || snapshot.barge.upgrades.includes(id.replace("_ii", "_i")))).map(([id, upgrade]) =>
          <button className="subtle" key={id} disabled={busy || Number(snapshot.coins) < upgrade.price}
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
