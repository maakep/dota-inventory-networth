import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const snapshot = JSON.parse(
  await readFile(new URL("../data/items.json", import.meta.url), "utf8"),
);

test("checked-in item snapshot is complete and internally consistent", () => {
  assert.ok(Array.isArray(snapshot.items));
  assert.ok(snapshot.items.length >= 300);
  assert.equal(snapshot.meta.count, snapshot.items.length);
  assert.match(snapshot.meta.source, /^https:\/\/www\.dota2\.com\/datafeed\/itemlist/);
  assert.ok(Number.isFinite(Date.parse(snapshot.meta.updatedAt)));
});

test("item records have unique IDs and calculator-safe prices", () => {
  const ids = new Set();
  for (const item of snapshot.items) {
    assert.ok(Number.isInteger(item.id) && item.id > 0);
    assert.ok(!ids.has(item.id), `duplicate item ID ${item.id}`);
    ids.add(item.id);
    assert.equal(typeof item.name, "string");
    assert.equal(typeof item.nameLocalized, "string");
    assert.ok(Number.isFinite(item.cost) && item.cost >= 0);
  }
});
