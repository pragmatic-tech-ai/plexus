import { EnvSolutionListerKey, type IEnvSolutionLister } from '@pragmatic-tech-ai/plexus-core/renderer/modules/env-solutions'
import { RelayWire, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { IEnvSolutionsBridge } from '../../../../shared/env-solutions-api.js'

// The renderer-side solution lister: the concrete IEnvSolutionLister resolved through
// EnvSolutionListerKey. A thin wrapper over the preload bridge (window.api.envSolutions) that unwraps
// the RelayReply, so a failure rejects with its sentence. The relay stays in main.
export class IpcEnvSolutionLister implements IEnvSolutionLister
{
    public static readonly Key = EnvSolutionListerKey

    private static readonly BridgeUnavailable =
        'IpcEnvSolutionLister: window.api.envSolutions is unavailable — the Electron preload '
        + 'bridge did not load. This service requires a desktop host.'

    private readonly api: IEnvSolutionsBridge

    constructor()
    {
        const bridge = (globalThis as unknown as { api?: { envSolutions?: IEnvSolutionsBridge } }).api
        if (bridge?.envSolutions === undefined)
        {
            throw new Error(IpcEnvSolutionLister.BridgeUnavailable)
        }
        this.api = bridge.envSolutions
    }

    public async ListSolutions(target: TargetRef): Promise<string[]>
    {
        return RelayWire.Unwrap(await this.api.ListSolutions(IpcEnvSolutionLister.Wire(target)))
    }

    // Only Name and Source cross the bridge, whatever else the caller's object carries.
    private static Wire(target: TargetRef): TargetRef
    {
        return { Name: target.Name, Source: target.Source }
    }
}

export default IpcEnvSolutionLister
