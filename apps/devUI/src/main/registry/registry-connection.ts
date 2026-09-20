/**
 * devUI-local registry types. The connection shapes — `ConnectionSpec`,
 * `ConnectionView`, `TokenSource` — now come from the TODL package engine
 * (`@pragmatic-tech-ai/todl/package-manager`), which is the connection authority.
 * This file keeps only the devUI-specific IPC result shape and re-exports
 * `TokenSource` for local callers (settings store, VMs).
 */
export { TokenSource } from "@pragmatic-tech-ai/todl/package-manager";

/** The result of testing a connection against its registry. */
export interface ConnectionTestResult
{
  ok: boolean;
  /** Package count on success. */
  count?: number;
  /** Error message on failure (e.g. "Bad credentials"). */
  message?: string;
}
