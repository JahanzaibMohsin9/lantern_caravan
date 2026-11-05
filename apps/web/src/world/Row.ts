import Phaser from "phaser";
import type { CashBand, Snapshot } from "@lantern/protocol";
import { foreground, glowTexture, landscape, playerCart, stall, boat, boatLanterns, riverReflection, WIDTH, HEIGHT, WALK, RIVER, trimColors } from "../art/market";
import { bridge, stops, type Effect, type Stop } from "./bridge";

const center = stops[3].x;
const boatPositions = [1458, 1695, 914, 625, 1161, 1945];
const boatColor = 0xffb474;
const labelColors = { dark: "#cba5ab", tight: "#e6c184", healthy: "#bfccb0", thriving: "#ffe0a3" };
const labelNames = { dark: "◇ Closed", tight: "◐ Tight", healthy: "● Healthy", thriving: "✧ Thriving" };

class RowScene extends Phaser.Scene {
  private avatar!: Phaser.GameObjects.Image;
  private left!: Phaser.Input.Keyboard.Key;
  private right!: Phaser.Input.Keyboard.Key;
  private a!: Phaser.Input.Keyboard.Key;
  private d!: Phaser.Input.Keyboard.Key;
  private bodies: Phaser.GameObjects.Image[] = [];
  private signs: Phaser.GameObjects.Text[] = [];
  private captions: Phaser.GameObjects.Text[] = [];
  private pools: Phaser.GameObjects.Image[] = [];
  private boats: { hull: Phaser.GameObjects.Image; light: Phaser.GameObjects.Image; lantern: Phaser.GameObjects.Image;
    reflection: Phaser.GameObjects.Image; lit: boolean; y: number }[] = [];
  private motes: Phaser.GameObjects.Arc[] = [];
  private ambience!: Phaser.GameObjects.Image;
  private x: number = center;
  private cameraX: number = center;
  private destination: typeof stops[number] | undefined;
  private lastStop: Stop = "workshop";
  private active = false;
  private reduced = false;
  private blocked = false;
  private revision = -1;

  constructor() { super("The Row"); }

  private texture(key: string, width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
    if (!this.textures.exists(key)) {
      const texture = this.textures.createCanvas(key, width, height)!;
      draw(texture.context);
      texture.refresh();
    }
    return key;
  }

