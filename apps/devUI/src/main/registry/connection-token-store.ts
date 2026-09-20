/**
 * `ConnectionTokenStore` — per-connection auth tokens, encrypted at rest in
 * `userData` (security §7), keyed by connection id (`conn-token-<id>.bin`). The
 * renderer never sees a token; only `hasToken(id)` crosses the bridge. Encryption
 * is injected as an `Encryptor` (the same seam as the legacy single-token store)
 * so the unit test runs with no Electron. When encryption is unavailable (rare
 * Linux without a keyring), tokens are held in memory for the session and never
 * written in plaintext.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Encryptor } from "./token-store.js";

export class ConnectionTokenStore
{
  private readonly memory = new Map<string, string>();

  constructor(
    private readonly userDataDir: string,
    private readonly encryptor: Encryptor,
  ) {}

  hasToken(id: string): boolean
  {
    return this.getToken(id).length > 0;
  }

  getToken(id: string): string
  {
    const inMemory = this.memory.get(id);
    if (inMemory !== undefined && inMemory.length > 0) return inMemory;
    const path = this.pathFor(id);
    if (!existsSync(path)) return "";
    return this.encryptor.decrypt(readFileSync(path));
  }

  setToken(id: string, token: string): void
  {
    if (!this.encryptor.available())
    {
      this.memory.set(id, token); // session-only fallback; never write plaintext
      return;
    }
    mkdirSync(this.userDataDir, { recursive: true });
    writeFileSync(this.pathFor(id), this.encryptor.encrypt(token));
    this.memory.delete(id);
  }

  clear(id: string): void
  {
    this.memory.delete(id);
    const path = this.pathFor(id);
    if (existsSync(path)) rmSync(path);
  }

  private pathFor(id: string): string
  {
    return join(this.userDataDir, `conn-token-${id}.bin`);
  }
}
