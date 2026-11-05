// Original vector scenery. Random detail is seeded so the Row stays recognizable.
export const WIDTH = 2340;
export const HEIGHT = 660;
export const WALK = 466;
export const RIVER = 502;

type Ink = CanvasRenderingContext2D;
type Point = [number, number];
const TWO_PI = Math.PI * 2;

function randomFrom(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function poly(ctx: Ink, fill: string, points: Point[], line?: string) {
  ctx.beginPath();
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (line) { ctx.strokeStyle = line; ctx.stroke(); }
}

function oval(ctx: Ink, color: string, x: number, y: number, rx: number, ry = rx) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TWO_PI);
  ctx.fillStyle = color;
  ctx.fill();
}

function gradient(ctx: Ink, x: number, y: number, radius: number, color: string, squash = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, squash);
  const light = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  light.addColorStop(0, color);
  light.addColorStop(1, color.slice(0, 7) + "00");
  ctx.fillStyle = light;
  ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
  ctx.restore();
}

function roof(ctx: Ink, x: number, y: number, width: number, height: number, fill: string, trim: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(-width / 2 - 12, 1);
  ctx.quadraticCurveTo(-width * .29, -height * .23, -width * .2, -height);
  ctx.quadraticCurveTo(0, -height * .79, width * .2, -height);
  ctx.quadraticCurveTo(width * .31, -height * .20, width / 2 + 12, 1);
  ctx.quadraticCurveTo(0, 18, -width / 2 - 12, 1);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = trim;
  ctx.stroke();
  ctx.restore();
}

function hill(ctx: Ink, base: number, color: string, heights: number[], step: number) {
  ctx.beginPath();
  ctx.moveTo(0, base - heights[0]!);
  for (let i = 1; i < heights.length; i++) {
    ctx.quadraticCurveTo((i - .5) * step, base - heights[i - 1]!, i * step, base - heights[i]!);
  }
  ctx.lineTo(WIDTH, HEIGHT);
  ctx.lineTo(0, HEIGHT);
  ctx.fillStyle = color;
  ctx.fill();
}