  create() {
    this.add.image(0, 0, this.texture("row-landscape", WIDTH, HEIGHT, landscape)).setOrigin(0);
    this.texture("row-glow", 128, 128, glowTexture);
    this.texture("row-reflection", 128, 128, riverReflection);
    this.texture("row-boat", 150, 72, boat);
    this.texture("row-boat-lanterns", 96, 64, boatLanterns);
    this.texture("row-cart", 80, 65, playerCart);
    this.texture("row-reeds", WIDTH, HEIGHT, foreground);
    this.ambience = this.add.image(center, 291, "row-glow").setDisplaySize(1400, 520).setTint(0xffc084)
      .setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setDepth(1);

    stops.forEach((stop, index) => {
      const tint = Phaser.Display.Color.HexStringToColor(trimColors[index]!).color;
      this.pools.push(this.add.image(stop.x, RIVER + 54, "row-reflection").setDisplaySize(156, 105)
        .setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setAlpha(index === 0 ? 0 : .45));
      this.add.image(stop.x, WALK - 5, "row-glow").setDisplaySize(162, 30)
        .setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setAlpha(index === 0 ? 0 : .17);
      this.bodies.push(this.add.image(stop.x, WALK + 5 - 179, this.stallTexture(index, index === 0 ? "dark" : "healthy", 11))
        .setOrigin(.5, 0).setDepth(2));
      this.signs.push(this.add.text(stop.x, WALK + 13, stop.name, {
        fontFamily: "Manrope Variable, sans-serif", fontSize: "13px", fontStyle: "bold",
        color: index === 3 ? "#ffe2b6" : "#e8c8ae", backgroundColor: "#211d2be8",
        padding: { x: 10, y: 4 },
      }).setOrigin(.5, 0).setDepth(6));
      this.captions.push(this.add.text(stop.x, WALK + 38, "", {
        fontFamily: "Manrope Variable, sans-serif", fontSize: "10px", color: "#bfccb0",
      }).setOrigin(.5, 0).setDepth(6).setVisible(false));
      this.add.zone(stop.x, WALK - 72, 206, 200).setDepth(8).setInteractive({ useHandCursor: true })
        .on("pointerdown", () => { if (this.active && !this.blocked) this.visit(stop.id); });
    });

    this.stringLights();
    const random = new Phaser.Math.RandomDataGenerator(["embers"]);
    for (let i = 0; i < 60; i++) {
      const dot = this.add.circle(random.between(235, 2130), random.between(310, 481), random.realInRange(.65, 1.7), 0xffbc79, .5)
        .setDepth(3).setData("origin", random.between(320, 478));
      this.motes.push(dot);
    }

    boatPositions.forEach((x, i) => {
      const y = 559 + (i % 2) * 34;
      this.boats.push({
        y, lit: false,
        reflection: this.add.image(x, y + 65, "row-reflection").setDisplaySize(184, 82).setTint(boatColor)
          .setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setDepth(1),
        hull: this.add.image(x, y, "row-boat").setDepth(2),
        light: this.add.image(x, y - 2, "row-glow").setDisplaySize(175, 103).setTint(boatColor)
          .setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setDepth(3),
        lantern: this.add.image(x, y - 4, "row-boat-lanterns").setAlpha(0).setDepth(4),
      });
    });

    this.avatar = this.add.image(this.x, WALK + 10, "row-cart").setOrigin(.5, .78).setDepth(5);
    this.add.image(0, 0, "row-reeds").setOrigin(0).setDepth(7);
    const keyboard = this.input.keyboard!;
    this.left = keyboard.addKey("LEFT", false);
    this.right = keyboard.addKey("RIGHT", false);
    this.a = keyboard.addKey("A", false);
    this.d = keyboard.addKey("D", false);

    const cleanup = [
      bridge.on("visit", id => this.visit(id)),
      bridge.on("active", active => {
        this.active = active;
        if (!active) { this.x = center; this.destination = undefined; }
        this.captions.forEach(text => text.setVisible(active));
      }),
      bridge.on("snapshot", snapshot => this.renderMarket(snapshot)),
      bridge.on("reduced", reduced => { this.reduced = reduced; }),
      bridge.on("blocked", blocked => { this.blocked = blocked; }),
      bridge.on("effect", effect => this.feedback(effect)),
    ];
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => cleanup.forEach(unsubscribe => unsubscribe()));
    this.scale.on(Phaser.Scale.Events.RESIZE, this.resize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.resize, this));
    this.resize();
    this.game.canvas.setAttribute("aria-hidden", "true");
  }

  private stringLights() {
    const line = this.add.graphics().setDepth(3);
    for (let index = 1; index < stops.length; index++) {
      const from = stops[index - 1]!.x + 39;
      const to = stops[index]!.x - 39;
      line.lineStyle(1, 0x977268, .6);
      line.beginPath();
      for (let step = 0; step <= 16; step++) {
        const ratio = step / 16;
        const y = 332 + Math.sin(ratio * Math.PI) * 19;
        if (step === 0) line.moveTo(from, y);
        else line.lineTo(Phaser.Math.Linear(from, to, ratio), y);
      }
      line.strokePath();
      for (let bulb = 1; bulb <= 4; bulb++) {
        const ratio = bulb / 5;
        const x = Phaser.Math.Linear(from, to, ratio);
        const y = 335 + Math.sin(ratio * Math.PI) * 19;
        const color = bulb % 3 === 0 ? 0xf8ad84 : 0xffc58b;
        this.add.image(x, y, "row-glow").setDisplaySize(28, 28).setAlpha(.38).setTint(color)
          .setBlendMode(Phaser.BlendModes.ADD).setDepth(3);
        this.add.ellipse(x, y, 4.4, 6.5, color).setDepth(3);
      }
    }
  }

  private resize() {
    const cam = this.cameras.main;
    cam.setZoom(this.scale.height / HEIGHT);
    cam.centerOn(this.cameraX, HEIGHT / 2);
  }

  private visit(id: Stop) {
    if (!this.active) return;
    this.destination = stops.find(stop => stop.id === id);
  }

  private stallTexture(index: number, band: CashBand, stock: number) {
    return this.texture(`row-stall-${index}-${band}-${stock}`, 248, 200, ctx => stall(ctx, index, band, stock));
  }

  private renderMarket(snapshot: Snapshot) {
    if (this.revision === snapshot.revision) return;
    this.revision = snapshot.revision;
    const light = { dark: 0, tight: .3, healthy: .66, thriving: 1 };
    let health = 0;
    stops.forEach((stop, index) => {
      const market = snapshot.merchants[stop.id];
      if (!market) return;
      const stock = Math.min(11, Object.values(market.stock).reduce((sum, amount) => sum + Number(amount), 0));
      const band = market.band;
      health += light[band];
      this.bodies[index]!.setTexture(this.stallTexture(index, band, stop.id === "lantern_house" ? 8 : stock));
      this.captions[index]!.setText(labelNames[band]).setColor(labelColors[band]);
      this.pools[index]!.setAlpha(light[band] * .7);
    });
    const litCount = snapshot.orders.filter(order => order.state === "filled").length;
    this.ambience.setAlpha((.4 * health / Object.keys(snapshot.merchants).length + .6 * litCount / 6) * .36);
    this.boats.forEach((entry, index) => {
      const lit = snapshot.orders.some(order => order.boat === index && order.state === "filled");
      if (lit === entry.lit) return;
      entry.lit = lit;
      this.tweens.killTweensOf([entry.light, entry.lantern, entry.reflection]);
      if (lit && !this.reduced && this.active) {
        entry.lantern.y = entry.y + 18;
        this.tweens.add({ targets: entry.lantern, y: entry.y - 4, alpha: 1, duration: 900, ease: "Sine.Out" });
        this.tweens.add({ targets: entry.light, alpha: .85, duration: 1150 });
        this.tweens.add({ targets: entry.reflection, alpha: .9, duration: 1350 });
      } else {
        entry.lantern.y = entry.y - 4;
        entry.lantern.setAlpha(lit ? 1 : 0);
        entry.light.setAlpha(lit ? .85 : 0);
        entry.reflection.setAlpha(lit ? .9 : 0);
      }
    });
  }

  private feedback(effect: Effect) {
    if (this.reduced || effect === "boat") return;
    const color = effect === "buy" ? 0x93e5c6 : effect === "refuse" ? 0xd88e88 : 0xffcb91;
    for (let i = 0; i < 9; i++) {
      const angle = i * Math.PI * 2 / 9;
      const spark = this.add.circle(this.x + 6, WALK - 25, 2 + i % 2, color).setDepth(6);
      this.tweens.add({ targets: spark, x: spark.x + Math.cos(angle) * 39,
        y: spark.y + Math.sin(angle) * 31 - 22, alpha: 0, scale: .35,
        duration: 460 + i * 26, ease: "Cubic.Out", onComplete: () => spark.destroy() });
    }
  }

  update(time: number, delta: number) {
    const direction = this.active && !this.blocked
      ? Number(this.right.isDown || this.d.isDown) - Number(this.left.isDown || this.a.isDown) : 0;
    let walking = false;
    if (direction) {
      this.destination = undefined;
      this.x = Phaser.Math.Clamp(this.x + direction * delta * .49, stops[0].x, stops[7].x);
      this.avatar.setFlipX(direction < 0);
      walking = true;
    } else if (this.destination && !this.blocked) {
      const offset = this.destination.x - this.x;
      this.x += Math.sign(offset) * Math.min(Math.abs(offset), delta * .61);
      walking = offset !== 0;
      if (walking) this.avatar.setFlipX(offset < 0);
      if (this.x === this.destination.x) {
        const id = this.destination.id;
        this.destination = undefined;
        bridge.send("arrive", id);
      }
    }
    const nearest = stops.reduce((a, b) => Math.abs(a.x - this.x) < Math.abs(b.x - this.x) ? a : b);
    if (nearest.id !== this.lastStop) {
      this.lastStop = nearest.id;
      bridge.send("current", nearest.id);
    }
    this.avatar.setPosition(this.x + 13, WALK + 8 + (walking && !this.reduced ? Math.sin(time / 55) * 2.5 : 0));
    const camera = this.cameras.main;
    const half = this.scale.width / camera.zoom / 2;
    const aim = half * 2 >= WIDTH ? WIDTH / 2 : Phaser.Math.Clamp(this.x, half, WIDTH - half);
    this.cameraX = this.reduced ? aim : Phaser.Math.Linear(this.cameraX, aim, Math.min(.16, delta / 170));
    camera.centerOn(this.cameraX, HEIGHT / 2);
    this.signs.forEach((sign, index) => {
      const alpha = Phaser.Math.Clamp((half - Math.abs(sign.x - this.cameraX) - sign.width / 2) / 25, 0, 1);
      sign.setAlpha(alpha);
      this.captions[index]!.setAlpha(alpha);
    });
    if (this.reduced) return;
    this.boats.forEach((entry, index) => {
      const bob = Math.sin(time / 950 + index) * 1.7;
      entry.hull.y = entry.y + bob;
      entry.light.y = entry.y - 2 + bob;
      entry.reflection.scaleX = 1.44 + Math.sin(time / 710 + index) * .065;
    });
    this.motes.forEach((dot, index) => {
      dot.y = dot.getData("origin") + Math.sin(time / 1600 + index * 2) * 14;
      dot.alpha = .28 + Math.sin(time / 500 + index) * .2;
    });
  }
}

export function mountRow(parent: HTMLElement) {
  const game = new Phaser.Game({
    parent, type: Phaser.AUTO, transparent: false, backgroundColor: "#171d2c",
    scale: { mode: Phaser.Scale.RESIZE, width: parent.clientWidth, height: parent.clientHeight },
    render: { antialias: true, roundPixels: false },
    input: { keyboard: { capture: [] } },
    scene: RowScene, banner: false, audio: { noAudio: true },
  });
  return () => game.destroy(true);
}
