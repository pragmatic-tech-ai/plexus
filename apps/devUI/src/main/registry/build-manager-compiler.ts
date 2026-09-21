import { mkdtemp } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFsStorage } from "@pragmatic-tech-ai/todl-runtime/node";
import type { IStorage } from "@pragmatic-tech-ai/todl-runtime";
import {
  type IBuildStorageProvider,
  type OpenedOutput,
  type BuildOptions,
} from "@pragmatic-tech-ai/todl/build-system-core";
import {
  TodlBuildSystemRegistry,
  TodlProjectBuildManager,
  NpmArtifacts,
  type IPackageSource,
} from "@pragmatic-tech-ai/todl/todl-build-system";
import { parseManifest } from "@pragmatic-tech-ai/todl/package-manager";
import type { DirectoryCompileResult, PackageCompilerLike } from "./registry-bridge.js";

// The devUI directory compiler on the build-services pipeline (retiring PackageCompiler).
// It runs todl's npm-package build system for one project directory through the
// TodlProjectBuildManager facade — a fresh temp sandbox, promote into <dir>/dist — and
// hands back the compiled package from the build's artifact bag, so the bridge registers
// it into the local store and shows its identity, exactly the shape compileDir consumed
// before. Base resolution reads through the injected source (prod: a
// NodeModulesPackageSource over <dir>/node_modules).
export class BuildManagerCompiler implements PackageCompilerLike
{
  private static readonly ManifestFileName = "project.plexus";
  private static readonly BuildSystemId = "npm-package";
  private static readonly DistDirName = "dist";

  private readonly registry: TodlBuildSystemRegistry;

  constructor(private readonly source: IPackageSource)
  {
    this.registry = new TodlBuildSystemRegistry();
  }

  async compile(directory: string, options: { scope?: string; outDir?: string } = {}): Promise<DirectoryCompileResult>
  {
    const outDir = options.outDir ?? join(directory, BuildManagerCompiler.DistDirName);
    const manifest = parseManifest(readFileSync(join(directory, BuildManagerCompiler.ManifestFileName), "utf8"));
    const manager = new TodlProjectBuildManager(this.registry, new DirectoryBuildStorage(outDir));

    const { Result: result, Artifacts: artifacts } = await manager.Build({
      Project: new NodeFsStorage(directory),
      Manifest: manifest,
      BuildSystemId: BuildManagerCompiler.BuildSystemId,
      Source: this.source,
    });

    const pkg = artifacts.Get(NpmArtifacts.CompiledModel);
    return {
      ok: result.Ok,
      diagnostics: result.Diagnostics.map((d) => ({ severity: d.severity, message: d.message })),
      files: result.Artifacts,
      ...(pkg !== undefined ? { package: pkg } : {}),
    };
  }
}

// Sandboxes each build in a fresh OS temp directory and promotes into the fixed
// <dir>/dist output. A directory build has a single project, so OutputName / options do
// not route the output here.
class DirectoryBuildStorage implements IBuildStorageProvider
{
  private static readonly SandboxPrefix = "plexus-build-";

  constructor(private readonly outDir: string)
  {
  }

  async CreateSandbox(): Promise<IStorage>
  {
    const dir = await mkdtemp(join(tmpdir(), DirectoryBuildStorage.SandboxPrefix));
    return new NodeFsStorage(dir);
  }

  async DeleteSandbox(sandbox: IStorage): Promise<void>
  {
    await sandbox.Delete("");
  }

  async OpenOutput(_outputName: string, _options: BuildOptions): Promise<OpenedOutput>
  {
    const storage = new NodeFsStorage(this.outDir);
    await storage.CreateDirectory("");
    return { Storage: storage, Path: this.outDir };
  }
}
