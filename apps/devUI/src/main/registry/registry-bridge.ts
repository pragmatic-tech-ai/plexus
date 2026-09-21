/**
 * `RegistryBridge` — the logic behind the `registry:*` / `connections:*` IPC
 * channels (design §5 + package-registry subsystem). It drives the TODL engine's
 * `PackageManagerService` as the connection authority: connection CRUD delegates to
 * the service, and every package operation builds a per-connection
 * `PackageRegistryClient` via `service.RegistryFor(id)` (local compiled store first).
 * The renderer-facing `ConnectionView`/`ConnectionInput` shape is devUI's flat form;
 * this bridge maps it to/from the engine's `ConnectionSpec`/`ConnectionView` at the
 * boundary.
 */
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import {
  PackageRegistryClient,
  type PackageManagerService,
  type ConnectionView,
  type ConnectionSpec,
  type PackageRef,
  type VersionList,
  type InstalledPackage,
  type ResolvedClosure,
  type PackageSource,
  type PackageContents,
  type LocalPackageStore,
} from "@pragmatic-tech-ai/todl/package-manager";
import type { CompiledPackage } from "@pragmatic-tech-ai/todl";
import type { ResolvedPackage, PackageRef as DomainPackageRef } from "@pragmatic-tech-ai/todl/domain";
import type { ConnectionTestResult } from "./registry-connection.js";

/** The subset of the per-connection client the bridge uses (satisfied by
 *  PackageRegistryClient). */
export interface PackageManagerLike
{
  list(): Promise<string[]>;
  versions(name: string): Promise<VersionList>;
  manifestKind(name: string): Promise<string>;
  getContent(ref: PackageRef): Promise<Uint8Array>;
  getPackage(ref: PackageRef): Promise<InstalledPackage>;
  getSources(ref: PackageRef): Promise<PackageSource[]>;
  getContents(ref: PackageRef): Promise<PackageContents>;
  resolveClosure(rootDeps: readonly string[]): Promise<ResolvedClosure>;
  publish(compiledDir: string): Promise<void>;
  deleteVersion(name: string, version: string): Promise<void>;
  resolveResolved(ref: DomainPackageRef): Promise<ResolvedPackage>;
  resolvedVersions(id: string): Promise<string[]>;
}

/** A directory compile/build result — the subset `compileDir` consumes. The
 *  build-services pipeline (BuildManagerCompiler) produces this; diagnostics are the
 *  build's own `{ severity, message }` shape, and `package` is the compiled artifact the
 *  bridge registers into the local store. */
export interface DirectoryCompileResult
{
  ok: boolean;
  diagnostics: readonly { severity: unknown; message: string }[];
  files?: readonly string[];
  package?: CompiledPackage;
}

/** The directory compiler the bridge drives — building a project directory into a
 *  package is a build concern, kept separate from the registry client. */
export interface PackageCompilerLike
{
  compile(directory: string, options?: { scope?: string; outDir?: string }): Promise<DirectoryCompileResult>;
}

/** A directory compile result, serialized for the renderer. */
export interface CompileResultView
{
  ok: boolean;
  outDir: string;
  files: string[];
  diagnostics: { severity: string; message: string }[];
  id?: string;
  name?: string;
  version?: string;
  sourceCount?: number;
}

export interface RegistryBridgeDeps
{
  /** The engine connection authority: connection CRUD + per-connection clients. */
  service: PackageManagerService;
  /** Build the directory compiler for a project directory — the compiler resolves
   *  its bases from that directory's node_modules (prod: a NodeModulesPackageSource). */
  createCompiler(directory: string): PackageCompilerLike;
  /** The shared local compiled-package store — compileDir registers into it and
   *  resolvePackage reads from it (local-first). Owned by main/index.ts. */
  localStore: LocalPackageStore;
}

// The npm scope Settings key (used to name the publish target in bumpVersion).
const SCOPE_KEY = "scope";

export class RegistryBridge
{
  constructor(private readonly deps: RegistryBridgeDeps) {}

  list(connectionId?: string): Promise<string[]>
  {
    return this.managerFor(connectionId).then((m) => m.list());
  }

  versions(name: string): Promise<VersionList>
  {
    return this.managerFor().then((m) => m.versions(name));
  }

  getContent(ref: PackageRef): Promise<Uint8Array>
  {
    return this.managerFor().then((m) => m.getContent(ref));
  }

  getPackage(ref: PackageRef): Promise<InstalledPackage>
  {
    return this.managerFor().then((m) => m.getPackage(ref));
  }

  resolveClosure(rootDeps: readonly string[]): Promise<ResolvedClosure>
  {
    return this.managerFor().then((m) => m.resolveClosure(rootDeps));
  }

  getMeta(name: string): Promise<string>
  {
    return this.managerFor().then((m) => m.manifestKind(name));
  }

  publishDir(dir: string): Promise<void>
  {
    return this.managerFor().then((m) => m.publish(dir));
  }

  deleteVersion(name: string, version: string, connectionId?: string): Promise<void>
  {
    return this.managerFor(connectionId).then((m) => m.deleteVersion(name, version));
  }

  async deleteAllVersions(name: string, connectionId?: string): Promise<void>
  {
    const mgr = await this.managerFor(connectionId);
    const { versions } = await mgr.versions(name);
    for (const version of versions) await mgr.deleteVersion(name, version);
  }

  /** Bump the opened project's version to the next unused patch and persist it to
   *  `project.plexus`, returning the new version. */
  async bumpVersion(dir: string): Promise<string>
  {
    const manifestPath = join(dir, "project.plexus");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as
      { type?: string; id?: string; packageVersion?: string };
    const current = manifest.packageVersion ?? "0.0.0";
    const scope = await this.defaultScope();
    const name = `${scope}/${manifest.id ?? ""}`;
    const published = await this.managerFor().then((m) => m.versions(name)).then((v) => v.versions).catch(() => [] as string[]);
    const next = RegistryBridge.nextUnusedPatch(current, published);
    manifest.packageVersion = next;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return next;
  }

