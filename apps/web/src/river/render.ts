import { landing, reaches, villages, type ReachId } from "@lantern/content/river";
import { distance, objective, type Point, type River } from "@lantern/river-sim";
import type { Snapshot } from "@lantern/protocol";
import { bounds } from "./terrain";

type Ink = CanvasRenderingContext2D;
const tau = Math.PI * 2;
const bands = { dark: 0, tight: 2, healthy: 4, thriving: 6 };
function dot(ctx: Ink, x: number, y: number, radius: number, color: string | CanvasGradient) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, radius, 0, tau); ctx.fill();
}
function glow(ctx: Ink, x: number, y: number, radius: number, color: string, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const light = ctx.createRadialGradient(x, y, 1, x, y, radius);
  light.addColorStop(0, color); light.addColorStop(1, "#0000");
  dot(ctx, x, y, radius, light);
  ctx.restore();
}

function drawBarge(ctx: Ink, at: Point, angle: number, kind: "player" | "boat" | "pirate") {
  ctx.save(); ctx.translate(at.x, at.y); ctx.rotate(angle);
  const color = kind === "pirate" ? "#fb7e65" : kind === "player" ? "#ffd28d" : "#a4debf";
  const breadth = kind === "pirate" ? 11 : 16;
  ctx.strokeStyle = kind === "pirate" ? "#ac574c" : "#665952";
  ctx.lineWidth = 2;
  ctx.fillStyle = "#080f16";
  ctx.beginPath(); ctx.moveTo(33, 0); ctx.lineTo(14, -breadth); ctx.lineTo(-25, -breadth);
  ctx.lineTo(-31, 0); ctx.lineTo(-25, breadth); ctx.lineTo(14, breadth); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#253234"; ctx.fillRect(-15, -breadth / 2, 21, breadth);
  glow(ctx, 23, 0, 54, color, .37);
  dot(ctx, 23, 0, kind === "pirate" ? 3 : 5, color);
  if (kind === "pirate") {
    ctx.strokeStyle = color;
    ctx.beginPath(); ctx.moveTo(-10, -7); ctx.lineTo(3, 7); ctx.moveTo(3, -7); ctx.lineTo(-10, 7); ctx.stroke();
  }
  ctx.restore();
}

export function camera(width: number, height: number, player: Point) {
  const scale = Math.min(1, Math.max(.5, width / 1450));
  return { scale, x: player.x - width / scale / 2, y: player.y - height / scale / 2 };
}

