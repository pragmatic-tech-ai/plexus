/**
 * `EncryptedSecretStore` — the devUI host implementation of the engine's
 * `ISecretStore`, backed by the existing `ConnectionTokenStore` (per-connection
 * tokens encrypted at rest via Electron safeStorage, keyed by connection id). Just
 * an async adapter over the synchronous token store; the token never crosses the
 * IPC bridge.
 */
import { type ISecretStore } from "@pragmatic-tech-ai/todl/package-manager";
import type { ConnectionTokenStore } from "../connection-token-store.js";

export class EncryptedSecretStore implements ISecretStore
{
  constructor(private readonly tokens: ConnectionTokenStore) {}

  public async Get(key: string): Promise<string | undefined>
  {
    const token = this.tokens.getToken(key);
    return token.length > 0 ? token : undefined;
  }

  public async Set(key: string, secret: string): Promise<void>
  {
    this.tokens.setToken(key, secret);
  }

  public async Delete(key: string): Promise<void>
  {
    this.tokens.clear(key);
  }
}