  /** The next unused patch above the highest of `current` ∪ `published`. */
  private static nextUnusedPatch(current: string, published: readonly string[]): string
  {
    const parse = (v: string): [number, number, number] | undefined => {
      const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
      return m === null ? undefined : [Number(m[1]), Number(m[2]), Number(m[3])];
    };
    const cmp = (a: readonly number[], b: readonly number[]): number => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
    let best: [number, number, number] = parse(current) ?? [0, 0, 0];
    for (const v of published)
    {
      const p = parse(v);
      if (p !== undefined && cmp(p, best) > 0) best = p;
    }
    const taken = new Set(published);
    let candidate: [number, number, number] = [best[0], best[1], best[2] + 1];
    while (taken.has(candidate.join("."))) candidate = [candidate[0], candidate[1], candidate[2] + 1];
    return candidate.join(".");
  }

  /** Compile a project directory into a package under `<dir>/dist`. */
  async compileDir(dir: string): Promise<CompileResultView>
  {
    const outDir = join(dir, "dist");
    const result = await this.deps.createCompiler(dir).compile(dir, { outDir });
    const pkg = result.package;
    if (result.ok && pkg !== undefined) this.deps.localStore.register(pkg);
    return {
      ok: result.ok,
      outDir,
      files: result.files !== undefined ? [...result.files] : [],
      diagnostics: result.diagnostics.map((d) => ({ severity: String(d.severity), message: d.message })),
      id: pkg?.id,
      name: pkg !== undefined ? (pkg.name ?? pkg.id) : undefined,
      version: pkg?.version,
      sourceCount: pkg?.sources.length,
    };
  }

  /** Resolve a package against a connection (defaults to the default connection). */
  resolvePackage(ref: DomainPackageRef, connectionId?: string): Promise<ResolvedPackage>
  {
    return this.managerFor(connectionId).then((m) => m.resolveResolved(ref));
  }

  /** Versions for a package id (local store unioned with a connection's registry). */
  packageVersions(model: string, connectionId?: string): Promise<string[]>
  {
    return this.managerFor(connectionId).then((m) => m.resolvedVersions(model));
  }

  getSources(ref: PackageRef): Promise<PackageSource[]>
  {
    return this.managerFor().then((m) => m.getSources(ref));
  }

  getPackageContents(name: string, connectionId?: string): Promise<PackageContents>
  {
    return this.managerFor(connectionId).then((m) => m.getContents({ name }));
  }

  // --- Connections management --------------------------------------------------

  listConnections(): Promise<ConnectionView[]>
  {
    return this.deps.service.ListViews();
  }

  // Add a connection; the engine requires an id, so mint one from the display name
  // (the renderer sends a spec without a meaningful id).
  async addConnection(spec: ConnectionSpec): Promise<ConnectionView>
  {
    const taken = new Set((await this.deps.service.ListViews()).map((v) => v.Id));
    const id = RegistryBridge.mintId(spec.DisplayName, taken);
    await this.deps.service.AddConnection({ ...spec, Id: id });
    return this.viewOf(id);
  }

  async updateConnection(id: string, partial: Partial<ConnectionSpec>): Promise<ConnectionView | undefined>
  {
    if ((await this.deps.service.ListViews()).find((v) => v.Id === id) === undefined) return undefined;
    await this.deps.service.UpdateConnection(id, partial);
    return this.viewOf(id);
  }

  removeConnection(id: string): Promise<void>
  {
    return this.deps.service.RemoveConnection(id);
  }

  setConnectionToken(id: string, token: string): Promise<void>
  {
    return this.deps.service.SetToken(id, token);
  }

  useConnectionEnvToken(id: string, varName: string): Promise<void>
  {
    return this.deps.service.UseEnvToken(id, varName);
  }

  setDefaultConnection(id: string): Promise<void>
  {
    return this.deps.service.SetDefault(id);
  }

  listEnvVars(): Promise<string[]>
  {
    return Promise.resolve(this.deps.service.ListEnvVars());
  }

  /** Test a connection by listing its registry — surfaces the auth outcome. */
  async testConnection(id: string): Promise<ConnectionTestResult>
  {
    try
    {
      const names = await this.managerFor(id).then((m) => m.list());
      return { ok: true, count: names.length };
    }
    catch (e)
    {
      return { ok: false, message: (e as Error).message };
    }
  }

  /** Build a per-connection client from the engine (default connection when id is
   *  omitted), backed by the shared local compiled-package store. */
  private async managerFor(connectionId?: string): Promise<PackageManagerLike>
  {
    const registry = await this.deps.service.RegistryFor(connectionId);
    return new PackageRegistryClient(registry, this.deps.localStore);
  }

  private async viewOf(id: string): Promise<ConnectionView>
  {
    const view = (await this.deps.service.ListViews()).find((v) => v.Id === id);
    if (view === undefined) throw new Error(`connection "${id}" not found after write`);
    return view;
  }

  private async defaultScope(): Promise<string>
  {
    const views = await this.deps.service.ListViews();
    const target = views.find((v) => v.IsDefault) ?? views[0];
    return target?.Settings[SCOPE_KEY] ?? "";
  }

  /** A URL-safe slug of `name`, de-duplicated against existing ids. */
  private static mintId(name: string, taken: ReadonlySet<string>): string
  {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "connection";
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n += 1;
    return `${base}-${n}`;
  }
}
