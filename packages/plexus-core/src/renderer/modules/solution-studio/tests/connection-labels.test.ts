import { test } from "vitest";
import assert from "node:assert/strict";
import { ConnectionLabels } from "../connection-labels.js";

test("builds a label per connection and maps label ↔ id both ways", () => {
  const labels = new ConnectionLabels([
    { id: "github-packages", name: "GitHub Packages" },
    { id: "internal", name: "Internal" },
  ]);
  assert.deepEqual([...labels.labels], ["GitHub Packages", "Internal"]);
  assert.equal(labels.idForLabel("GitHub Packages"), "github-packages");
  assert.equal(labels.labelForId("internal"), "Internal");
});

test("disambiguates duplicate names so labels stay unique and the map stays bijective", () => {
  const labels = new ConnectionLabels([
    { id: "gh-1", name: "GitHub Packages" },
    { id: "gh-2", name: "GitHub Packages" },
    { id: "gh-3", name: "GitHub Packages" },
  ]);
  assert.deepEqual([...labels.labels], ["GitHub Packages", "GitHub Packages (2)", "GitHub Packages (3)"]);
  assert.equal(labels.idForLabel("GitHub Packages"), "gh-1");
  assert.equal(labels.idForLabel("GitHub Packages (2)"), "gh-2");
  assert.equal(labels.idForLabel("GitHub Packages (3)"), "gh-3");
  assert.equal(labels.labelForId("gh-2"), "GitHub Packages (2)");
});

test("unknown / undefined lookups return undefined", () => {
  const labels = new ConnectionLabels([{ id: "a", name: "A" }]);
  assert.equal(labels.idForLabel(undefined), undefined);
  assert.equal(labels.idForLabel("nope"), undefined);
  assert.equal(labels.labelForId(undefined), undefined);
  assert.equal(labels.labelForId("nope"), undefined);
});
