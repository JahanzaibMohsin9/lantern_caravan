import { useState } from "react";
import { Anchor, ArrowRight, Bell, Coins, Compass, LifeBuoy, ShoppingBasket, Store } from "lucide-react";
import { items, merchants, type ItemId, type StallId } from "@lantern/content";
import { floodtideOpens } from "@lantern/content/nights";
import { bargeTrims, sourceFor, villages, type BargeTrimId, type VillageId } from "@lantern/content/river";
import type { Intent, Snapshot } from "@lantern/protocol";
import { ItemIcon } from "../ui/icons";
import { Landing, routeLeads } from "./Landing";
import "./river.css";
import { cargoColor } from "./render";

/** Seconds of night that must remain to cast off once the market is open. */
const lateCutoff = 45;
const bandLabel = { thriving: "Thriving", healthy: "Healthy", tight: "Tight", dark: "Closed" } as const;

/** Coins at cast-off and on the way home, so the Dock can show what the last run made. */
export type Voyage = { night: string; start: number; home?: number; units?: number; spent?: number };
const signed = (value: number) => (value > 0 ? "+" : value < 0 ? "−" : "") + Math.abs(value);

type Props = {
  snapshot: Snapshot; busy: boolean; online: boolean;
  submit: (intent: Intent) => Promise<void>;
  castOff: (intent: Extract<Intent, { type: "start_run" }>) => void;
  openStall: (stall: StallId) => void;
  closeNight?: () => void;
  voyage?: Voyage;
};

