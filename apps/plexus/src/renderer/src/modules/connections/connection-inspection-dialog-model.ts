import { Observable, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import type { ConnectionInspection } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/connections-client.js'

// Read-only view-model for the connection-inspection dialog: a token's identity, scopes and
// visible packages, with honest per-section "why is this empty" notes. An empty note means
// the section's list is shown normally.
export class ConnectionInspectionViewModel extends Observable
{
    private static readonly FineGrainedNote = 'Fine-grained token — no classic scopes.'
    private static readonly ScopesNotExposedNote = 'This registry does not expose token scopes.'
    private static readonly IdentityUnreadableNote = 'Could not read the token identity or scopes.'
    private static readonly NoPackagesNote = 'No packages are visible to this token.'
    private static readonly PackagesNotSupportedNote = 'Package listing is not supported for this registry.'

    private readonly inspection: ConnectionInspection
    private readonly close: () => void

    public readonly OkCommand: ICommand

    public constructor(inspection: ConnectionInspection, close: () => void)
    {
        super()
        this.inspection = inspection
        this.close = close
        this.OkCommand = new RelayCommand(() => this.close())
    }

    public get Ok(): boolean
    {
        return this.inspection.ok
    }

    public get Message(): string
    {
        return this.inspection.message
    }

    public get Identity(): string
    {
        return this.inspection.identity
    }

    public get Scopes(): readonly string[]
    {
        return this.inspection.scopes
    }

    public get Packages(): readonly string[]
    {
        return this.inspection.packages
    }

    public get HasIdentity(): boolean
    {
        return this.Identity !== ''
    }

    public get ScopesNote(): string
    {
        if (!this.Ok)
        {
            return ''
        }
        if (!this.inspection.scopesSupported)
        {
            return ConnectionInspectionViewModel.ScopesNotExposedNote
        }
        if (this.Scopes.length > 0)
        {
            return ''
        }
        if (this.HasIdentity)
        {
            return ConnectionInspectionViewModel.FineGrainedNote
        }
        return ConnectionInspectionViewModel.IdentityUnreadableNote
    }

    public get PackagesNote(): string
    {
        if (!this.Ok)
        {
            return ''
        }
        if (!this.inspection.packagesSupported)
        {
            return ConnectionInspectionViewModel.PackagesNotSupportedNote
        }
        if (this.Packages.length > 0)
        {
            return ''
        }
        return ConnectionInspectionViewModel.NoPackagesNote
    }
}
