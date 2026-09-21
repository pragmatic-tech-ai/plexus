import { readInstalledPackages } from "@pragmatic-tech-ai/todl/package-manager";
import type { IPackageSource, PackageRef, SourcedPackage } from "@pragmatic-tech-ai/todl";

// A package source over a project's `node_modules`: it serves each installed TODL
// package's compiled document + recorded dependencies, the shape
// `RecursiveProjectReferencesResolver` reads through `IPackageSource`. devUI resolves
// a project's bases from its installed dependencies (there is no meta-models/libraries
// storage root here), so this bridges the recursive resolver's read seam onto npm.
// npm installs a single version per package, so a ref is matched by id (the version
// segment is ignored).
export class NodeModulesPackageSource implements IPackageSource
{
    private readonly byId: ReadonlyMap<string, SourcedPackage>;

    constructor(nodeModulesDir: string)
    {
        const byId = new Map<string, SourcedPackage>();
        for (const pkg of readInstalledPackages(nodeModulesDir))
        {
            const doc = pkg.document as SourcedPackage["Document"] & { dependencies?: readonly PackageRef[] };
            byId.set(pkg.meta.id, { Document: doc, Dependencies: doc.dependencies ?? [] });
        }
        this.byId = byId;
    }

    // npm holds one version per package, so match by id and ignore the requested
    // version. An id with no installed package resolves to undefined.
    async TryGet(reference: PackageRef): Promise<SourcedPackage | undefined>
    {
        return this.byId.get(reference.id);
    }
}
