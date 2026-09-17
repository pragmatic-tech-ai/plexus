import { test } from "vitest";
import assert from "node:assert/strict";
import { CONNECTION_FIELDS, CONNECTION_ID_KEY } from "../connection-fields.js";

test("the connection bag exposes exactly a connectionId reference", () => {
  assert.deepEqual(CONNECTION_FIELDS.map((f) => f.key), [CONNECTION_ID_KEY]);
});

test("security: the bag stores no credential fields (token / secret / password)", () => {
  const keys = CONNECTION_FIELDS.map((f) => f.key);
  assert.ok(!keys.some((k) => /token|secret|password/i.test(k)), "connection bag must never hold a credential");
});
