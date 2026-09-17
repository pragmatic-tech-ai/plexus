/**
 * `RegistryBridge` — the logic behind the `registry:*` / `config:*` IPC channels
 * (design §5 + package-manager). It resolves the app's registry config from its
 * settings + effective token, then delegates every package operation to a
 * `PackageManager` built via the injected `createManager` factory. App-side
 * concerns (config, token source, env-var tokens) stay here. Package-manager
 * symbols are type-only imports, so the test runner needs no bundler alias;
 * only `main/index.ts` runtime-imports package-manager to supply createManager.
 */
import type { PackageRegistryManager } from "./package-registry-manager.js";
import type { ConnectionView, ConnectionInput, ConnectionTestResult } from "./registry-connection.js";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import type {
  NpmRegistryConfig,
  PackageRef,
  VersionList,
  InstalledPackage,
  ResolvedClosure,
  PackageSource,
  PackageContents,
  CompileResult,
  LocalPackageStore,
} from "@pragmatic-tech-ai/todl/package-manager";
import type { ResolvedPackage, PackageRef as DomainPackageRef } from "@pragmatic-tech-ai/todl/domain";

/** The subset of `PackageManager` the bridge uses (structurally satisfied by it). */
export interface PackageManagerLike {
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

/** The subset of `PackageCompiler` the bridge uses (structurally satisfied by it).
 *  Compiling a directory is a Compiler concern — kept separate from the
 *  PackageManager, which only handles registry / compiled / published packages. */
export interface PackageCompilerLike {
  compile(directory: string, options?: { scope?: string; outDir?: string }): Promise<CompileResult>;
}

/** A directory compile result, serialized for the renderer. The compiled output
 *  is written to `outDir`; on success that directory is what `publishDir` takes. */
export interface CompileResultView {
  ok: boolean;
  outDir: string;
  files: string[];
  diagnostics: { severity: string; message: string }[];
  /** The TODL package id (the LocalPackageStore / Domain `model` key). */
  id?: string;
  name?: string;
  version?: string;
  sourceCount?: number;
}

export interface RegistryBridgeDeps {
  /** The registry connections source of truth: the connection list + default, the
   *  per-connection tokens, and the effective config for any connection id. */
  manager: PackageRegistryManager;
  /** Build a manager from a resolved config (prod: (c) => new PackageManager(c)). */
  createManager(config: NpmRegistryConfig): PackageManagerLike;
  /** Build the directory compiler (prod: () => new PackageCompiler()). */
  createCompiler(): PackageCompilerLike;
  /** The shared local compiled-package store — compileDir registers into it and
   *  resolvePackage reads from it (local-first). Owned by main/index.ts. */
  localStore: LocalPackageStore;
}

export class RegistryBridge {
  constructor(private readonly deps: RegistryBridgeDeps) {}

  /** Package names in a connection's registry (defaults to the default connection
   *  when `connectionId` is omitted — the Package Manager passes each connection's
   *  id to build its tree root). */
  list(connectionId?: string): Promise<string[]> {
    return this.managerFor(connectionId).list();
  }

  versions(name: string): Promise<VersionList> {
    return this.managerFor().versions(name);
  }

  getContent(ref: PackageRef): Promise<Uint8Array> {
    return this.managerFor().getContent(ref);
  }

  getPackage(ref: PackageRef): Promise<InstalledPackage> {
    return this.managerFor().getPackage(ref);
  }

  resolveClosure(rootDeps: readonly string[]): Promise<ResolvedClosure> {
    return this.managerFor().resolveClosure(rootDeps);
  }

  getMeta(name: string): Promise<string> {
    return this.managerFor().manifestKind(name);
  }

  publishDir(dir: string): Promise<void> {
    return this.managerFor().publish(dir);
  }

  /** Delete a published version from the registry (reaction to a 409 conflict). */
  deleteVersion(name: string, version: string): Promise<void> {
    return this.managerFor().deleteVersion(name, version);
  }

  /** Bump the opened project's version to the next unused patch and persist it to
   *  `project.plexus`, returning the new version. The caller then recompiles +
   *  republishes. The publishable version lives in `modelVersion` (a meta-model)
   *  or `libVersion` (a library); `project.plexus` is plain JSON. */
  async bumpVersion(dir: string): Promise<string> {
    const manifestPath = join(dir, "project.plexus");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as
      { type?: string; id?: string; modelVersion?: string; libVersion?: string };
    const field = manifest.type === "meta-model" ? "modelVersion" : "libVersion";
    const current = manifest[field] ?? "0.0.0";
    const scope = this.deps.manager.effectiveConfig().scope;
    const name = `${scope}/${manifest.id ?? ""}`;
    const published = await this.managerFor().versions(name).then((v) => v.versions).catch(() => [] as string[]);
    const next = RegistryBridge.nextUnusedPatch(current, published);
    manifest[field] = next;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return next;
  }

