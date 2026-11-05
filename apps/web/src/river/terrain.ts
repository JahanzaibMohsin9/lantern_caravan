import { landing, reachIds, reaches, reachWidth, villages, type ReachId, type VillageId } from "@lantern/content/river";

/**
 * The river world is baked into tiles on demand. Everything here is deterministic from world
 * position, so tiles can be baked in any order and look identical every run.
 */
export const bounds = { width: 9800, height: 8600 };
export const TILE = 1024;
const BAKE = .58;
const tau = Math.PI * 2;
type Ink = CanvasRenderingContext2D;
type Point = { x: number; y: number };

export function hash(x: number, y: number, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noise1(s: number, seed: number) {
  const i = Math.floor(s), f = s - i, u = f * f * (3 - 2 * f);
  return hash(i, 0, seed) * (1 - u) + hash(i + 1, 0, seed) * u;
}

/** Navigable half-width; the visible water always reaches past it. */
export const channelHalf = reachWidth / 2;
/** Visible distance from the centerline to the bank, varying along each reach and on each side. */
export function bankWidth(id: ReachId, s: number, side: number) {
  const seed = reachIds.indexOf(id) * 13 + (side > 0 ? 5 : 1);
  const broad = noise1(s / 560, seed), fine = noise1(s / 150, seed + 7);
  const cove = Math.max(0, noise1(s / 980, seed + 29) - .58) * 420;
  return channelHalf + 18 + broad * 78 + fine * 24 + cove;
}

const geometry = reachIds.map(id => {
  const { from, to } = reaches[id];
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const dir = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
  return { id, from, to, length, dir, normal: { x: -dir.y, y: dir.x } };
});

/** Distance from the nearest channel centerline, and the bank's distance at that spot. */
export function riverInfo(x: number, y: number) {
  let best = { d: Infinity, w: channelHalf, id: geometry[0]!.id as ReachId, s: 0, side: 1 };
  for (const g of geometry) {
    const along = Math.max(0, Math.min(g.length, (x - g.from.x) * g.dir.x + (y - g.from.y) * g.dir.y));
    const cx = g.from.x + g.dir.x * along, cy = g.from.y + g.dir.y * along;
    const d = Math.hypot(x - cx, y - cy);
    if (d < best.d) {
      const side = (x - cx) * g.normal.x + (y - cy) * g.normal.y >= 0 ? 1 : -1;
      best = { d, w: bankWidth(g.id, along, side), id: g.id, s: along, side };
    }
  }
  return best;
}
export const onWater = (x: number, y: number, margin = 0) => {
  const info = riverInfo(x, y);
  return info.d < info.w - margin;
};

function bankPath(ctx: Ink, grow: number) {
  for (const g of geometry) {
    ctx.beginPath();
    const steps = Math.ceil(g.length / 45);
    for (let i = 0; i <= steps; i++) {
      const s = g.length * i / steps;
      const w = bankWidth(g.id, s, 1) + grow;
      ctx.lineTo(g.from.x + g.dir.x * s + g.normal.x * w, g.from.y + g.dir.y * s + g.normal.y * w);
    }
    for (let i = steps; i >= 0; i--) {
      const s = g.length * i / steps;
      const w = bankWidth(g.id, s, -1) + grow;
      ctx.lineTo(g.from.x + g.dir.x * s - g.normal.x * w, g.from.y + g.dir.y * s - g.normal.y * w);
    }
    ctx.closePath();
    ctx.fill();
    for (const [end, s] of [[g.from, 0], [g.to, g.length]] as const) {
      ctx.beginPath();
      ctx.arc(end.x, end.y, Math.max(bankWidth(g.id, s, 1), bankWidth(g.id, s, -1)) + grow + 12, 0, tau);
      ctx.fill();
    }
  }
}

function centerStroke(ctx: Ink, width: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const g of geometry) { ctx.moveTo(g.from.x, g.from.y); ctx.lineTo(g.to.x, g.to.y); }
  ctx.stroke();
}