/** The hub of the game: what to do next, one Cast off button, jobs, and selling your haul to the Row's merchants. */
export function Dock({ snapshot, busy, online, submit, castOff, openStall, closeNight, voyage }: Props) {
  const [trim, setTrim] = useState<BargeTrimId>(snapshot.barge.trim);
  const trimsUnlocked = snapshot.mode !== "campaign" || snapshot.night >= 3;
  const left = snapshot.duration - snapshot.elapsed;
  const floodOpens = floodtideOpens(snapshot.night, snapshot.mode, snapshot.seed);
  const floodClosed = snapshot.phase === "open" && floodOpens !== undefined && snapshot.elapsed >= floodOpens;
  const canCast = !floodClosed && (snapshot.phase === "preparation" || (snapshot.phase === "open" && left >= lateCutoff));
  const marketOpen = snapshot.phase === "open";
  const contracts = snapshot.river.contracts.filter(contract => !contract.taken)
    .sort((a, b) => Number(!!b.relief) - Number(!!a.relief) || Number(b.payout) - Number(a.payout));
  const mine = snapshot.river.contracts.find(contract => contract.mine);
  const lead = routeLeads(snapshot)[0];
  const hold = Object.entries(snapshot.cargo).filter(([, count]) => Number(count) > 0)
    .map(([item, count]) => ({ item: item as ItemId, count: Number(count) }));
  const steps = snapshot.objective.steps;
  const next = nextStep(snapshot, hold.length > 0, !!mine, canCast);

  return <section className="dock" aria-label="The Dock">
    <div className="dock-column">
      <header className="dock-card dock-head">
        <span className="eyebrow">THE DOCK · {snapshot.nightName.toUpperCase()}</span>
        <h2>{snapshot.objective.complete ? "Night complete" : snapshot.objective.name}</h2>
        <div className="dock-steps">
          {steps.map(step => <span key={step.label} className={Number(step.count) >= Number(step.target) ? "done" : ""}>
            {step.label} <b>{step.count}/{step.target}</b></span>)}
        </div>
        <p className="dock-next" role="status"><Compass size={15}/> {next}</p>
        {snapshot.objective.complete && closeNight && <button className="primary wide" disabled={busy} onClick={closeNight}>
          Close the night <ArrowRight size={16}/></button>}
      </header>

      <div className="dock-card dock-cast">
        <span className="eyebrow">THE BARGE · {snapshot.barge.hold}-UNIT HOLD</span>
        {mine ? <p className="dock-lead"><Bell size={15}/> Job: {mine.kind === "escort" ? "escort a rival home" : mine.quantity + " " +
          items[mine.item as ItemId].name.toLowerCase() + " from " + villages[mine.village as VillageId].name} · {mine.payout} coins</p>
          : lead ? <p className="dock-lead"><i style={{ background: cargoColor[lead.item] }}/> Best run: <b>{items[lead.item as ItemId].name}</b> from {lead.port} at {lead.buy}
            <ArrowRight size={13}/> {merchants[lead.stall as StallId].name} pays {lead.sell}</p>
          : <p className="dock-lead">{contracts.length ? "Every stall is stocked. Take a Harbor Bell job, or hunt pirates for bounties."
            : "Every stall is stocked for now. Hunt pirates for bounties, or wait for a merchant to run short."}</p>}
        <label className="dock-trim"><span>Trim</span>
          <select aria-label="Barge trim" value={trim} disabled={busy || !canCast || !trimsUnlocked} onChange={event => setTrim(event.target.value as BargeTrimId)}>
            {Object.entries(bargeTrims).map(([id, value]) => <option key={id} value={id}>{value.name}</option>)}
          </select>
          <small>{trimsUnlocked ? bargeTrims[trim].description : "Trims unlock on Night 3."}</small>
        </label>
        <button className="primary wide dock-castoff" disabled={busy || !canCast || snapshot.spectator}
          onClick={() => castOff({ type: "start_run", barge_plan: [], trim })}>
          <Anchor size={18}/> Cast off {mine ? "for " + villages[mine.village as VillageId].name : ""}</button>
        {!canCast && <p className="hint">{floodClosed ? "Floodtide has closed the river until the next dusk."
          : snapshot.phase === "results" ? "The river is closed until the next evening." : "Too late to cast off tonight."}</p>}
        {canCast && <p className="hint">{online ? "The Row keeps trading while you're upriver."
          : marketOpen ? "The night's clock moves on by the length of your trip." : "Runs before the market opens cost no market time."}</p>}
      </div>

      <div className="dock-card dock-jobs" aria-label="Harbor Bell jobs">
        <span className="eyebrow">HARBOR BELL · JOBS</span>
        {contracts.slice(0, 4).map(contract => <div className={"dock-job" + (contract.relief ? " relief" : "")} key={contract.id}>
          {contract.relief ? <LifeBuoy size={16}/> : <Bell size={16}/>}
          <span><strong>{contract.kind === "escort" ? "Escort a rival home" : (contract.relief ? "Relight " + merchants[contract.stall as StallId].name + ": " : "") +
            contract.quantity + " " + items[contract.item as ItemId].name.toLowerCase() + " from " + villages[contract.village as VillageId].name}</strong>
            <small>{contract.payout} coins{contract.relief ? " from the harbor" : " held at the bell"}</small></span>
          <button className="subtle" disabled={busy || !canCast || (!!mine && !contract.mine)}
            onClick={() => void submit({ type: "accept_contract", contract_id: contract.id })}>{contract.mine ? "Accepted" : "Accept"}</button>
        </div>)}
        {!contracts.length && <p className="hint">No jobs right now. Merchants ring the bell when they run short.</p>}
      </div>
    </div>

    <div className="dock-column">
      {voyage?.home !== undefined && (voyage.units || voyage.home !== voyage.start) && <LastRun voyage={voyage} coins={Number(snapshot.coins)} hold={hold} snapshot={snapshot}/>}
      <div className="dock-card dock-sell" aria-label="Sell your haul">
        <span className="eyebrow"><ShoppingBasket size={13}/> YOUR HOLD</span>
        {!hold.length && <p className="hint">Your hold is empty. Cast off, buy cargo upriver, and bring it back to sell here.</p>}
        {hold.length > 0 && !marketOpen && <p className="hint">The market opens soon. You can sell once it does.</p>}
        {hold.map(({ item, count }) => {
          const buyers = Object.entries(snapshot.merchants)
            .filter(([, market]) => market.band !== "dark" && market.prices[item])
            .map(([stall, market]) => ({ stall: stall as StallId, price: Number(market.prices[item]!.sell), coins: Number(market.coins),
              short: Number(market.stock[item]) < Number(market.prices[item]!.target) }))
            .sort((a, b) => b.price - a.price);
          const best = buyers[0];
          const quantity = best ? Math.max(1, Math.min(count, Math.floor(best.coins / Math.max(1, best.price)))) : 0;
          return <div className="dock-hold" key={item}>
            <ItemIcon item={item}/>
            <span><strong>{items[item].name} × {count}</strong>
              <small>{best ? merchants[best.stall].name + " pays " + best.price + (best.short ? " · short of it" : "") : "No open stall buys this"}
                {sourceFor(item) ? "" : " · crafted"}</small></span>
            {best && <button className="primary" disabled={busy || !marketOpen || snapshot.spectator}
              onClick={() => void submit({ type: "sell", stall_id: best.stall, item_id: item, quantity: String(quantity) })}>
              Sell {quantity}<Coins size={13}/></button>}
          </div>;
        })}
      </div>

      <div className="dock-card dock-merchants" aria-label="Merchants">
        <span className="eyebrow"><Store size={13}/> THE ROW'S MERCHANTS</span>
        {Object.entries(snapshot.merchants).map(([stall, market]) => {
          const wants = Object.entries(market.prices).filter(([item]) => Number(market.stock[item]) < Number(market.prices[item]!.target) / 2)
            .map(([item]) => items[item as ItemId].name.toLowerCase());
          return <button className={"dock-merchant band-" + market.band} key={stall} onClick={() => openStall(stall as StallId)}>
            <span><strong>{merchants[stall as StallId].name}</strong><small>{merchants[stall as StallId].keeper} · {market.coins} coins</small></span>
            <span className="dock-band">{bandLabel[market.band]}</span>
            <small className="dock-wants">{wants.length ? "Short of " + wants.join(", ") : "Well stocked"}</small>
          </button>;
        })}
      </div>
    </div>

    <details className="dock-card dock-more">
      <summary>Barge, upriver prices, wrecks and orders</summary>
      <Landing snapshot={snapshot} busy={busy} submit={submit} castOff={castOff} inDock/>
    </details>
  </section>;
}

