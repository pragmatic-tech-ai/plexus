import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { CypherQueryPageDto, PageParams } from '@pragmatic-tech-ai/pragmatic-protocol'
import { RelayWire, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { EnvironmentContents, EnvironmentCypherParams, IEnvironmentsApi, IEnvironmentsBridge } from '../../../../shared/environment-contents-api.js'

export const EnvironmentsApiKey = new ServiceKey<IEnvironmentsApi>('EnvironmentsApi')

// The renderer-side environment contents source: a thin wrapper over the preload bridge
// (window.api.environments) that unwraps each RelayReply, so a failure rejects with its sentence.
// The relay connection and the session stay in main; no token or URL reaches the renderer.
export class EnvironmentsContentsSource implements IEnvironmentsApi
{
    public static readonly Key = EnvironmentsApiKey

    private static readonly BridgeUnavailable =
        'EnvironmentsContentsSource: window.api.environments is unavailable — the Electron preload '
        + 'bridge did not load. This service requires a desktop host.'

    private readonly api: IEnvironmentsBridge

    constructor()
    {
        const bridge = (globalThis as unknown as { api?: { environments?: IEnvironmentsBridge } }).api
        if (bridge?.environments === undefined)
        {
            throw new Error(EnvironmentsContentsSource.BridgeUnavailable)
        }
        this.api = bridge.environments
    }

    public async Contents(target: TargetRef): Promise<EnvironmentContents>
    {
        // Only Name and Source cross the bridge, whatever else the caller's object carries.
        return RelayWire.Unwrap(await this.api.Contents({ Name: target.Name, Source: target.Source }))
    }

    public async Cypher(target: TargetRef, cypher: string, params?: EnvironmentCypherParams, page?: PageParams): Promise<CypherQueryPageDto>
    {
        return RelayWire.Unwrap(await this.api.Cypher({ Name: target.Name, Source: target.Source }, cypher, params, page))
    }
}

export default EnvironmentsContentsSource
