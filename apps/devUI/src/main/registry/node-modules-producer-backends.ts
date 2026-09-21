import { readInstalledPackages } from "@pragmatic-tech-ai/todl/package-manager";
import { PackageKind, type IProducerStorageBackends } from "@pragmatic-tech-ai/todl";
import type { IStorage, StorageEntry } from "@pragmatic-tech-ai/todl-runtime";

// A producer-backends adapter over a project's `node_modules`: it serves each
// installed TODL package's compiled `model.json` at `<id>/<version>/model.json`,
// the layout `RecursiveProjectReferencesResolver` reads. devUI resolves a project's
// bases from its installed dependencies (there is no meta-models/libraries storage
// root here), so this bridges the recursive resolver's storage seam onto npm. npm
// installs a single version per package, so the version segment is matched by id.
export class NodeModulesProducerBackends implements IProducerStorageBackends
{
    private readonly storage: IStorage;

    constructor(nodeModulesDir: string)
    {
        const byId = new Map<string, string>();
        for (const pkg of readInstalledPackages(nodeModulesDir))
        {
            byId.set(pkg.meta.id, JSON.stringify(pkg.document));
        }
        this.storage = new InstalledModelStorage(byId);
    }

    // Both producer kinds live in one `node_modules`; package ids are globally
    // unique, so the kind does not route to a separate root here.
    Backend(_kind: PackageKind): IStorage
    {
        return this.storage;
    }
}

// Read-only IStorage over the installed packages, keyed by package id (the first
// path segment of `<id>/<version>/model.json`). Only ReadText/Exists are meaningful
// for base resolution; the mutating members are unreachable there and reject.
class InstalledModelStorage implements IStorage
{
    private static readonly ReadOnlyMessage = "node_modules producer backend is read-only";
    private static readonly NotInstalledPrefix = "not installed: ";
    public readonly Root = "";

    constructor(private readonly byId: ReadonlyMap<string, string>) {}

    async ReadText(path: string): Promise<string>
    {
        const id = path.split("/")[0] ?? "";
        const doc = this.byId.get(id);
        if (doc === undefined) throw new Error(InstalledModelStorage.NotInstalledPrefix + id);
        return doc;
    }

    async Exists(path: string): Promise<boolean>
    {
        return this.byId.has(path.split("/")[0] ?? "");
    }

    async List(): Promise<readonly StorageEntry[]>
    {
        return [];
    }

    ReadBytes(): Promise<Uint8Array> { return Promise.reject(new Error(InstalledModelStorage.ReadOnlyMessage)); }
    WriteText(): Promise<void> { return Promise.reject(new Error(InstalledModelStorage.ReadOnlyMessage)); }
    WriteBytes(): Promise<void> { return Promise.reject(new Error(InstalledModelStorage.ReadOnlyMessage)); }
    Delete(): Promise<void> { return Promise.reject(new Error(InstalledModelStorage.ReadOnlyMessage)); }
    CreateDirectory(): Promise<void> { return Promise.reject(new Error(InstalledModelStorage.ReadOnlyMessage)); }
    Rename(): Promise<void> { return Promise.reject(new Error(InstalledModelStorage.ReadOnlyMessage)); }
}