function blob(ctx: Ink, x: number, y: number, r: number, color: string, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, tau); ctx.fill();
  ctx.globalAlpha = 1;
}

function tree(ctx: Ink, x: number, y: number, r: number, k: number) {
  blob(ctx, x + r * .32, y + r * .42, r * 1.05, "#05060a", .72);
  const greens = ["#18241f", "#1b2922", "#1d2620", "#16211f"];
  const lumps = 3 + Math.floor(hash(k, 3) * 3);
  for (let i = 0; i < lumps; i++) {
    const a = hash(k, i + 10) * tau, o = r * .45 * hash(k, i + 20);
    blob(ctx, x + Math.cos(a) * o, y + Math.sin(a) * o, r * (.55 + hash(k, i + 30) * .35), greens[(k + i) % greens.length]!);
  }
  blob(ctx, x - r * .28, y - r * .3, r * .5, "#2a3a31", .55);
  blob(ctx, x - r * .38, y - r * .42, r * .2, "#3a4c3c", .45);
}

function reeds(ctx: Ink, x: number, y: number, k: number, scale = 1) {
  const n = 6 + Math.floor(hash(k, 4) * 7);
  ctx.lineCap = "round";
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (hash(k, i) - .5) * 1.8, len = (14 + hash(k, i + 40) * 26) * scale;
    ctx.strokeStyle = i % 3 ? "#3c4a2e" : "#56633a";
    ctx.lineWidth = 2.2 * scale;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * len * .5 + 3, y + Math.sin(a) * len * .5, x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
    if (i % 3 === 0) blob(ctx, x + Math.cos(a) * len, y + Math.sin(a) * len, 2.8 * scale, "#4a3424");
  }
}

function lily(ctx: Ink, x: number, y: number, k: number) {
  const r = 9 + hash(k, 5) * 12, a = hash(k, 6) * tau;
  ctx.fillStyle = hash(k, 7) > .5 ? "#2c4a35" : "#335438";
  ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r, a + .35, a + tau - .1); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "#1f3527"; ctx.lineWidth = 1; ctx.stroke();
  if (hash(k, 8) > .78) { blob(ctx, x + 3, y - 2, 4, "#e9a6bf"); blob(ctx, x + 3, y - 2, 1.6, "#ffe6a0"); }
}

function rock(ctx: Ink, x: number, y: number, r: number, k: number) {
  ctx.fillStyle = "#26272e";
  ctx.beginPath();
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * tau, rr = r * (.7 + hash(k, i + 50) * .45);
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * .8);
  }
  ctx.closePath(); ctx.fill();
  blob(ctx, x - r * .25, y - r * .25, r * .4, "#3a3c44", .7);
}

function field(ctx: Ink, x: number, y: number, w: number, h: number, angle: number, k: number) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  ctx.fillStyle = k % 2 ? "#1d2318" : "#20211a";
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = k % 2 ? "#283020" : "#2c2c20";
  ctx.lineWidth = 7;
  for (let row = -h / 2 + 14; row < h / 2; row += 26) { ctx.beginPath(); ctx.moveTo(-w / 2 + 8, row); ctx.lineTo(w / 2 - 8, row); ctx.stroke(); }
  ctx.strokeStyle = "#141a12"; ctx.lineWidth = 4; ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.restore();
}

function pier(ctx: Ink, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = "#06070a"; ctx.globalAlpha = .55; ctx.fillRect(x + 8, y + 10, w, h); ctx.globalAlpha = 1;
  ctx.fillStyle = "#3a2b25"; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#2a1e1a"; ctx.lineWidth = 2;
  const vertical = h > w;
  for (let i = 12; i < (vertical ? h : w); i += 14) {
    ctx.beginPath();
    if (vertical) { ctx.moveTo(x, y + i); ctx.lineTo(x + w, y + i); } else { ctx.moveTo(x + i, y); ctx.lineTo(x + i, y + h); }
    ctx.stroke();
  }
  ctx.fillStyle = "#1d1513";
  for (let i = 0; i <= (vertical ? h : w); i += 60) {
    const px = vertical ? x - 4 : x + i, py = vertical ? y + i : y - 4;
    ctx.fillRect(px, py, 8, 8);
    ctx.fillRect(vertical ? x + w - 4 : px, vertical ? py : y + h - 4, 8, 8);
  }
}

