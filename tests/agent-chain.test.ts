import { expect, test } from "vitest";
import { advanceClock, createWorld, newNight, openNight } from "@lantern/game-core";

test("the live agents leave a readable chain: a merchant's job, a hauler's reasoned choice, delivery and pay, and a rival giving way", () => {
  let world = createWorld("live", 42);
  const lines: string[] = [];
  for (let night = 1; night <= 12; night++) {
    world = openNight(world);
    for (let elapsed = 10; elapsed <= 300; elapsed += 10) world = advanceClock(world, elapsed);
    lines.push(...world.activity.filter(entry => entry.night === world.night).map(entry => entry.line));
    world = newNight(world);
  }
  const posted = lines.find(line => /^[\w& ]+ rang the Harbor Bell: \d+ [a-z ]+ from [A-Z][\w ]+ for \d+ coins \(stock \d+ of \d+/.test(line));
  expect(posted).toBeDefined();
  // A hauler that takes a job says what it pays, what the cargo costs and how dangerous the route is.
  expect(lines.some(line => /: Hauling \d+ [a-z ]+ from .+ for its Harbor Bell job\. The Harbor Bell pays \d+, costs \d+ upriver, danger \d\./.test(line))).toBe(true);
  expect(lines.some(line => / delivered \d+ [a-z ]+ to .+ and collected the Harbor Bell’s \d+ coins\./.test(line))).toBe(true);
  // Swarm coordination: a hauler leaves a job another hauler took first, and names what it does instead.
  expect(lines.some(line => / left .+’s [a-z ]+ job to \w+, who took it first, and is hauling .+ instead\./.test(line))).toBe(true);
});
