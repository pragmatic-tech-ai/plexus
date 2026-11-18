import type { TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { UploadContribution, UploadEntry } from '@pragmatic-tech-ai/plexus-core/shared/upload-api.js'
import { DevelopSession } from '../account/develop-session.js'
import { RelayAction, RelayConnector, type IRelayConnector, type RelayClient } from '../account/relay-connector.js'

export type { UploadContribution, UploadEntry }

// Main-process upload: drives a develop session to a dev environment. Order is fixed: create the named
// solution, write every enumerated entry through the session's serialized storage methods, then
// contribute. The tree arrives already enumerated; nothing is read from local disk here. Any failing
// step rejects the upload and later steps do not run.
export class UploadService
{
    private static readonly BytesEncoding = 'base64'
    private static readonly BothContent = 'Upload entry has both text and bytes: '
    private static readonly NoContent = 'Upload entry has neither text nor bytes: '

    public constructor(private readonly relay: IRelayConnector)
    {
    }

    public async Upload(target: TargetRef, solutionName: string, tree: readonly UploadEntry[], contribution?: UploadContribution): Promise<void>
    {
        for (const entry of tree) UploadService.Validate(entry)
        const client = await this.relay.Connect(target, RelayAction.Develop)
        try
        {
            await RelayConnector.Call({ Environment: target.Name, Client: client }, () => UploadService.Drive(client, solutionName, tree, contribution))
        }
        finally
        {
            await UploadService.Close(client)
        }
    }

    private static async Drive(client: RelayClient, solutionName: string, tree: readonly UploadEntry[], contribution?: UploadContribution): Promise<void>
    {
        const session = new DevelopSession(client)
        await client.CreateSolution({ Name: solutionName })
        for (const entry of tree) await UploadService.Write(session, entry)
        if (contribution !== undefined)
        {
            await client.ContributeGraph({ graphName: contribution.GraphName, solutionId: contribution.SolutionId, packages: [...contribution.Packages] })
        }
    }

    // Exactly one of Text / BytesBase64 must be set; checked before any connection or write.
    private static Validate(entry: UploadEntry): void
    {
        if (entry.Text !== undefined && entry.BytesBase64 !== undefined) throw new Error(UploadService.BothContent + entry.Path)
        if (entry.Text === undefined && entry.BytesBase64 === undefined) throw new Error(UploadService.NoContent + entry.Path)
    }

    private static async Write(session: DevelopSession, entry: UploadEntry): Promise<void>
    {
        if (entry.Text !== undefined) await session.WriteText(entry.Path, entry.Text)
        else await session.WriteBytes(entry.Path, new Uint8Array(Buffer.from(entry.BytesBase64 as string, UploadService.BytesEncoding)))
    }

    // A failing close must not hide the upload's own outcome.
    private static async Close(client: RelayClient): Promise<void>
    {
        try
        {
            await client.DisposeAsync()
        }
        catch
        {
            // the connection is gone either way
        }
    }
}