export function landscape(ctx: Ink) {
  const random = randomFrom(73);
  const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  [[0, "#101629"], [.28, "#202741"], [.53, "#584451"], [.67, "#69535e"], [1, "#171d2d"]].forEach(([offset, color]) =>
    sky.addColorStop(Number(offset), String(color)));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const moonX = 1400;
  const moonY = 146;
  gradient(ctx, moonX, moonY, 192, "#eab9983b");
  gradient(ctx, moonX, moonY, 96, "#f2c3a043");
  oval(ctx, "#f6d3ae", moonX, moonY, 47);
  ctx.save();
  ctx.beginPath();
  ctx.arc(moonX, moonY, 46.5, 0, TWO_PI);
  ctx.clip();
  for (let i = 0; i < 140; i++) {
    oval(ctx, i % 2 ? "#f0bda638" : "#fff3c634", moonX - 48 + random() * 96, moonY - 48 + random() * 96, 1 + random() * 9, .3 + random() * 2);
  }
  ctx.restore();
  for (let i = 0; i < 225; i++) {
    const x = random() * WIDTH;
    const y = 16 + random() * 335;
    if (Math.hypot(x - moonX, y - moonY) < 53) continue;
    const size = .35 + random() * 1.12;
    oval(ctx, i % 5 === 0 ? "#ffd8a8b0" : "#e1cfde7d", x, y, size);
    if (i % 29 === 0) {
      ctx.fillStyle = "#f4cfab75";
      ctx.fillRect(x - size * 3, y - .4, size * 6, .8);
      ctx.fillRect(x - .4, y - size * 3, .8, size * 6);
    }
  }

  for (let i = 0; i < 35; i++) {
    const x = random() * WIDTH;
    const y = 138 + random() * 222;
    gradient(ctx, x, y, 50 + random() * 195, i % 2 ? "#80728827" : "#e1a49920", .035 + random() * .11);
  }
  hill(ctx, 405, "#4b4357", [109, 133, 93, 131, 86, 142, 102, 84, 115, 88, 114, 145, 102, 119, 86, 149, 103], 155);
  hill(ctx, 425, "#39384e", [94, 76, 108, 63, 99, 57, 88, 52, 94, 68, 99, 59, 110, 53, 91, 72, 94], 150);
  hill(ctx, 439, "#2b2c42", [59, 86, 49, 72, 39, 67, 47, 80, 48, 71, 42, 60, 81, 49, 59, 82, 48], 150);
  for (let x = 18; x < WIDTH; x += 29 + random() * 23) {
    const y = 383 + random() * 16;
    const w = 16 + random() * 36;
    ctx.fillStyle = "#24253a";
    ctx.fillRect(x - w / 2, y, w, 60);
    roof(ctx, x, y, w, 11 + random() * 18, "#222437", "#4c4358");
    if (random() > .26) {
      ctx.fillStyle = "#b384687a";
      ctx.fillRect(x + 2, y + 10, 4, 5);
      if (w > 39) ctx.fillRect(x - 9, y + 10, 3, 5);
    }
  }
  const templeX = 1166;
  ctx.fillStyle = "#27283c";
  ctx.fillRect(templeX - 34, 326, 68, 103);
  ctx.fillRect(templeX - 21, 294, 42, 41);
  ctx.fillRect(templeX - 11, 272, 22, 25);
  ctx.fillRect(templeX - 1, 246, 2, 22);
  for (const [y, w, h] of [[269, 21, 10], [294, 46, 15], [326, 67, 16], [362, 93, 19]] as const) {
    roof(ctx, templeX, y, w, h, "#252537", "#6f5362");
    if (y > 280) {
      ctx.fillStyle = "#aa78608a";
      ctx.fillRect(templeX - 2, y + 8, 4, 7);
    }
  }

  // Timber walkway above the river.
  ctx.fillStyle = "#232330";
  ctx.fillRect(0, 427, WIDTH, RIVER - 427);
  ctx.fillStyle = "#38303b";
  ctx.fillRect(0, 439, WIDTH, 42);
  ctx.fillStyle = "#51404a";
  ctx.fillRect(0, 439, WIDTH, 2);
  for (let i = 0; i < 1450; i++) {
    const x = random() * WIDTH, y = 441 + random() * 45;
    ctx.fillStyle = i % 3 ? "#a7887618" : "#17162264";
    ctx.fillRect(x, y, 1 + random() * 27, .5 + random());
  }
  for (let x = 0; x < WIDTH; x += 70) {
    ctx.strokeStyle = "#1919257f";
    ctx.beginPath();
    ctx.moveTo(x + 14, 440);
    ctx.lineTo(x, 483);
    ctx.stroke();
  }
  ctx.fillStyle = "#191a26";
  ctx.fillRect(0, 482, WIDTH, 21);
  ctx.fillStyle = "#55414b";
  ctx.fillRect(0, 483, WIDTH, 2);
  ctx.fillRect(0, 494, WIDTH, 1);

  const water = ctx.createLinearGradient(0, RIVER, 0, HEIGHT);
  water.addColorStop(0, "#171b2d");
  water.addColorStop(.44, "#282a42");
  water.addColorStop(1, "#141829");
  ctx.fillStyle = water;
  ctx.fillRect(0, RIVER, WIDTH, HEIGHT - RIVER);
  for (let x = 30; x < WIDTH; x += 131) {
    ctx.fillStyle = "#151723";
    ctx.fillRect(x, 486, 10, 33 + random() * 11);
    ctx.fillStyle = "#4b3845";
    ctx.fillRect(x + 2, 490, 1, 23);
  }
  for (let i = 0; i < 1100; i++) {
    const x = random() * WIDTH, y = RIVER + random() * (HEIGHT - RIVER);
    ctx.fillStyle = i % 3 ? "#9e8ba027" : "#090f1e63";
    ctx.fillRect(x, y, 2 + random() * 49, i % 9 ? .65 : 1.3);
  }
  for (let i = 0; i < 55; i++) {
    const y = RIVER + random() * (HEIGHT - RIVER);
    const x = moonX - 60 + random() * 120;
    ctx.fillStyle = i % 3 ? "#f3b9982b" : "#f3b99858";
    ctx.fillRect(x, y, 5 + random() * 66, i % 3 ? .65 : 1.2);
  }
}

