/**
 * A named package-registry connection — the persisted, non-secret half of a
 * registry the app can talk to (GitHub Packages today). The auth token is NEVER
 * part of this record; it is held separately, encrypted, in `ConnectionTokenStore`
 * keyed by `id`. Multiple connections are managed by `PackageRegistryManager`;
 * one is the `defaultId` used by legacy (non-connection-scoped) registry ops.
 */
/** Where a connection's auth token comes from. The canonical home for this enum
 *  (pure — no node:fs), so both main and the renderer VMs can import it without
 *  dragging the file-backed stores into the renderer bundle. */
export enum TokenSource
{
  Stored = "stored",
  Env = "env",
}

export interface RegistryConnection
{
  /** Stable slug identity (derived from the name at creation, de-duplicated). */
  id: string;
  /** Display name shown in the Connections manager + as a tree root. */
  name: string;
  registry: string;
  scope: string;
  org: string;
  githubApi: string;
  tokenSource: TokenSource;
  /** The env-var name holding the token when `tokenSource === Env`. */
  tokenEnvVar: string;
}

/** What crosses the bridge to the renderer — a connection plus a `hasToken`
 *  flag, but never the token value itself (security §7). */
export interface ConnectionView
{
  id: string;
  name: string;
  registry: string;
  scope: string;
  org: string;
  githubApi: string;
  tokenSource: TokenSource;
  tokenEnvVar: string;
  hasToken: boolean;
  isDefault: boolean;
}

/** The fields a caller supplies to create or edit a connection (no id/token). */
export interface ConnectionInput
{
  name: string;
  registry: string;
  scope: string;
  org: string;
  githubApi: string;
  tokenSource: TokenSource;
  tokenEnvVar: string;
}

/** The result of testing a connection against its registry. */
export interface ConnectionTestResult
{
  ok: boolean;
  /** Package count on success. */
  count?: number;
  /** Error message on failure (e.g. "Bad credentials"). */
  message?: string;
}
