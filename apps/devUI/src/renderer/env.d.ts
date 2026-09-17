import type {
  PackageRef,
  VersionList,
  InstalledPackage,
  ResolvedClosure,
  PackageContents,
} from "@pragmatic-tech-ai/todl/package-manager";
import type { PackageSource, CompileResultView } from "../main/registry/registry-bridge.js";
import type { ConnectionView, ConnectionInput, ConnectionTestResult } from "../main/registry/registry-connection.js";
import type { DirEntry } from "../main/registry/register-ipc.js";
import type { ResolvedPackage, PackageRef as DomainPackageRef } from "@pragmatic-tech-ai/todl/domain";

export interface TodlBridge {
  registry: {
    list(connectionId?: string): Promise<string[]>;
    versions(name: string): Promise<VersionList>;
    getContent(ref: PackageRef): Promise<Uint8Array>;
    getPackage(ref: PackageRef): Promise<InstalledPackage>;
    getMeta(name: string): Promise<string>;
    resolveClosure(rootDeps: string[]): Promise<ResolvedClosure>;
    publishDir(dir: string): Promise<void>;
    compileDir(dir: string): Promise<CompileResultView>;
    resolvePackage(ref: DomainPackageRef, connectionId?: string): Promise<ResolvedPackage>;
    packageVersions(model: string, connectionId?: string): Promise<string[]>;
    getSources(ref: PackageRef): Promise<PackageSource[]>;
    getPackageContents(name: string, connectionId?: string): Promise<PackageContents>;
    deleteVersion(name: string, version: string): Promise<void>;
    bumpVersion(dir: string): Promise<string>;
  };
  connections: {
    list(): Promise<ConnectionView[]>;
    add(input: ConnectionInput): Promise<ConnectionView>;
    update(id: string, partial: Partial<ConnectionInput>): Promise<ConnectionView | undefined>;
    remove(id: string): Promise<void>;
    setToken(id: string, token: string): Promise<void>;
    useEnvToken(id: string, name: string): Promise<void>;
    setDefault(id: string): Promise<void>;
    test(id: string): Promise<ConnectionTestResult>;
    listEnvVars(): Promise<string[]>;
  };
  dialog: {
    pickDirectory(): Promise<string>;
  };
  // Registry directory-browse only. General file IO lives on the shared
  // window.api.fs (plexus-core's IFileSystemApi), not here.
  fs: {
    readDir(path: string): Promise<DirEntry[]>;
  };
}

declare global {
  interface Window {
    todl: TodlBridge;
    // Shared window.api surface (file IO + window chrome). The shared
    // FileSystemService reads window.api.fs off it.
    api?: {
      fs: import("@pragmatic-tech-ai/plexus-core/shared/file-system-api.js").IFileSystemApi;
    };
  }
}