export const trimColors = ["#ca9063", "#dc9564", "#c58c54", "#e8ac73", "#78a688", "#ac83bd", "#cb9b6c", "#d47a77"];
const scaleLevels = { dark: 0, tight: .34, healthy: .74, thriving: 1 };
type Light = keyof typeof scaleLevels;

function lantern(ctx: Ink, x: number, y: number, color: string, power: number, size = 1) {
  if (power > 0) gradient(ctx, x, y, 31 * size, color + Math.round(power * 137).toString(16).padStart(2, "0"));
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  ctx.strokeStyle = "#674a46";
  ctx.beginPath();
  ctx.moveTo(0, -16);
  ctx.lineTo(0, -6);
  ctx.moveTo(0, 6);
  ctx.lineTo(0, 11);
  ctx.stroke();
  oval(ctx, power ? color : "#373043", 0, 0, 6.5, 8.1);
  oval(ctx, power ? "#fff1bdb0" : "#322b3a", 0, 0, 3.2, 7.4);
  ctx.fillStyle = "#593c3b";
  ctx.fillRect(-4, -8, 8, 2);
  ctx.fillRect(-4, 6, 8, 2);
  ctx.restore();
}

function keeper(ctx: Ink, x: number, y: number, style: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  oval(ctx, "#1717226e", 0, 0, 22, 4);
  poly(ctx, "#211c26", [[-7,-34],[8,-34],[16,-4],[-14,-4]], color + "5c");
  oval(ctx, "#362731", 0, -41, 8, 10);
  if (style % 4 === 1) {
    poly(ctx, "#211d29", [[-18,-45],[-8,-51],[-2,-59],[6,-58],[12,-49],[19,-45]], color + "66");
  } else if (style % 4 === 2) {
    poly(ctx, "#211d29", [[-9,-43],[-8,-56],[5,-57],[11,-46]], color + "66");
  } else if (style % 4 === 3) {
    oval(ctx, "#211d29", 4, -50, 8, 6);
  } else {
    oval(ctx, "#211d29", 0, -46, 11, 7);
  }
  ctx.fillStyle = "#1b1a25";
  ctx.fillRect(-8, -5, 5, 6);
  ctx.fillRect(4, -5, 5, 6);
  ctx.restore();
}

