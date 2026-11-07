import { villagePurchaseCost } from "@lantern/game-core/pricing";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Anchor, Bell, Compass, Crosshair, Flame, Fuel, Map as MapIcon, Pause, Play, Shield, Target, Zap } from "lucide-react";
import { items, merchants, type ItemId, type StallId } from "@lantern/content";
import { bargeTier, landing, pirateRoles, reaches, riverStops, runMs, trimFor, villages, type ReachId } from "@lantern/content/river";
import { createRiver, distance, harborRadius, hz, marketQuote, nearStop, nearVillage, nearWreck, objective, stepRiver, targetedPirate,
  type Point, type RiverInput } from "@lantern/river-sim";
import { runReport } from "@lantern/river-sim/report";
import type { RunManifest, RunReport, Snapshot } from "@lantern/protocol";
import { playRiver, riverEngine, unlockSound, type RiverCue } from "../world/sound";
import { absorb, announce, camera, cargoColor, createScene, drawMap, drawRiver } from "./render";
import { createTerrain, riverInfo, warmTerrain } from "./terrain";
import { routeLeads } from "./Landing";
import "./river.css";

type Overlay = "village" | "stop" | "map" | "bell" | "pause";
const clock = (frame: number, limitMs: number) => {
  const seconds = Math.max(0, Math.ceil(limitMs / 1000 - frame / hz));
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
};
const touchDevice = () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

function Meter({ label, icon, value, max, color, text }: { label: string; icon: React.ReactNode; value: number; max: number; color: string; text: string }) {
  const fraction = Math.max(0, Math.min(1, value / max));
  return <div className="barge-meter" aria-label={label + " " + text}>
    <span className="barge-meter-label">{icon}{label}</span>
    <span className="barge-meter-track"><i style={{ width: fraction * 100 + "%", background: color }}/></span>
    <b>{text}</b>
  </div>;
}