function crate(ctx: Ink, x: number, y: number, s: number) {
  ctx.fillStyle = "#4a3627"; ctx.fillRect(x - s / 2, y - s / 2, s, s);
  ctx.strokeStyle = "#2d2019"; ctx.lineWidth = 2; ctx.strokeRect(x - s / 2, y - s / 2, s, s);
  ctx.beginPath(); ctx.moveTo(x - s / 2, y - s / 2); ctx.lineTo(x + s / 2, y + s / 2); ctx.stroke();
}

function landmarks(ctx: Ink) {
  // The Landing: long piers, cargo, and the Row's rooftops downstream.
  pier(ctx, landing.x - 180, landing.y + 60, 360, 70);
  pier(ctx, landing.x - 250, landing.y - 40, 70, 170);
  pier(ctx, landing.x + 180, landing.y - 40, 70, 170);
  [[-120, 95], [-90, 95], [100, 92], [130, 100], [-215, 30]].forEach(([dx, dy]) => crate(ctx, landing.x + dx!, landing.y + dy!, 22));
  ctx.fillStyle = "#14111a";
  for (let i = -6; i <= 6; i++) {
    const x = landing.x + i * 210, y = 8380 + (i % 2) * 30;
    ctx.beginPath(); ctx.moveTo(x - 95, y); ctx.lineTo(x - 60, y - 70); ctx.lineTo(x + 60, y - 70); ctx.lineTo(x + 95, y); ctx.closePath(); ctx.fill();
    ctx.fillRect(x - 70, y, 140, 220);
  }
  ctx.beginPath();
  for (let tier = 0; tier < 4; tier++) {
    const w = 170 - tier * 32, y = 8250 - tier * 70;
    ctx.moveTo(landing.x - w, y); ctx.lineTo(landing.x - w * .55, y - 46); ctx.lineTo(landing.x + w * .55, y - 46); ctx.lineTo(landing.x + w, y);
  }
  ctx.fill();
  ctx.fillRect(landing.x - 60, 8250, 120, 350);

  // Ember Falls: a waterfall spilling over dark rock beside the oil press.
  const ember = villages.ember_falls;
  for (let i = 0; i < 14; i++) rock(ctx, ember.x - 260 + i * 40, ember.y - 410 + Math.sin(i) * 30, 46 + hash(i, 90) * 30, 900 + i);
  const fall = ctx.createLinearGradient(0, ember.y - 520, 0, ember.y - 260);
  fall.addColorStop(0, "#9fd6dd"); fall.addColorStop(1, "#1d4652");
  ctx.fillStyle = fall;
  ctx.fillRect(ember.x - 150, ember.y - 520, 300, 260);
  ctx.strokeStyle = "#d8f2f2"; ctx.globalAlpha = .45; ctx.lineWidth = 3;
  for (let i = 0; i < 18; i++) { const x = ember.x - 140 + i * 16; ctx.beginPath(); ctx.moveTo(x, ember.y - 515); ctx.lineTo(x + (i % 3) * 2, ember.y - 265); ctx.stroke(); }
  ctx.globalAlpha = 1;
  pier(ctx, ember.x + 230, ember.y - 60, 180, 60);

  // Millbrook: a waterwheel and drying racks of paper.
  const mill = villages.millbrook;
  ctx.save(); ctx.translate(mill.x + 40, mill.y - 300);
  ctx.strokeStyle = "#3d2c24"; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(0, 0, 70, 0, tau); ctx.stroke();
  for (let i = 0; i < 8; i++) { const a = i * tau / 8; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 70, Math.sin(a) * 70); ctx.stroke(); }
  ctx.restore();
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = "#d6cdb5"; ctx.globalAlpha = .55;
    ctx.fillRect(mill.x - 420 + i * 46, mill.y + 250, 34, 22);
    ctx.globalAlpha = 1;
  }
  pier(ctx, mill.x + 200, mill.y + 120, 160, 56);

  // Reedmarsh: pools and boardwalks through the reeds.
  const reed = villages.reedmarsh;
  for (let i = 0; i < 9; i++) {
    const x = reed.x - 600 + hash(i, 77) * 1200, y = reed.y - 520 + hash(i, 78) * 300;
    ctx.fillStyle = "#0e2630"; ctx.beginPath(); ctx.ellipse(x, y, 70 + hash(i, 79) * 80, 40 + hash(i, 80) * 40, hash(i, 81) * 3, 0, tau); ctx.fill();
  }
  pier(ctx, reed.x - 420, reed.y + 140, 200, 50);
  pier(ctx, reed.x - 260, reed.y + 140, 50, 220);

  // Village grounds and fields.
  (Object.keys(villages) as VillageId[]).forEach((id, v) => {
    const port = villages[id];
    for (let i = 0; i < 4; i++) {
      const a = hash(v, i + 300) * tau;
      const x = port.x + Math.cos(a) * (720 + hash(v, i + 310) * 380), y = port.y + Math.sin(a) * (620 + hash(v, i + 320) * 300);
      if (riverInfo(x, y).d > channelHalf + 380) field(ctx, x, y, 260 + hash(v, i) * 160, 180 + hash(v, i + 1) * 120, hash(v, i + 2) * .8 - .4, i + v);
    }
  });
}