export function drawRiver(ctx: Ink, terrain: HTMLCanvasElement, state: River, villageState: Snapshot["villages"],
  width: number, height: number, reduced: boolean) {
  const p = state.player, view = camera(width, height, p);
  const hit = reduced ? undefined : [...state.effects].reverse().find(effect => effect.kind === "hit" && distance(effect, p) < 50);
  if (hit) {
    const age = state.frame - hit.frame;
    view.x += Math.sin(age * 1.9) * (1 - age / 32) * 11;
    view.y += Math.cos(age * 1.6) * (1 - age / 32) * 8;
  }
  ctx.fillStyle = "#080e14"; ctx.fillRect(0, 0, width, height);
  ctx.save(); ctx.scale(view.scale, view.scale); ctx.translate(-view.x, -view.y);
  ctx.drawImage(terrain, 0, 0, bounds.width, bounds.height);
  glow(ctx, landing.x, landing.y + 45, 530, "#ffb46e", .23 * state.manifest.glow);
  ctx.fillStyle = "#101319"; ctx.fillRect(landing.x - 110, landing.y + 55, 220, 24);
  ctx.font = "600 22px Manrope, sans-serif"; ctx.textAlign = "center";
  ctx.fillStyle = "#ffce8b"; ctx.fillText("THE LANDING", landing.x, landing.y + 110);
  for (const [id, port] of Object.entries(villages)) {
    if (distance(port, p) > 1400) continue;
    const band = villageState[id]?.band ?? "tight", windows = bands[band];
    glow(ctx, port.x, port.y, 300, port.color, windows * .065);
    for (let i = 0; i < 6; i++) {
      const x = port.x - 116 + i * 45, y = port.y - 92 + (i % 2) * 23;
      ctx.fillStyle = "#091218";
      ctx.beginPath(); ctx.moveTo(x - 21, y); ctx.lineTo(x, y - 19); ctx.lineTo(x + 21, y); ctx.fill();
      ctx.fillRect(x - 15, y, 30, 28); ctx.fillRect(x - 11, y + 27, 4, 13); ctx.fillRect(x + 7, y + 27, 4, 13);
      if (i < windows) {
        glow(ctx, x, y + 10, 28, port.color, .3);
        ctx.fillStyle = port.color; ctx.fillRect(x - 3, y + 6, 7, 10);
        ctx.globalAlpha = .15; ctx.fillRect(x - 2, y + 45, 5, 20); ctx.globalAlpha = 1;
      }
    }
    ctx.fillStyle = "#eaded0"; ctx.fillText(port.name + " · " + band, port.x, port.y - 123);
  }
  for (const reach of state.manifest.reaches) {
    const { from, to } = reaches[reach.id as ReachId];
    const angle = Math.atan2(to.y - from.y, to.x - from.x) + Math.PI / 2;
    for (let t = .13; t <= .9; t += .15) {
      const x = from.x + (to.x - from.x) * t + Math.cos(angle) * 315;
      const y = from.y + (to.y - from.y) * t + Math.sin(angle) * 315;
      if (distance({ x, y }, p) > 1100) continue;
      const lit = reach.danger === 0 || state.broken.includes(reach.id as ReachId);
      dot(ctx, x, y, 7, "#292e2d");
      if (lit) { glow(ctx, x, y, 68, "#eebf82", .35); dot(ctx, x, y, 3, "#ffd28d"); }
    }
  }
  for (const boom of state.booms.filter(boom => boom.hp > 0)) {
    const { from, to } = reaches[boom.id];
    const angle = Math.atan2(to.y - from.y, to.x - from.x) + Math.PI / 2;
    ctx.save(); ctx.translate(boom.x, boom.y); ctx.rotate(angle);
    ctx.strokeStyle = "#d58168"; ctx.lineWidth = 5; ctx.setLineDash([10, 6]);
    ctx.beginPath(); ctx.moveTo(-175, 0); ctx.lineTo(175, 0); ctx.stroke();
    ctx.setLineDash([]); dot(ctx, -175, 0, 11, "#a35448"); dot(ctx, 175, 0, 11, "#a35448");
    ctx.restore();
  }
  for (const boat of state.boats.filter(boat => boat.active)) drawBarge(ctx, boat, boat.angle, "boat");
  for (const pirate of state.pirates) drawBarge(ctx, pirate, pirate.angle, "pirate");
  for (const bullet of state.bullets) dot(ctx, bullet.x, bullet.y, 3, bullet.friendly ? "#ffd691" : "#fc846b");
  for (const drop of state.drops) {
    glow(ctx, drop.x, drop.y, 46, "#85ddcc", .35);
    ctx.fillStyle = "#85ddcc"; ctx.fillRect(drop.x - 5, drop.y - 5, 10, 10);
  }
  for (const effect of state.effects) {
    const age = state.frame - effect.frame;
    const color = effect.kind === "flare" ? "#8deddf" : effect.kind === "hit" ? "#ee7967" : "#ffc774";
    glow(ctx, effect.x, effect.y, effect.kind === "flare" ? 100 : 50, color, (1 - age / 32) * .5);
    if (!reduced) for (let n = 0; n < 6; n++) {
      const angle = n * tau / 6 + effect.frame;
      dot(ctx, effect.x + Math.cos(angle) * age * 1.5, effect.y + Math.sin(angle) * age * 1.5, 2, color);
    }
  }
  drawBarge(ctx, p, p.angle, "player");
  ctx.strokeStyle = "#edbc83"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(p.turret) * 21, p.y + Math.sin(p.turret) * 21); ctx.stroke();
  const target = objective(state);
  if (distance(p, target) > 120) {
    const heading = Math.atan2(target.y - p.y, target.x - p.x);
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(heading);
    ctx.fillStyle = "#ffce8b"; ctx.beginPath(); ctx.moveTo(97, 0); ctx.lineTo(79, -8); ctx.lineTo(79, 8); ctx.fill(); ctx.restore();
  }
  ctx.restore();
}

export function drawMap(ctx: Ink, state: River, width: number, height: number, labels: boolean) {
  ctx.fillStyle = "#0b1520"; ctx.fillRect(0, 0, width, height);
  const scale = Math.min(width / bounds.width, height / bounds.height);
  const x = (value: number) => (width - bounds.width * scale) / 2 + value * scale;
  const y = (value: number) => value * scale;
  for (const reach of state.manifest.reaches) {
    const path = reaches[reach.id as ReachId];
    ctx.strokeStyle = reach.danger && !state.broken.includes(reach.id as ReachId) ? "#a26762" : "#49757d";
    ctx.lineWidth = labels ? 6 : 3; ctx.beginPath();
    ctx.moveTo(x(path.from.x), y(path.from.y)); ctx.lineTo(x(path.to.x), y(path.to.y)); ctx.stroke();
    if (labels) {
      ctx.textAlign = "center"; ctx.font = "12px Manrope, sans-serif"; ctx.fillStyle = "#d6beb5";
      ctx.fillText(path.name + " · " + reach.danger, x((path.from.x + path.to.x) / 2), y((path.from.y + path.to.y) / 2) - 9);
    }
  }
  for (const port of [...Object.values(villages), { ...landing, name: "The Landing" }]) {
    dot(ctx, x(port.x), y(port.y), labels ? 5 : 2.5, "#e6b87f");
    if (labels) {
      ctx.fillStyle = "#ffe1b3"; ctx.textAlign = "center"; ctx.font = "600 13px Manrope, sans-serif";
      ctx.fillText(port.name, x(port.x), y(port.y) - 11);
    }
  }
  dot(ctx, x(state.player.x), y(state.player.y), labels ? 5 : 3, "#fff6d0");
}
