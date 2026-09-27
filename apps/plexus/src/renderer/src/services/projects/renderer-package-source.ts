import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { StoragePackageSource } from '@pragmatic-tech-ai/todl'
import type { PackageRef, PackageSource, ResolvedPackage } from '@pragmatic-tech-ai/todl/domain'

import { ensurePackagesBackend } from './packages-backend.js'

// The Domain package backend for the renderer's ambient solution wiring
// (SolutionManagerService.PackageSourceKey): a StoragePackageSource — todl's own
// PackageSource impl over a raw IStorage — rooted at the SAME published-packages
// backend PlexusPackageStore reads (<userData>/packages, via ensurePackagesBackend).
// The ambient OpenProject/CloseProject flow never calls SolutionManagerService.Compose,
// so this minimal published-package-backed resolver is enough; a solution's cross-
// project base composition is a later wave's concern.
export class RendererPackageSource implements PackageSource
{
    private cached: StoragePackageSource | undefined

    constructor(private readonly provider: IServiceProvider) {}

    public resolve(ref: PackageRef): Promise<ResolvedPackage>
    {
        return this.inner().resolve(ref)
    }

    public versions(model: string): Promise<readonly string[]>
    {
        return this.inner().versions(model)
    }

    // Built lazily (ensurePackagesBackend needs the storage/env/fs services wired)
    // and reused across calls — mirrors PlexusPackageStore's lazy-cached inner.
    private inner(): StoragePackageSource
    {
        if (this.cached === undefined) this.cached = new StoragePackageSource(ensurePackagesBackend(this.provider))
        return this.cached
    }
}

export default RendererPackageSource
