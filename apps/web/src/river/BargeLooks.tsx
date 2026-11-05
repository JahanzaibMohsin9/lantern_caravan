import { useEffect, useRef, useState } from "react";
import { bargeCosmetics, fitBargeLook, type BargeCosmeticId, type BargeLook } from "@lantern/content/river";
import type { Intent, Snapshot } from "@lantern/protocol";
import { bargeFeatures, drawBarge } from "./barge";

export function BargeLooks({ snapshot, busy, canFit, submit }: { snapshot: Snapshot; busy: boolean; canFit: boolean;
  submit: (intent: Intent) => Promise<void> }) {
  const { barge } = snapshot;
  const [look, setLook] = useState<BargeLook>(barge.look);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, 660, 240);
    const water = ctx.createLinearGradient(0, 0, 0, 240);
    water.addColorStop(0, "#141c29"); water.addColorStop(1, "#22313a");
    ctx.fillStyle = water; ctx.fillRect(0, 0, 660, 240);
    ctx.strokeStyle = "#82b1ad22";
    for (let i = 0; i < 12; i++) { ctx.beginPath(); ctx.moveTo(20 + i % 3 * 15, 30 + i * 17); ctx.lineTo(640, 35 + i * 17); ctx.stroke(); }
    ctx.save(); ctx.translate(330, 124); ctx.scale(4, 4); ctx.rotate(-.12);
    drawBarge(ctx, { upgrades: barge.upgrades, look, trim: barge.trim }); ctx.restore();
  }, [barge.upgrades, barge.trim, look]);
  return <section className="barge-looks" aria-label="Barge looks">
    <canvas width={660} height={240} ref={canvas} role="img" aria-label="Barge preview"/>
    <p className="hint" aria-label="Visible barge upgrades">{bargeFeatures(barge.upgrades)}</p>
    <details><summary>Paint, lantern &amp; prow</summary>
      <p className="hint">Preview a finish below. Purchases fund harbor relief. Owned finishes refit free and change no stats.</p>
      {(["paint", "lantern", "prow"] as const).map(category => {
        const selected = look[category], entry = bargeCosmetics[selected];
        const owned = !entry.price || barge.cosmetics.includes(selected), fitted = barge.look[category] === selected;
        const label = { paint: "Hull paint", lantern: "Bow lantern", prow: "Prow figure" }[category];
        return <div className="look-choice" key={category}>
          <label><span>{label}</span><select aria-label={label} value={selected} disabled={busy || !canFit}
            onChange={event => setLook(fitBargeLook(look, event.target.value as BargeCosmeticId))}>
            {Object.entries(bargeCosmetics).filter(([, value]) => value.category === category).map(([id, value]) =>
              <option key={id} value={id}>{value.name}{!value.price || barge.cosmetics.includes(id) ? " · Owned" : " · " + value.price + " coins"}</option>)}
          </select></label>
          <button className="subtle" disabled={busy || !canFit || fitted || (!owned && Number(snapshot.coins) < entry.price)}
            onClick={() => void submit({ type: owned ? "fit_barge_cosmetic" : "buy_barge_cosmetic", cosmetic_id: selected })}>
            {fitted ? "Fitted " + entry.name : owned ? "Fit " + entry.name : "Buy " + entry.name + " · " + entry.price + " coins"}
          </button>
        </div>;
      })}
    </details>
  </section>;
}
