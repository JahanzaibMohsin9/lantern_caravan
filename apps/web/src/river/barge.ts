import { bargeCosmetics, bargeTier, defaultBargeLook, trimFor, type BargeLook, type BargeTrimId } from "@lantern/content/river";

type Ink = CanvasRenderingContext2D;
export const cargoColor: Record<string, string> = { paper: "#efe2c4", oil: "#f0a24e", reed: "#9fca86", cord: "#cfa978", dye: "#9a86ec" };
export type BargeAppearance = { upgrades: readonly string[]; look?: BargeLook; trim?: BargeTrimId;
  cargo?: Record<string, number>; turret?: number; time?: number };

export function hull(ctx: Ink, length: number, beam: number, fill: string | CanvasGradient, rim: string) {
  ctx.beginPath(); ctx.moveTo(length * .55, 0);
  ctx.quadraticCurveTo(length * .35, -beam, length * .05, -beam);
  ctx.lineTo(-length * .48, -beam * .82); ctx.quadraticCurveTo(-length * .58, 0, -length * .48, beam * .82);
  ctx.lineTo(length * .05, beam); ctx.quadraticCurveTo(length * .35, beam, length * .55, 0);
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = rim; ctx.lineWidth = 2; ctx.stroke();
}

export const bargeFeatures = (upgrades: readonly string[]) => [
  ["hold", ["Open deck", "Deck crates", "Two cargo rows"]],
  ["hull", ["Timber hull", "Iron bands", "Full plating"]],
  ["cannon", ["Deck cannon", "Heavy mount", "Twin barrels"]],
  ["engine", ["Single stack", "Twin stacks", "Stern paddle wheel"]],
].map(([kind, labels]) => (labels as string[])[bargeTier(upgrades, kind as string)]!).join(" · ");

/** One sprite for the Landing preview and the river, drawn facing right at the origin. */
export function drawBarge(ctx: Ink, model: BargeAppearance) {
  const look = model.look ?? defaultBargeLook;
  const paint = bargeCosmetics[look.paint].color, lamp = bargeCosmetics[look.lantern].color;
  const hold = bargeTier(model.upgrades, "hold"), armor = bargeTier(model.upgrades, "hull");
  const cannon = bargeTier(model.upgrades, "cannon"), engine = bargeTier(model.upgrades, "engine");
  const beam = 20 + hold * 2;
  ctx.save();
  const wood = ctx.createLinearGradient(0, -beam, 0, beam);
  wood.addColorStop(0, paint); wood.addColorStop(.55, paint); wood.addColorStop(1, "#261e22");
  hull(ctx, 78, beam, wood, trimFor(model).color);
  ctx.strokeStyle = "#211b1a80"; ctx.lineWidth = 1;
  for (const y of [-10, 0, 10]) { ctx.beginPath(); ctx.moveTo(-30, y); ctx.lineTo(30, y * .8); ctx.stroke(); }
  if (armor) {
    ctx.strokeStyle = "#a1a9aa"; ctx.lineWidth = armor === 2 ? 4 : 2;
    for (const x of [-22, 0, 22]) {
      ctx.beginPath(); ctx.moveTo(x, -beam + 2); ctx.lineTo(x, beam - 2); ctx.stroke();
    }
    if (armor === 2) for (const side of [-1, 1]) {
      ctx.fillStyle = "#59646b"; ctx.fillRect(-29, side * (beam - 3) - 3, 54, 6);
      ctx.fillStyle = "#d7c795";
      for (const x of [-24, -10, 4, 18]) ctx.fillRect(x, side * (beam - 3) - 1, 2, 2);
    }
  }
  const cargo = Object.entries(model.cargo ?? {}).flatMap(([item, n]) => Array<string>(n).fill(item));
  const crates = Math.max(cargo.length, hold ? hold * 4 : 0);
  for (let i = 0; i < Math.min(12, crates); i++) {
    const x = -16 + i % 4 * 9, y = -14 + Math.floor(i / 4) * 10;
    ctx.fillStyle = cargoColor[cargo[i] ?? ""] ?? "#977450"; ctx.fillRect(x, y, 8, 8);
    ctx.strokeStyle = "#38291e"; ctx.lineWidth = 1; ctx.strokeRect(x, y, 8, 8);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 8, y + 8); ctx.stroke();
  }
  ctx.fillStyle = "#25222c"; ctx.fillRect(-36, -10, 16, 20);
  ctx.fillStyle = trimFor(model).color; ctx.fillRect(-38, -12, 20, 4);
  ctx.fillStyle = lamp; ctx.fillRect(-32, -3, 6, 7);
  for (const y of engine ? [-15, 14] : [-15]) {
    ctx.fillStyle = "#151b22"; ctx.fillRect(-30, y - 3, 8, 7);
    ctx.fillStyle = "#9c896c"; ctx.fillRect(-31, y - 4, 10, 2);
  }
  if (engine === 2) {
    ctx.fillStyle = "#392a22"; ctx.fillRect(-51, -18, 12, 36);
    ctx.strokeStyle = "#bb9263"; ctx.lineWidth = 2;
    ctx.strokeRect(-51, -18, 12, 36);
    for (let i = 0; i < 6; i++) {
      const y = -15 + (i * 6 + (model.time ?? 0) * 15) % 30;
      ctx.beginPath(); ctx.moveTo(-51, y); ctx.lineTo(-39, y); ctx.stroke();
    }
  }
  ctx.save(); ctx.rotate(model.turret ?? 0);
  ctx.fillStyle = "#272833"; ctx.beginPath(); ctx.arc(0, 0, cannon ? 11 : 8, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#b3925e"; ctx.lineWidth = 2; ctx.stroke();
  for (const y of cannon === 2 ? [-6, 6] : [0]) {
    ctx.fillStyle = "#171b22"; ctx.fillRect(3, y - 3, cannon ? 31 : 25, 6);
    ctx.fillStyle = "#c2a16a"; ctx.fillRect(cannon ? 30 : 26, y - 4, 4, 8);
  }
  ctx.restore();
  ctx.fillStyle = "#ebd5a2"; ctx.strokeStyle = "#ebd5a2"; ctx.lineWidth = 2;
  if (look.prow === "heron") {
    ctx.beginPath(); ctx.moveTo(38, 4); ctx.lineTo(45, -1); ctx.quadraticCurveTo(40, -15, 49, -13); ctx.lineTo(57, -10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(40, 1); ctx.lineTo(33, -10); ctx.lineTo(46, -3); ctx.fill();
  } else if (look.prow === "carp") {
    ctx.beginPath(); ctx.ellipse(47, -2, 8, 4, -.25, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(41, -2); ctx.lineTo(35, -8); ctx.lineTo(35, 5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#29212b"; ctx.fillRect(50, -4, 2, 2);
  }
  ctx.fillStyle = "#28212b"; ctx.fillRect(37, -4, 7, 8);
  ctx.fillStyle = lamp; ctx.beginPath(); ctx.arc(41, 0, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