export function RiverRun({ manifest, snapshot, finish, busy, reduced, live = false, low = false, volume = .8, aim: dockAim }: { manifest: RunManifest;
  snapshot: Snapshot; finish: (report: RunReport) => void; busy: boolean; reduced: boolean; live?: boolean; low?: boolean; volume?: number;
  /** The village the Dock recommended; the HUD points there first. */ aim?: string }) {
  const [river] = useState(() => Object.assign(createRiver(manifest), { aim: dockAim }));
  const [scene] = useState(() => {
    const terrain = createTerrain();
    warmTerrain(terrain, landing, 1);
    const fresh = createScene(terrain);
    const target = objective(river);
    announce(fresh, "Cast off", "Bound for " + target.name.replace(" via the fork", ""), "info");
    return fresh;
  });
  const limitMs = manifest.limitMs ?? runMs;
  const canvas = useRef<HTMLCanvasElement>(null);
  const mini = useRef<HTMLCanvasElement>(null);
  const keys = useRef(new Set<string>());
  const pointer = useRef<{ at: Point; fire: boolean } | undefined>(undefined);
  const stick = useRef<{ id: number; origin: Point; vector: Point } | undefined>(undefined);
  const held = useRef({ fire: false, boost: false });
  const queued = useRef<RiverInput>({});
  const overlayRef = useRef<Overlay | undefined>(undefined);
  const villagesRef = useRef(snapshot.villages);
  villagesRef.current = snapshot.villages;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const [overlay, setOverlay] = useState<Overlay>();
  const [batch, setBatch] = useState(5);
  const [touch] = useState(touchDevice);
  const [, redraw] = useState(0);
  const finishRef = useRef(finish);
  finishRef.current = finish;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  function show(next?: Overlay) {
    if (next === "pause" && live) return;
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
    else if (nearWreck(river)) queued.current.salvage = nearWreck(river)!.id;
    else if (nearStop(river)) show(overlayRef.current === "stop" ? undefined : "stop");
  }

  useEffect(() => {
    unlockSound();
    const field = canvas.current!, map = mini.current!;
    const ink = field.getContext("2d")!, mapInk = map.getContext("2d")!;
    let last = performance.now(), accumulator = 0, frame = 0, nextHud = 0, submitted = false;
    const cue = (sound: RiverCue, near: boolean) => { if (near) playRiver(sound, volumeRef.current); };
    function render(now: number) {
      const width = field.clientWidth, height = field.clientHeight;
      const resolution = Math.min(low ? 1 : 2, window.devicePixelRatio || 1);
      const w = Math.round(width * resolution), h = Math.round(height * resolution);
      if (field.width !== w || field.height !== h) { field.width = w; field.height = h; }
      const active = overlayRef.current;
      const elapsed = Math.min(.2, (now - last) / 1000);
      const running = !river.outcome && active !== "pause" && (live || !document.hidden);
      if (running) {
        accumulator += elapsed;
        while (accumulator >= 1 / hz && !river.outcome) {
          const pressed = keys.current, aim = pointer.current;
          const view = camera(width, height, river.player);
          const input: RiverInput = { ...queued.current };
          if (!active || live) {
            const pad = stick.current?.vector;
            input.x = pad ? pad.x : Number(pressed.has("d") || pressed.has("arrowright")) - Number(pressed.has("a") || pressed.has("arrowleft"));
            input.y = pad ? pad.y : Number(pressed.has("s") || pressed.has("arrowdown")) - Number(pressed.has("w") || pressed.has("arrowup"));
            input.boost = pressed.has("shift") || held.current.boost;
            input.fire = pressed.has(" ") || !!aim?.fire || held.current.fire;
            if (aim?.fire) input.aim = { x: view.x + aim.at.x / view.scale, y: view.y + aim.at.y / view.scale };
            if (active) { input.x = 0; input.y = 0; input.fire = false; input.boost = false; }
          }
          queued.current = {};
          stepRiver(river, input);
          accumulator -= 1 / hz;
        }
        if (river.floodtide && (active === "village" || active === "stop")) show();
        if ((active === "village" && !nearVillage(river)) || (active === "stop" && !nearStop(river))) show();
      }
      last = now;
      absorb(scene, river, cue);
      const speed = Math.hypot(river.player.vx, river.player.vy);
      riverEngine(running ? speed : -1, keys.current.has("shift") || held.current.boost, volumeRef.current);
      ink.setTransform(resolution, 0, 0, resolution, 0, 0);
      drawRiver(ink, scene, river, villagesRef.current, width, height, { reduced, low, dt: running ? elapsed : 0 });
      drawMap(mapInk, river, villagesRef.current, map.width, map.height, false);
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
      unlockSound();
      const panel = overlayRef.current;
      if (!event.repeat) {
        if (key === "escape") { show(panel ? undefined : live ? undefined : "pause"); return; }
        if (key === "m" && panel !== "pause") { show(panel === "map" ? undefined : "map"); return; }
        if (key === "j" && panel !== "pause") { show(panel === "bell" ? undefined : "bell"); return; }
        if (key === "e" && (!panel || panel === "village" || panel === "stop")) { interact(); return; }
        if (key === "q" && !panel) queued.current.flare = true;
      }
      if (!panel) keys.current.add(key);
    }
    const up = (event: KeyboardEvent) => { keys.current.delete(event.key.toLowerCase()); };
    const blur = () => { keys.current.clear(); held.current = { fire: false, boost: false }; if (pointer.current) pointer.current.fire = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    field.focus();
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      riverEngine(-1, false, 0);
      window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur);
    };
  }, [manifest, reduced, river, scene, live, low]);

  function aim(event: ReactPointerEvent<HTMLCanvasElement>, fire?: boolean) {
    if (touch) return;
    const rect = event.currentTarget.getBoundingClientRect();
    pointer.current = { at: { x: event.clientX - rect.left, y: event.clientY - rect.top }, fire: fire ?? pointer.current?.fire ?? false };
  }
  function steer(event: ReactPointerEvent<HTMLDivElement>, phase: "down" | "move" | "up") {
    if (phase === "down") {
      event.currentTarget.setPointerCapture(event.pointerId);
      stick.current = { id: event.pointerId, origin: { x: event.clientX, y: event.clientY }, vector: { x: 0, y: 0 } };
      unlockSound();
    } else if (phase === "move" && stick.current?.id === event.pointerId) {
      const dx = event.clientX - stick.current.origin.x, dy = event.clientY - stick.current.origin.y, m = Math.max(1, Math.hypot(dx, dy));
      const reach = Math.min(1, m / 56);
      stick.current.vector = { x: dx / m * reach, y: dy / m * reach };
    } else if (phase === "up") stick.current = undefined;
    redraw(n => n + 1);
  }

  const port = nearVillage(river), dock = distance(river.player, landing) < harborRadius;
  const wreck = !port && !dock ? nearWreck(river) : undefined, stop = !port && !dock && !wreck ? nearStop(river) : undefined;
  const salvagedUnits = Object.values(river.salvaged).reduce((sum, cargo) => sum + Object.values(cargo).reduce((a, b) => a + b, 0), 0);
  const p = river.player, cargo = Object.values(p.cargo).reduce((a, b) => a + b, 0);
  const target = objective(river);
  const lots = manifest.items.filter(lot => lot.village === port);
  const contract = manifest.contract;
  const here = riverInfo(p.x, p.y).id as ReachId;
  const reach = manifest.reaches.find(entry => entry.id === here);
  const danger = reach && !river.broken.includes(here) ? reach.danger : 0;
  const oil = p.cargo.oil ?? 0;
  const flareReady = river.flareCooldown <= 0 && oil > 0;
  const clockLimit = river.floodtide ? Math.min(limitMs, river.floodtide.deadline * 1000 / hz) : limitMs;
  const secondsLeft = Math.max(0, clockLimit / 1000 - river.frame / hz);
  const banner = scene.announce;
  const contractLine = contract && (contract.kind === "escort" ? "Escort · " + river.escort
    : (contract.relief ? "Relief · " : "") + contract.quantity + " " + items[contract.item as ItemId].name + " · " + contract.payout + " coins");
  const vector = stick.current?.vector;
  return <section className={"river-scene" + (touch ? " touch" : "")} aria-label="River Run">
    <canvas className="river-water" ref={canvas} aria-label="River channels and barge" tabIndex={-1}
      onPointerMove={event => aim(event)} onPointerDown={event => { event.currentTarget.focus(); if (!touch) event.currentTarget.setPointerCapture(event.pointerId); aim(event, true); unlockSound(); }}
      onPointerUp={event => aim(event, false)} onLostPointerCapture={() => { if (pointer.current) pointer.current.fire = false; }}/>
    <div className="river-card river-objective">
      <span className="eyebrow">{reaches[here].name.toUpperCase()} · {danger ? "DANGER " + danger : "SAFE WATER"}</span>
      <strong><Compass size={16}/> {target.name}</strong>
      {contractLine && <small className={contract?.relief ? "relief" : undefined}>{contractLine}</small>}
      {river.floodtide && <small aria-label="Floodtide locks">Floodtide locks: {river.floodtide.next} / 2</small>}
      {!!manifest.floodPremium && <small>Floodtide bonus: {manifest.floodPremium} coins on delivery</small>}
      <small>{Math.ceil(distance(p, target) / ((235 + bargeTier(manifest.upgrades, "engine") * 35) * trimFor(manifest).speed))} s at cruising speed</small>
    </div>
    <div className={"river-card river-clock" + (secondsLeft < 30 ? " urgent" : "")}>
      <svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="19"/><circle cx="22" cy="22" r="19" className="progress"
        style={{ strokeDashoffset: 119.4 * (1 - secondsLeft / (limitMs / 1000)) }}/></svg>
      <div><small>{river.floodtide ? "FLOODTIDE" : "TIME LEFT"}</small><strong>{clock(river.frame, clockLimit)}</strong></div>
    </div>
    <div className="river-card river-wallet"><strong><span className="coin" aria-hidden="true"/> {p.wallet} coins</strong><small>{river.bounty} bounty fund</small></div>
    {banner && <div className={"river-banner " + banner.tone} role="status" style={{ opacity: Math.min(1, banner.life * 1.6) }}>
      <strong>{banner.title}</strong><span>{banner.sub}</span></div>}
    <div className="river-card river-status">
      <span className="eyebrow" style={{ color: trimFor(manifest).color }}>BARGE / {trimFor(manifest).name.toUpperCase()}</span>
      {targetedPirate(river) && <small>Target: {pirateRoles[targetedPirate(river)!.role].name}</small>}
      <small aria-label="Skiffs sunk">Skiffs sunk: {Object.values(river.roleKills).reduce((sum, roles) => sum + (roles?.skiff ?? 0), 0)}</small>
      <Meter label="Hull" icon={<Shield size={13}/>} value={p.hp} max={p.maxHp} color={p.hp < p.maxHp * .35 ? "#ff7a63" : "#8fe3a8"} text={Math.max(0, Math.ceil(p.hp)) + " / " + p.maxHp}/>
      <Meter label="Fuel" icon={<Fuel size={13}/>} value={p.fuel} max={100} color="#ffb35c" text={Math.ceil(p.fuel) + "%"}/>
      <Meter label="Ammo" icon={<Target size={13}/>} value={p.ammo} max={200} color="#ffe1a6" text={String(p.ammo)}/>
      <div className="river-hold"><span>Hold <b>{cargo} / {manifest.hold}</b></span>
        <span className={"river-flare" + (flareReady ? " ready" : "")} title="Q · spend one lamp oil to stun pirates nearby">
          <Zap size={13}/> Flare {oil ? flareReady ? "ready" : Math.ceil(river.flareCooldown) + "s" : "needs oil"}</span></div>
      <div className="river-cargo">{Object.entries(p.cargo).filter(([, amount]) => amount > 0).map(([item, amount]) =>
        <small key={item}><i style={{ background: cargoColor[item] }}/>{items[item as ItemId].name} × {amount}</small>)}</div>
    </div>
    <div className="river-card river-minimap">
      <canvas width={168} height={148} ref={mini} aria-label="River minimap"/>
      <div className="river-buttons">
        <button title="Map (M)" aria-label="River map" onClick={() => show(overlay === "map" ? undefined : "map")}><MapIcon size={16}/></button>
        <button title="Harbor Bell (J)" aria-label="Harbor Bell" onClick={() => show(overlay === "bell" ? undefined : "bell")}><Bell size={16}/></button>
        {!live && <button title="Pause (Esc)" aria-label="Pause River Run" onClick={() => show(overlay === "pause" ? undefined : "pause")}><Pause size={16}/></button>}
      </div>
    </div>
    {!overlay && !river.outcome && <div className="river-controls">
      {(port || dock || wreck || stop || river.rescueAt !== undefined) && <button className="primary river-action" onClick={interact}><Anchor size={16}/>
        {river.rescueAt !== undefined ? "Call the tow" : dock ? "Moor at The Landing" : port ? "Trade at " + villages[port].name
          : wreck ? "Salvage the wreck" : "Visit the " + riverStops[stop!.kind].name.toLowerCase()} <kbd>E</kbd></button>}
      {!touch && river.frame < 25 * hz && <div className="river-card river-hint"><small>WASD / arrows steer · Shift boost · Space auto-aim · Mouse fire · Q flare · M map</small></div>}
    </div>}
    {touch && !overlay && !river.outcome && <>
      <div className="river-stick" onPointerDown={event => steer(event, "down")} onPointerMove={event => steer(event, "move")}
        onPointerUp={event => steer(event, "up")} onPointerCancel={event => steer(event, "up")} aria-label="Steer the barge">
        <i style={{ transform: `translate(${(vector?.x ?? 0) * 40}px, ${(vector?.y ?? 0) * 40}px)` }}/></div>
      <div className="river-touch-buttons">
        <button className="fire" onPointerDown={() => { held.current.fire = true; }} onPointerUp={() => { held.current.fire = false; }}
          onPointerLeave={() => { held.current.fire = false; }}><Crosshair size={20}/>FIRE</button>
        <button onPointerDown={() => { held.current.boost = true; }} onPointerUp={() => { held.current.boost = false; }}
          onPointerLeave={() => { held.current.boost = false; }}><Flame size={18}/>BOOST</button>
        <button disabled={!flareReady} onClick={() => { queued.current.flare = true; }}><Zap size={18}/>FLARE</button>
      </div>
    </>}
    {river.notice && <div className="river-notice" role="status">{river.notice}</div>}
    {overlay && !river.outcome && <div className="river-overlay">
      <div className="river-dialog" role="dialog" aria-modal="true" aria-label={overlay === "village" ? "Village market" : overlay === "stop" ? "Riverside stop"
        : overlay === "map" ? "River map" : overlay === "bell" ? "Harbor Bell" : "River Run paused"}>
        <div className="eyebrow">RIVER RUN{live ? " · THE ROW KEEPS TRADING" : ""}</div>
        {overlay === "village" && port && <>
          <div className="village-head" style={{ ["--village" as string]: villages[port].color }}>
            <h2>{villages[port].name}</h2>
            <span className={"band " + (snapshot.villages[port]?.band ?? "healthy")}>{snapshot.villages[port]?.band ?? "healthy"}</span>
          </div>
          {snapshot.villages[port]?.trusted && <p className="trust-stamp">Trusted hauler · 10% off village purchases</p>}
          <p>{villages[port].keeper} trades at source prices. Prices rise as you buy. You have <b>{p.wallet} coins</b> and <b>{manifest.hold - cargo}</b> free hold.</p>
          {contract?.kind === "supply" && contract.village === port && <p className="contract-note">Your contract needs {contract.quantity} {items[contract.item as ItemId].name.toLowerCase()}. You carry {p.cargo[contract.item] ?? 0}.</p>}
          <div className="river-buttons" aria-label="Order size">
            {[1, 5, 10, manifest.hold].map((size, i) => <button key={i} aria-pressed={batch === size}
              onClick={() => setBatch(size)}>{i === 3 ? "MAX" : size}</button>)}
          </div>
          {lots.map(lot => {
            const buy = marketQuote(river, port, lot.item, "buy", batch);
            const sell = marketQuote(river, port, lot.item, "sell", batch);
            const bought = river.bought[lot.item]?.quantity ?? 0;
            const available = lot.prices.length - bought;
            const nextPrice = villagePurchaseCost(lot, bought + 1) - villagePurchaseCost(lot, bought);
            return <div className="river-trade" key={lot.item}>
              <span className="trade-item"><i style={{ background: cargoColor[lot.item] }}/><span>
                <strong>{items[lot.item as ItemId].name}</strong>
                <small>{available ? available + " for your barge · " + nextPrice + " coins next unit" : "Sold out"}</small>
                <span className="stock-bar"><b style={{ width: Math.min(100, lot.stock / lot.target * 100) + "%" }}/></span>
              </span></span>
              <button className="primary" disabled={!buy.quantity} onClick={() => {
                queued.current.trade = { village: port, item: lot.item, side: "buy", quantity: batch };
              }}>Buy {buy.quantity || ""} · {buy.amount}</button>
              <button className="subtle" disabled={!sell.quantity} onClick={() => {
                queued.current.trade = { village: port, item: lot.item, side: "sell", quantity: batch };
              }}>Sell {sell.quantity || ""} · {sell.amount}</button>
            </div>;
          })}
          {!lots.length && <p>This village has nothing left to sell tonight.</p>}
        </>}
        {overlay === "stop" && stop && <>
          <h2>{riverStops[stop.kind].name}</h2>
          <p>{riverStops[stop.kind].description}</p>
          <p className="hint">Choose one. Hull {Math.ceil(p.hp)} / {p.maxHp} · Fuel {Math.ceil(p.fuel)}% · Ammo {p.ammo} · {river.bounty} coins left in the bounty fund</p>
          <div className="stop-choices">
            {riverStops[stop.kind].choices.map(choice => {
              const short = Object.entries(choice.cost ?? {}).find(([item, qty]) => (p.cargo[item] ?? 0) < qty!);
              const gains = [choice.hull && Math.min(choice.hull, p.maxHp - Math.ceil(p.hp)) + " hull",
                choice.fuel && Math.min(choice.fuel, 100 - Math.ceil(p.fuel)) + " fuel", choice.ammo && Math.min(choice.ammo, 200 - p.ammo) + " ammo",
                choice.coins && Math.min(choice.coins, river.bounty) + " coins"].filter(Boolean).join(", ");
              return <button key={choice.id} className="subtle stop-choice" disabled={!!short}
                onClick={() => { queued.current.stop = { id: stop.id, choice: choice.id }; show(); }}>
                <strong>{choice.label}</strong>
                <small>{short ? "Needs " + short[1] + " " + items[short[0] as ItemId].name.toLowerCase() + " aboard" : "You gain " + (gains || "nothing more right now")}</small>
              </button>;
            })}
          </div>
        </>}
        {overlay === "map" && <><h2>River map</h2>
          <canvas className="river-full-map" width={600} height={520} ref={el => { if (el) drawMap(el.getContext("2d")!, river, snapshot.villages, el.width, el.height, true); }}/>
          <small>Red reaches have pirates. Crosses mark toll booms. Green dots are floating supplies, teal diamonds are wrecks you can salvage, and squares are riverside stops.</small></>}
        {overlay === "bell" && <><h2>Harbor Bell</h2>
          <p>{contract ? contract.kind === "escort" ? "Stay near the marked boat until it arrives." :
            (contract.relief ? "Relief haul: " : "") + "Deliver " + contract.quantity + " " + items[contract.item as ItemId].name + " at The Landing." : "Spot haul. Sell what you bring at any stall on the Row."}</p>
          <h3>Route leads</h3>
          {routeLeads(snapshot).map(lead => <p key={lead.item + lead.stall}>{lead.port} → {merchants[lead.stall as StallId].name} · {items[lead.item as ItemId].name} · {lead.buy} → {lead.sell} coins</p>)}</>}
        {overlay === "pause" && <h2>Run paused</h2>}
        <button className="subtle" onClick={() => show()}>
          {overlay === "pause" ? <Play size={15}/> : <Crosshair size={15}/>} {overlay === "pause" ? "Resume" : "Back to the barge"}
        </button>
      </div>
    </div>}
    {river.outcome && <div className="river-overlay"><div className="river-dialog river-summary" role="status">
      <div className="eyebrow">{river.outcome === "moored" ? "SAFE HARBOR" : river.outcome === "towed" ? "OUT OF TIME" : "RESCUED"}</div>
      <h2>{river.outcome === "moored" ? "Back at The Landing" : "Towed to The Landing"}</h2>
      <div className="summary-grid">
        <span><b>{cargo}</b>cargo aboard</span>
        <span><b>{Object.values(river.kills).reduce((a, b) => a + (b ?? 0), 0)}</b>pirates sunk</span>
        <span><b>{river.broken.length}</b>booms broken</span>
        <span><b>{manifest.bounty - river.bounty}</b>bounty earned</span>
        {salvagedUnits > 0 && <span><b>{salvagedUnits}</b>salvaged</span>}
        {river.stopsTaken.length > 0 && <span><b>{river.stopsTaken.length}</b>stops visited</span>}
      </div>
      <button className="primary" disabled={busy} onClick={() => finish(runReport(river))}>{busy ? "Settling cargo…" : "Settle cargo"}</button>
    </div></div>}
  </section>;
}
