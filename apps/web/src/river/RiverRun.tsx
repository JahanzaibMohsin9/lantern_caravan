import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Anchor, Bell, Compass, Crosshair, Map, Pause, Play } from "lucide-react";
import { items, merchants, type ItemId, type StallId } from "@lantern/content";
import { landing, runMs, villages } from "@lantern/content/river";
import { createRiver, distance, harborRadius, hz, marketQuote, nearVillage, objective, stepRiver,
  type Point, type RiverInput } from "@lantern/river-sim";
import { runReport } from "@lantern/river-sim/report";
import type { RunManifest, RunReport, Snapshot } from "@lantern/protocol";
import { camera, drawMap, drawRiver } from "./render";
import { bakeRiver } from "./terrain";
import { routeLeads } from "./Landing";
import "./river.css";

type Overlay = "village" | "map" | "bell" | "pause";
const clock = (frame: number) => {
  const seconds = Math.max(0, Math.ceil(runMs / 1000 - frame / hz));
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
};

export function RiverRun({ manifest, snapshot, finish, busy, reduced }: { manifest: RunManifest; snapshot: Snapshot;
  finish: (report: RunReport) => void; busy: boolean; reduced: boolean }) {
  const [river] = useState(() => createRiver(manifest));
  const canvas = useRef<HTMLCanvasElement>(null);
  const mini = useRef<HTMLCanvasElement>(null);
  const keys = useRef(new Set<string>());
  const pointer = useRef<{ at: Point; fire: boolean } | undefined>(undefined);
  const queued = useRef<RiverInput>({});
  const overlayRef = useRef<Overlay | undefined>(undefined);
  const [overlay, setOverlay] = useState<Overlay>();
  const [batch, setBatch] = useState(1);
  const [, redraw] = useState(0);
  const finishRef = useRef(finish);
  finishRef.current = finish;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  function show(next?: Overlay) {
    overlayRef.current = next;
    keys.current.clear();
    if (pointer.current) pointer.current.fire = false;
    setOverlay(next);
    if (!next) canvas.current?.focus();
  }

  function interact() {
    if (river.outcome) return;
    if (river.rescueAt !== undefined || distance(river.player, landing) < harborRadius) queued.current.moor = true;
    else if (nearVillage(river)) show(overlayRef.current === "village" ? undefined : "village");
  }

  useEffect(() => {
    const field = canvas.current!, map = mini.current!;
    const ink = field.getContext("2d")!, mapInk = map.getContext("2d")!;
    const terrain = bakeRiver(manifest.seed);
    let last = performance.now(), accumulator = 0, frame = 0, nextHud = 0, submitted = false;
    function render(now: number) {
      const width = field.clientWidth, height = field.clientHeight;
      const resolution = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(width * resolution), h = Math.round(height * resolution);
      if (field.width !== w || field.height !== h) { field.width = w; field.height = h; }
      const active = overlayRef.current;
      if (!river.outcome && active !== "pause" && !document.hidden) {
        accumulator += Math.min(.2, (now - last) / 1000);
        while (accumulator >= 1 / hz && !river.outcome) {
          const held = keys.current;
          const aim = pointer.current;
          const view = camera(width, height, river.player);
          const input: RiverInput = { ...queued.current };
          if (!active) {
            input.x = Number(held.has("d") || held.has("arrowright")) - Number(held.has("a") || held.has("arrowleft"));
            input.y = Number(held.has("s") || held.has("arrowdown")) - Number(held.has("w") || held.has("arrowup"));
            input.boost = held.has("shift");
            input.fire = held.has(" ") || !!aim?.fire;
            if (aim?.fire) input.aim = { x: view.x + aim.at.x / view.scale, y: view.y + aim.at.y / view.scale };
          }
          queued.current = {};
          stepRiver(river, input);
          accumulator -= 1 / hz;
        }
        if (active === "village" && !nearVillage(river)) show();
      }
      last = now;
      ink.setTransform(resolution, 0, 0, resolution, 0, 0);
      drawRiver(ink, terrain, river, snapshot.villages, width, height, reduced);
      drawMap(mapInk, river, map.width, map.height, false);
      if (now >= nextHud) { nextHud = now + 100; redraw(n => n + 1); }
      if (river.outcome && !submitted && !busyRef.current) {
        submitted = true;
        finishRef.current(runReport(river));
      }
      frame = requestAnimationFrame(render);
    }
    function down(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      if (!["w", "a", "s", "d", "arrowup", "arrowleft", "arrowdown", "arrowright", " ", "shift", "q", "e", "j", "m", "escape"].includes(key)) return;
      if (event.target instanceof HTMLButtonElement && key === " ") return;
      event.preventDefault();
      const panel = overlayRef.current;
      if (!event.repeat) {
        if (key === "escape") { show(panel ? undefined : "pause"); return; }
        if (key === "m" && panel !== "pause") { show(panel === "map" ? undefined : "map"); return; }
        if (key === "j" && panel !== "pause") { show(panel === "bell" ? undefined : "bell"); return; }
        if (key === "e" && (!panel || panel === "village")) { interact(); return; }
        if (key === "q" && !panel) queued.current.flare = true;
      }
      if (!panel) keys.current.add(key);
    }
    const up = (event: KeyboardEvent) => { keys.current.delete(event.key.toLowerCase()); };
    const blur = () => { keys.current.clear(); if (pointer.current) pointer.current.fire = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    field.focus();
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur);
    };
  }, [manifest, reduced, river, snapshot.villages]);

  function aim(event: PointerEvent<HTMLCanvasElement>, fire?: boolean) {
    const rect = event.currentTarget.getBoundingClientRect();
    pointer.current = { at: { x: event.clientX - rect.left, y: event.clientY - rect.top }, fire: fire ?? pointer.current?.fire ?? false };
  }

  const port = nearVillage(river), dock = distance(river.player, landing) < harborRadius;
  const p = river.player, cargo = Object.values(p.cargo).reduce((a, b) => a + b, 0);
  const target = objective(river);
  const lots = manifest.items.filter(lot => lot.village === port);
  const contract = manifest.contract;
  return <section className="river-scene" aria-label="River Run">
    <canvas className="river-water" ref={canvas} aria-label="River channels and barge" tabIndex={-1}
      onPointerMove={event => aim(event)} onPointerDown={event => { event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); aim(event, true); }}
      onPointerUp={event => aim(event, false)} onLostPointerCapture={() => { if (pointer.current) pointer.current.fire = false; }}/>
    <div className="river-card river-objective">
      <span className="eyebrow">RIVER RUN</span><strong><Compass size={16}/> {target.name}</strong>
      {contract && <small>{contract.kind === "escort" ? "Escort · " + river.escort : contract.quantity + " " + items[contract.item as ItemId].name + " · " + contract.payout + " coins"}</small>}
      <small>{Math.ceil(distance(p, target) / 235)} s at cruising speed</small>
    </div>
    <div className="river-card river-clock"><small>TIME LEFT</small><strong>{clock(river.frame)}</strong></div>
    <div className="river-card river-wallet"><strong>{p.wallet} coins</strong><small>{river.bounty} bounty fund</small></div>
    <div className="river-card river-status">
      <span>Hull <b>{Math.max(0, Math.ceil(p.hp))} / {p.maxHp}</b></span>
      <span>Fuel <b>{Math.ceil(p.fuel)}%</b></span><span>Ammo <b>{p.ammo}</b></span>
      <span>Hold <b>{cargo} / {manifest.hold}</b></span>
      {Object.entries(p.cargo).filter(([, amount]) => amount > 0).map(([item, amount]) =>
        <small key={item}>{items[item as ItemId].name} × {amount}</small>)}
    </div>
    <div className="river-card river-minimap">
      <canvas width={156} height={116} ref={mini} aria-label="River minimap"/>
      <div className="river-buttons">
        <button title="Map (M)" aria-label="River map" onClick={() => show(overlay === "map" ? undefined : "map")}><Map size={16}/></button>
        <button title="Harbor Bell (J)" aria-label="Harbor Bell" onClick={() => show(overlay === "bell" ? undefined : "bell")}><Bell size={16}/></button>
        <button title="Pause (Esc)" aria-label="Pause River Run" onClick={() => show(overlay === "pause" ? undefined : "pause")}><Pause size={16}/></button>
      </div>
    </div>
    {!overlay && !river.outcome && <div className="river-controls">
      {(port || dock || river.rescueAt !== undefined) && <button className="primary" onClick={interact}><Anchor size={16}/>
        {river.rescueAt !== undefined ? "Call the tow" : dock ? "Moor at The Landing" : "Trade at " + villages[port!].name} <kbd>E</kbd></button>}
      <div className="river-card"><small>WASD / arrows steer · Shift boost · Space auto-aim · Mouse fire · Q flare</small></div>
    </div>}
    {river.notice && <div className="river-notice" role="status">{river.notice}</div>}
    {overlay && !river.outcome && <div className="river-overlay">
      <div className="river-dialog" role="dialog" aria-modal="true" aria-label={overlay === "village" ? "Village market" : overlay === "map" ? "River map" : overlay === "bell" ? "Harbor Bell" : "River Run paused"}>
        <div className="eyebrow">RIVER RUN</div>
        {overlay === "village" && port && <>
          <h2>{villages[port].name}</h2><p>{villages[port].keeper} · {snapshot.villages[port]?.band} · {p.wallet} coins</p>
          <div className="river-buttons" aria-label="Order size">
            {[1, 5, 10, manifest.hold].map((size, i) => <button key={i} aria-pressed={batch === size}
              onClick={() => setBatch(size)}>{i === 3 ? "MAX" : size}</button>)}
          </div>
          {lots.map(lot => {
            const buy = marketQuote(river, port, lot.item, "buy", batch);
            const sell = marketQuote(river, port, lot.item, "sell", batch);
            const available = lot.prices.length - (river.bought[lot.item]?.quantity ?? 0);
            return <div className="river-trade" key={lot.item}>
              <span><strong>{items[lot.item as ItemId].name}</strong><small>{available ? available + " reserved · " + lot.prices[lot.prices.length - available] + " coins per unit" : "Sold out"}</small></span>
              <button className="primary" disabled={!buy.quantity} onClick={() => {
                queued.current.trade = { village: port, item: lot.item, side: "buy", quantity: batch };
              }}>Buy {buy.quantity || ""} · {buy.amount}</button>
              <button className="subtle" disabled={!sell.quantity} onClick={() => {
                queued.current.trade = { village: port, item: lot.item, side: "sell", quantity: batch };
              }}>Sell {sell.quantity || ""} · {sell.amount}</button>
            </div>;
          })}
          {!lots.length && <p>There are no goods reserved at this village.</p>}
        </>}
        {overlay === "map" && <><h2>River map</h2>
          <canvas className="river-full-map" width={560} height={350} ref={el => { if (el) drawMap(el.getContext("2d")!, river, el.width, el.height, true); }}/>
          <small>Reach labels show danger from 0 to 5. Red reaches have pirates.</small></>}
        {overlay === "bell" && <><h2>Harbor Bell</h2>
          <p>{contract ? contract.kind === "escort" ? "Stay near the marked boat until it arrives." :
            "Deliver " + contract.quantity + " " + items[contract.item as ItemId].name + " at The Landing." : "Spot haul"}</p>
          <h3>Route leads</h3>
          {routeLeads(snapshot).map(lead => <p key={lead.item + lead.stall}>{lead.port} → {merchants[lead.stall as StallId].name} · {items[lead.item as ItemId].name} · {lead.buy} → {lead.sell} coins</p>)}</>}
        {overlay === "pause" && <h2>Run paused</h2>}
        <button className="subtle" onClick={() => show()}>
          {overlay === "pause" ? <Play size={15}/> : <Crosshair size={15}/>} {overlay === "pause" ? "Resume" : "Back to the barge"}
        </button>
      </div>
    </div>}
    {river.outcome && <div className="river-overlay"><div className="river-dialog" role="status">
      <h2>{river.outcome === "moored" ? "Back at The Landing" : "Towed to The Landing"}</h2>
      <button className="primary" disabled={busy} onClick={() => finish(runReport(river))}>{busy ? "Settling cargo…" : "Settle cargo"}</button>
    </div></div>}
  </section>;
}