function bakeTile(tx: number, ty: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(TILE * BAKE);
  canvas.height = Math.ceil(TILE * BAKE);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(BAKE, BAKE);
  ctx.translate(-tx * TILE, -ty * TILE);
  const x0 = tx * TILE, y0 = ty * TILE;

  // Land.
  const land = ctx.createLinearGradient(0, y0, 0, y0 + TILE);
  land.addColorStop(0, ty < 4 ? "#131820" : "#15141d");
  land.addColorStop(1, ty < 4 ? "#141a1d" : "#16131c");
  ctx.fillStyle = land;
  ctx.fillRect(x0, y0, TILE, TILE);
  for (let i = 0; i < 70; i++) {
    const x = x0 + hash(tx, ty * 97 + i, 1) * TILE, y = y0 + hash(tx * 31 + i, ty, 2) * TILE;
    ctx.fillStyle = ["#181b21", "#121619", "#1a1d1d", "#17141f"][i % 4]!;
    ctx.globalAlpha = .7;
    ctx.beginPath(); ctx.ellipse(x, y, 40 + hash(i, tx, 3) * 160, 14 + hash(i, ty, 4) * 50, hash(tx, i, 5) * 3, 0, tau); ctx.fill();
  }
  ctx.globalAlpha = 1;
  landmarks(ctx);

  // Banks, then water from the shallows to the deep channel.
  ctx.fillStyle = "#1d1d1c"; bankPath(ctx, 58);
  ctx.fillStyle = "#262620"; bankPath(ctx, 26);
  ctx.fillStyle = "#13313b"; bankPath(ctx, 0);
  ctx.fillStyle = "#103440"; bankPath(ctx, -14);
  centerStroke(ctx, channelHalf * 2 - 10, "#0f2f3b");
  centerStroke(ctx, channelHalf * 1.4, "#0e2b37");
  centerStroke(ctx, channelHalf * .8, "#0c2732");
  for (let i = 0; i < 45; i++) {
    const x = x0 + hash(tx, ty, i + 600) * TILE, y = y0 + hash(ty, tx, i + 700) * TILE;
    const info = riverInfo(x, y);
    if (info.d > info.w - 40) continue;
    const g = geometry.find(entry => entry.id === info.id)!;
    const len = 16 + hash(i, tx + ty, 8) * 34;
    ctx.strokeStyle = hash(i, 3, 9) > .7 ? "#1e4a55" : "#164050";
    ctx.globalAlpha = .3; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + g.dir.x * len, y + g.dir.y * len); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Scatter: shallows plants, bank reeds and rocks, then trees inland. Neighbor tiles contribute
  // their overhanging features too, so nothing is cut at a tile edge.
  for (let ny = ty - 1; ny <= ty + 1; ny++) for (let nx = tx - 1; nx <= tx + 1; nx++) {
    for (let k = 0; k < 150; k++) {
      const key = (nx * 7919 + ny * 104729) * 151 + k;
      const x = (nx + hash(nx, ny, k * 2 + 11)) * TILE, y = (ny + hash(nx, ny, k * 2 + 12)) * TILE;
      if (x < x0 - 200 || x > x0 + TILE + 200 || y < y0 - 200 || y > y0 + TILE + 200) continue;
      const near = Object.values(villages).some(port => Math.hypot(port.x - x, port.y - y) < 520) ||
        Math.hypot(landing.x - x, landing.y - y) < 520 || y > 7950;
      const info = riverInfo(x, y), roll = hash(key, 1, 13);
      if (info.d < channelHalf + 6) continue;
      if (info.d < info.w - 6) {
        if (roll < .5) lily(ctx, x, y, key); else if (roll < .85) reeds(ctx, x, y, key, .9); else rock(ctx, x, y, 12 + roll * 10, key);
      } else if (info.d < info.w + 48) {
        if (roll < .62) reeds(ctx, x, y, key, 1.15); else if (roll < .8) rock(ctx, x, y, 14 + roll * 14, key);
      } else if (!near) {
        if (roll < .55 && info.d > info.w + 110) tree(ctx, x, y, 34 + hash(key, 2, 14) * 46, key);
        else if (roll < .72) blob(ctx, x, y, 12 + roll * 14, "#1b2320");
        else if (roll < .8) rock(ctx, x, y, 10 + roll * 10, key);
      }
    }
  }
  return canvas;
}

