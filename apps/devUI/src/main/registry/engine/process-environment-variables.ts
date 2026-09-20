/**
 * `ProcessEnvironmentVariables` — the devUI host implementation of the engine's
 * `IEnvironmentVariables`, over a plain env record (prod: `process.env`). Backs
 * env-sourced connection tokens and the "pick an env var" affordance.
 */
import { type IEnvironmentVariables } from "@pragmatic-tech-ai/todl/package-manager";

export class ProcessEnvironmentVariables implements IEnvironmentVariables
{
  constructor(private readonly env: Record<string, string | undefined>) {}

  public Get(name: string): string | undefined
  {
    return this.env[name];
  }

  public Names(): readonly string[]
  {
    return Object.keys(this.env)
      .filter((k) => this.env[k] !== undefined)
      .sort((a, b) => a.localeCompare(b));
  }
}