/** What the last run made: coins on the river (purchases, bounties, jobs), coins since at the Dock, and the net. */
function LastRun({ voyage, coins, hold, snapshot }: { voyage: Voyage; coins: number; hold: { item: ItemId; count: number }[]; snapshot: Snapshot }) {
  const river = voyage.home! - voyage.start, dock = coins - voyage.home!, net = coins - voyage.start;
  const worth = hold.reduce((sum, { item, count }) => sum + count * Math.max(0, ...Object.values(snapshot.merchants)
    .filter(market => market.band !== "dark" && market.prices[item]).map(market => Number(market.prices[item]!.sell))), 0);
  return <div className="dock-card dock-voyage" aria-label="Last run">
    <span className="eyebrow">LAST RUN</span>
    <div className="dock-voyage-row">
      <span><b>{signed(river)}</b><small>on the river</small></span>
      <span><b>{signed(dock)}</b><small>at the Dock</small></span>
      <span className={net >= 0 ? "gain" : "loss"}><b>{signed(net)}</b><small>net so far</small></span>
    </div>
    <p className="hint">{voyage.units} goods brought home for {voyage.spent} coins upriver.
      {worth > 0 ? " Your hold is worth about " + worth + " more at today's prices." : ""}</p>
  </div>;
}

/** One plain sentence: the most useful thing to do right now. */
function nextStep(snapshot: Snapshot, holding: boolean, hasJob: boolean, canCast: boolean) {
  if (snapshot.objective.complete) return "Tonight's goal is done. Keep trading, or close the night.";
  const sold = snapshot.objective.steps.find(step => step.label.startsWith("Goods sold"));
  const ran = snapshot.objective.steps.find(step => step.label === "River run");
  if (ran && Number(ran.count) === 0 && canCast) return "Cast off: buy cargo upriver where it's cheap, then sell it here.";
  if (holding && snapshot.phase === "open") return "Sell your haul: pick a merchant on the right.";
  const relief = snapshot.river.contracts.find(contract => contract.relief && !contract.taken);
  if (relief && !hasJob) return "Accept the relief job on the Harbor Bell, then cast off.";
  if (hasJob && canCast) return "You have a job. Cast off and buy what it needs upriver.";
  if (canCast) return "Cast off, buy cargo upriver where it's cheap, and bring it home.";
  return "Wait for the next evening, or trade with the merchants.";
}
