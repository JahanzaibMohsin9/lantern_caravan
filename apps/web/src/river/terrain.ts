import { reachWidth, reaches } from "@lantern/content/river";

export const bounds = { width: 9800, height: 8600 };

function channels(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  for (const { from, to } of Object.values(reaches)) {
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
  }
}

export function bakeRiver(seed: number) {
  const canvas = document.createElement("canvas");
  const scale = .24;
  canvas.width = bounds.width * scale;
  canvas.height = bounds.height * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#080e14";
  ctx.fillRect(0, 0, bounds.width, bounds.height);
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let i = 0; i < 3300; i++) {
    ctx.fillStyle = rand() > .5 ? "#0b1519" : "#0c1b1e";
    ctx.beginPath();
    ctx.ellipse(rand() * bounds.width, rand() * bounds.height, 20 + rand() * 180, 7 + rand() * 45, rand() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineCap = "round";
  ctx.strokeStyle = "#172723";
  ctx.lineWidth = reachWidth + 65;
  channels(ctx);
  ctx.stroke();
  ctx.strokeStyle = "#0b1c26";
  ctx.lineWidth = reachWidth;
  ctx.stroke();
  ctx.strokeStyle = "#0c202b";
  ctx.lineWidth = reachWidth * .76;
  ctx.stroke();
  for (const { from, to } of Object.values(reaches)) {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    for (let i = 0; i < length / 7; i++) {
      const t = rand(), offset = (rand() - .5) * (reachWidth - 45);
      const x = from.x + (to.x - from.x) * t + offset * (to.y - from.y) / length;
      const y = from.y + (to.y - from.y) * t - offset * (to.x - from.x) / length;
      ctx.fillStyle = rand() > .8 ? "#1c3740" : "#102831";
      ctx.fillRect(x, y, rand() * 34 + 5, 1.5);
    }
  }
  return canvas;
}