  /** The next unused patch: patch+1 above the highest of `current` ∪ `published`,
   *  skipping any already taken. Non-`major.minor.patch` inputs are ignored. */
  private static nextUnusedPatch(current: string, published: readonly string[]): string {
    const parse = (v: string): [number, number, number] | undefined => {
      const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
      return m === null ? undefined : [Number(m[1]), Number(m[2]), Number(m[3])];
    };
    const cmp = (a: readonly number[], b: readonly number[]): number => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
    let best: [number, number, number] = parse(current) ?? [0, 0, 0];
    for (const v of published) {
      const p = parse(v);
      if (p !== undefined && cmp(p, best) > 0) best = p;
    }
    const taken = new Set(published);
    let candidate: [number, number, number] = [best[0], best[1], best[2] + 1];
    while (taken.has(candidate.join("."))) candidate = [candidate[0], candidate[1], candidate[2] + 1];
    return candidate.join(".");
  }

  /** Compile a project directory into a package under `<dir>/dist`, returning a
   *  serializable view (identity, files written, diagnostics). On success the
   *  `outDir` is what `publishDir` publishes. Compilation throws for a non-
   *  compilable manifest (e.g. an architecture) or an unresolvable dependency;
   *  a failing compile (source errors) returns `ok: false` with diagnostics. */
  async compileDir(dir: string): Promise<CompileResultView> {
    const outDir = join(dir, "dist");
    const result = await this.deps.createCompiler().compile(dir, { outDir });
    const pkg = result.package;
    // Register the freshly-compiled package so the solution's Domain can resolve
    // it locally (before any publish).
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

  /** Resolve a Domain ref to manifest bytes + deps + seed (local store first,
   *  network fallback). Backs the renderer's IpcPackageSource for solution
   *  composition. */
  /** Resolve a package against a connection (defaults to the default connection).
   *  A solution passes its assigned connection so Compose resolves members + deps
   *  from that registry. */
  resolvePackage(ref: DomainPackageRef, connectionId?: string): Promise<ResolvedPackage> {
    return this.managerFor(connectionId).resolveResolved(ref);
  }

  /** Versions for a package id (local store unioned with a connection's registry). */
  packageVersions(model: string, connectionId?: string): Promise<string[]> {
    return this.managerFor(connectionId).resolvedVersions(model);
  }

  getSources(ref: PackageRef): Promise<PackageSource[]> {
    return this.managerFor().getSources(ref);
  }

  /** Everything a package's tarball carries (sources, manifest, meta, compiled +
   *  raw model, deps, versions) from one fetch — backs the content tree. The
   *  Package Manager passes the owning connection's id (defaults to the default
   *  connection). */
  getPackageContents(name: string, connectionId?: string): Promise<PackageContents> {
    return this.managerFor(connectionId).getContents({ name });
  }

  // --- Connections management (config:* superseded) ---------------------------

  listConnections(): ConnectionView[] {
    return this.deps.manager.listViews();
  }

  addConnection(input: ConnectionInput): ConnectionView {
    return this.deps.manager.add(input);
  }

  updateConnection(id: string, partial: Partial<ConnectionInput>): ConnectionView | undefined {
    return this.deps.manager.update(id, partial);
  }

  removeConnection(id: string): void {
    this.deps.manager.remove(id);
  }

  setConnectionToken(id: string, token: string): void {
    this.deps.manager.setToken(id, token);
  }

  useConnectionEnvToken(id: string, varName: string): void {
    this.deps.manager.useEnvToken(id, varName);
  }

  setDefaultConnection(id: string): void {
    this.deps.manager.setDefault(id);
  }

  listEnvVars(): string[] {
    return this.deps.manager.listEnvVars();
  }

  /** Test a connection by listing its registry — surfaces the auth outcome (a 401
   *  "Bad credentials", a package count on success) to the Connections manager. */
  async testConnection(id: string): Promise<ConnectionTestResult> {
    try {
      const names = await this.managerFor(id).list();
      return { ok: true, count: names.length };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  /** Build a PackageManager bound to a connection's effective config (its
   *  non-secret fields + resolved token). `connectionId` omitted ⇒ the default. */
  private managerFor(connectionId?: string): PackageManagerLike {
    return this.deps.createManager(this.deps.manager.effectiveConfig(connectionId));
  }
}