export function stall(ctx: Ink, style: number, light: Light, stock: number) {
  const random = randomFrom(style * 95 + 12);
  const color = trimColors[style]!;
  const power = scaleLevels[light];
  const x = 124, y = 179;
  const houseWidth = style === 6 ? 115 : style === 3 ? 191 : 170 + 10 * (style % 3);
  const left = x - houseWidth / 2;
  const right = x + houseWidth / 2;
  const tall = style === 6 ? 104 : 139 + style % 3 * 12;
  const top = y - tall;
  const roofY = top + 30;
  if (power > 0) gradient(ctx, x, y - 52, 125, color + Math.round(power * 61).toString(16).padStart(2, "0"), .86);
  oval(ctx, "#17162187", x, y + 2, houseWidth * .58, 9);
  ctx.fillStyle = "#191923";
  ctx.fillRect(left + 3, roofY - 3, houseWidth - 6, y - roofY + 3);
  const wall = ctx.createLinearGradient(left, 0, right, 0);
  wall.addColorStop(0, "#28222d");
  wall.addColorStop(.52, power ? color + "52" : "#231f2d");
  wall.addColorStop(1, "#231f2a");
  ctx.fillStyle = wall;
  ctx.fillRect(left + 8, roofY, houseWidth - 16, y - roofY - 5);
  if (power > 0) gradient(ctx, x, y - 57, 75, color + "5d", .78);
  for (let bx = left + 17; bx < right - 12; bx += 13) {
    ctx.fillStyle = "#120f1980";
    ctx.fillRect(bx, roofY + 6, 1, y - roofY - 16);
  }
  if (style !== 6 && style !== 0) {
    const inset = style === 3 ? 34 : 27;
    const frameY = roofY + 27;
    ctx.fillStyle = "#231c25";
    ctx.fillRect(left + inset, frameY, houseWidth - inset * 2, y - frameY - 16);
    if (power) {
      const inside = ctx.createLinearGradient(0, frameY, 0, y);
      inside.addColorStop(0, "#362433");
      inside.addColorStop(.65, color + "90");
      inside.addColorStop(1, "#614334");
      ctx.fillStyle = inside;
      ctx.fillRect(left + inset + 4, frameY + 4, houseWidth - inset * 2 - 8, y - frameY - 22);
      for (let i = 0; i < Math.min(stock, 11); i++) {
        const xx = left + inset + 9 + i % 6 * 17;
        const yy = y - 36 - Math.floor(i / 6) * 21;
        if (style % 3 === 2) {
          oval(ctx, "#3b2730", xx + 4, yy + 5, 5, 6);
          ctx.fillStyle = color + "93";
          ctx.fillRect(xx + 3, yy - 3, 2, 3);
        } else {
          ctx.fillStyle = i % 2 ? "#51383d" : "#734b42";
          ctx.fillRect(xx, yy, 10, 10);
          ctx.fillStyle = color + "83";
          ctx.fillRect(xx + 1, yy + 1, 8, 1);
        }
      }
      ctx.fillStyle = "#241d28";
      ctx.fillRect(left + inset + 2, y - 51, houseWidth - inset * 2 - 4, 3);
    } else {
      for (let yy = frameY + 6; yy < y - 17; yy += 6) {
        ctx.fillStyle = "#302637";
        ctx.fillRect(left + inset + 2, yy, houseWidth - inset * 2 - 4, 4);
      }
    }
  }
  if (style === 6) {
    ctx.fillStyle = "#120f18";
    ctx.fillRect(x - 41, y - 66, 82, 55);
    ctx.fillStyle = "#51404a";
    ctx.fillRect(x - 38, y - 63, 76, 48);
    for (let i = 0; i < 5; i++) {
      const xx = x - 34 + (i % 3) * 22, yy = y - 59 + Math.floor(i / 3) * 20 + i % 2 * 3;
      poly(ctx, i % 2 ? "#a17b67" : "#c49877", [[xx,yy],[xx+17,yy-1],[xx+17,yy+15],[xx+2,yy+17]]);
      ctx.fillStyle = "#523c3d";
      ctx.fillRect(xx + 4, yy + 5, 9, 1);
      ctx.fillRect(xx + 4, yy + 8, 7, 1);
    }
  }
  ctx.fillStyle = "#171620";
  ctx.fillRect(left + 8, roofY, 5, y - roofY);
  ctx.fillRect(right - 13, roofY, 5, y - roofY);
  ctx.fillRect(left + 12, y - 15, houseWidth - 24, 7);
  if (style === 5 || style === 7 || style === 0 || style === 3) {
    roof(ctx, x, roofY - 1, houseWidth, style === 5 ? 31 : 24, "#191a28", color + "74");
    for (let i = 0; i < 3; i++) roof(ctx, x, roofY - 5 - i * 4, houseWidth * (.88 - i * .13), 15 - i * 3, "#201e2b", color + "41");
  } else {
    poly(ctx, "#1c1b28", [[left-9,roofY],[left+25,top+4],[right-28,top+4],[right+9,roofY]], color + "85");
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = color + "29";
      ctx.fillRect(left + 10 - i * 4, top + 12 + i * 6, houseWidth - 20 + i * 8, 1);
    }
  }

  if ([1, 2, 4, 5, 7].includes(style)) {
    const awningY = roofY + 31;
    for (let i = 0; i < 10; i++) {
      const xx = left + i * houseWidth / 10;
      const ww = houseWidth / 10;
      poly(ctx, i % 2 ? "#3b2b3a" : color + "b0", [[xx+5,awningY-11],[xx+ww+5,awningY-11],[xx+ww,awningY+3],[xx,awningY+3]]);
      oval(ctx, i % 2 ? "#302638" : color + "a8", xx + ww / 2, awningY + 2, ww / 2, 4);
    }
  }
  if (style !== 0) {
    lantern(ctx, left + 15, y - 52, color, power, style === 3 ? 1.25 : 1);
    lantern(ctx, right - 15, y - 52, color, power);
  }
  if (light === "thriving") {
    for (let i = 0; i < 4; i++) lantern(ctx, left + 36 + i * 33, roofY + 17 + i % 2 * 4, color, power, .6);
  }
  for (let i = 0; i < 7; i++) {
    const xx = i < 4 ? left + 5 + i * 9 : right - 36 + (i - 4) * 9;
    const yy = y - 4 - random() * 14;
    if (i > stock && style !== 0) break;
    ctx.fillStyle = "#251f28";
    ctx.fillRect(xx, yy, 9, 10);
    ctx.fillStyle = "#65504a";
    ctx.fillRect(xx, yy, 9, 1);
  }
  if (style !== 6 && style !== 0) keeper(ctx, x + (style % 2 ? 33 : -33), y + 2, style, color);
}

