import test from "node:test";
import assert from "node:assert/strict";
import { decodeInventory, encodeInventory } from "../js/codec.js";

test("round-trips ordered Dota item IDs", () => {
  const ids = [1, 0, 600, 116, 0, 4302];
  assert.deepEqual(decodeInventory(encodeInventory(ids)), ids);
});

test("keeps six-item links compact", () => {
  const code = encodeInventory([1, 48, 600, 116, 123, 4302]);
  assert.ok(code.length <= 20, `expected a compact code, received ${code.length} characters`);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
});

test("supports an empty inventory", () => {
  assert.deepEqual(decodeInventory(encodeInventory([])), []);
});

test("rejects malformed and oversized builds", () => {
  assert.throws(() => decodeInventory("not+a+code"));
  assert.throws(() => encodeInventory([1, 2, 3, 4, 5, 6, 7]));
  assert.throws(() => encodeInventory([-1]));
});