export type Terrain = { tiles: Map<string, HTMLCanvasElement>; queue: string[] };
export const createTerrain = (): Terrain => ({ tiles: new Map(), queue: [] });

/** Draws the tiles under the view, baking at most `budget` new tiles this frame. */
export function drawTerrain(ctx: Ink, terrain: Terrain, view: { x: number; y: number; w: number; h: number }, budget = 2) {
  const x0 = Math.max(0, Math.floor(view.x / TILE)), x1 = Math.min(Math.ceil(bounds.width / TILE) - 1, Math.floor((view.x + view.w) / TILE));
  const y0 = Math.max(0, Math.floor(view.y / TILE)), y1 = Math.min(Math.ceil(bounds.height / TILE) - 1, Math.floor((view.y + view.h) / TILE));
  ctx.fillStyle = "#121319";
  ctx.fillRect(view.x, view.y, view.w, view.h);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const key = tx + "," + ty;
    let tile = terrain.tiles.get(key);
    if (!tile && budget > 0) { tile = bakeTile(tx, ty); terrain.tiles.set(key, tile); budget--; }
    if (tile) {
      terrain.tiles.delete(key); terrain.tiles.set(key, tile);
      ctx.drawImage(tile, tx * TILE, ty * TILE, TILE + .5, TILE + .5);
    }
  }
  while (terrain.tiles.size > 30) terrain.tiles.delete(terrain.tiles.keys().next().value!);
}

/** Bakes the tiles around a point ahead of time, for the cast-off view. */
export function warmTerrain(terrain: Terrain, at: Point, radius = 1) {
  const cx = Math.floor(at.x / TILE), cy = Math.floor(at.y / TILE);
  for (let ty = cy - radius; ty <= cy + radius; ty++) for (let tx = cx - radius; tx <= cx + radius; tx++) {
    const key = tx + "," + ty;
    if (tx >= 0 && ty >= 0 && !terrain.tiles.has(key)) terrain.tiles.set(key, bakeTile(tx, ty));
  }
}