export function boat(ctx: Ink) {
  const random = randomFrom(45);
  ctx.beginPath();
  ctx.moveTo(6, 34);
  ctx.quadraticCurveTo(68, 52, 144, 32);
  ctx.quadraticCurveTo(133, 58, 115, 62);
  ctx.quadraticCurveTo(69, 70, 27, 59);
  ctx.closePath();
  ctx.fillStyle = "#1d1c2c";
  ctx.fill();
  ctx.strokeStyle = "#73545f";
  ctx.stroke();
  poly(ctx, "#4c3b49", [[6,34],[54,43],[108,42],[145,32],[134,42],[104,49],[54,50],[17,42]]);
  poly(ctx, "#292437", [[34,40],[49,21],[100,21],[116,42],[110,43],[98,25],[51,25],[42,41]], "#5e465a");
  ctx.fillStyle = "#543c4b";
  ctx.fillRect(72, 8, 2, 35);
  poly(ctx, "#905b65", [[74,9],[91,12],[77,18]]);
  for (let i = 0; i < 23; i++) {
    ctx.fillStyle = "#a1797740";
    ctx.fillRect(32 + random() * 86, 51 + random() * 8, 2 + random() * 9, .75);
  }
}

export function playerCart(ctx: Ink) {
  ctx.translate(0, 10);
  keeper(ctx, 59, 50, 1, "#94cec2");
  poly(ctx, "#28242f", [[9,25],[40,25],[45,31],[41,43],[12,43],[6,33]], "#936751");
  ctx.strokeStyle = "#8d6b60";
  ctx.beginPath();
  ctx.moveTo(16, 28); ctx.lineTo(43, 28); ctx.lineTo(54, 34); ctx.stroke();
  for (const x of [16, 36]) {
    oval(ctx, "#161a28", x, 45, 6.5);
    oval(ctx, "#655057", x, 45, 4.4);
    oval(ctx, "#201c27", x, 45, 2.2);
  }
  poly(ctx, "#554247", [[13,24],[14,17],[25,18],[28,25]], "#9b7563");
  lantern(ctx, 42, 20, "#8ee6cb", 1, .65);
}

export function foreground(ctx: Ink) {
  const random = randomFrom(815);
  for (const origin of [4, 235, 2180, 2310]) {
    for (let i = 0; i < 38; i++) {
      const x = origin + random() * 96 - 48;
      const y = 676 - random() * 33;
      const height = 16 + random() * 95, bend = random() * 52 - 26;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + bend * .05, y - height * .64, x + bend, y - height);
      ctx.strokeStyle = i % 4 ? "#141827" : "#2c2636";
      ctx.lineWidth = 1.4 + random() * 3;
      ctx.stroke();
      if (i % 3 === 0) oval(ctx, "#1a1b2b", x + bend, y - height, 2.1, 9.3);
    }
  }
}

export function glowTexture(ctx: Ink) {
  gradient(ctx, 64, 64, 64, "#ffffffbb");
}

export function riverReflection(ctx: Ink) {
  const random = randomFrom(473);
  for (let i = 0; i < 45; i++) {
    const y = 3 + random() * 117;
    const x = 64 + (random() - .5) * (29 + y * .42);
    const width = 4 + random() * (18 + y * .24);
    oval(ctx, `rgba(255,255,255,${(.8 - y / 165) * random()})`, x, y, width / 2, .5 + random() * 1.2);
  }
}

export function boatLanterns(ctx: Ink) {
  lantern(ctx, 33, 31, "#ffb874", .95, .8);
  lantern(ctx, 65, 29, "#ffd095", 1, .9);
}
