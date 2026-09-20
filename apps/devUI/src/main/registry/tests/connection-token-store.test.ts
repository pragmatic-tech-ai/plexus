import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectionTokenStore } from "../connection-token-store.js";
import type { Encryptor } from "../token-store.js";

/** Reversible non-identity fake: XOR-with-0x5A then base64 (encrypt-at-rest). */
class FakeEncryptor implements Encryptor
{
  available(): boolean
  {
    return true;
  }
  encrypt(plain: string): Buffer
  {
    const raw = Buffer.from(plain, "utf8").map((b) => b ^ 0x5a);
    return Buffer.from(raw.toString("base64"), "utf8");
  }
  decrypt(cipher: Buffer): string
  {
    const raw = Buffer.from(cipher.toString("utf8"), "base64").map((b) => b ^ 0x5a);
    return raw.toString("utf8");
  }
}

const freshDir = () => mkdtempSync(join(tmpdir(), "conn-token-"));

test("tokens are keyed per connection id and round-trip independently", () => {
  const dir = freshDir();
  const store = new ConnectionTokenStore(dir, new FakeEncryptor());
  assert.equal(store.hasToken("a"), false);
  store.setToken("a", "ghp_a");
  store.setToken("b", "ghp_b");
  assert.equal(store.getToken("a"), "ghp_a");
  assert.equal(store.getToken("b"), "ghp_b");
  assert.equal(store.hasToken("a"), true);
});

test("a token is written encrypted, not in plaintext", () => {
  const dir = freshDir();
  const store = new ConnectionTokenStore(dir, new FakeEncryptor());
  store.setToken("gh", "ghp_secret123");
  assert.equal(existsSync(join(dir, "conn-token-gh.bin")), true);
});

test("getToken returns empty for an unknown id", () => {
  assert.equal(new ConnectionTokenStore(freshDir(), new FakeEncryptor()).getToken("nope"), "");
});

test("clear removes only that connection's token", () => {
  const dir = freshDir();
  const store = new ConnectionTokenStore(dir, new FakeEncryptor());
  store.setToken("a", "ta");
  store.setToken("b", "tb");
  store.clear("a");
  assert.equal(store.hasToken("a"), false);
  assert.equal(store.getToken("b"), "tb");
  assert.equal(existsSync(join(dir, "conn-token-a.bin")), false);
});

test("when encryption is unavailable, tokens stay in memory and are not written", () => {
  class Unavailable extends FakeEncryptor
  {
    available(): boolean
    {
      return false;
    }
  }
  const dir = freshDir();
  const store = new ConnectionTokenStore(dir, new Unavailable());
  store.setToken("a", "mem-only");
  assert.equal(store.getToken("a"), "mem-only");
  assert.equal(existsSync(join(dir, "conn-token-a.bin")), false);
});
