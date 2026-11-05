import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { runFixture, type Fixture } from "./golden-runner";

const directory = new URL("./golden/", import.meta.url);
const files = readdirSync(directory).filter(file => file.endsWith(".json"));
describe("market golden cases", () => {
  test.each(files)("%s", file => {
    const data = JSON.parse(readFileSync(new URL(file, directory), "utf8")) as { fixture: Fixture; expected: unknown };
    expect(runFixture(data.fixture)).toEqual(data.expected);
  });
});
