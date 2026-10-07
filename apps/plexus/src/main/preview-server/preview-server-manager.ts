import { StaticFileServer } from './static-file-server.js';

export class PreviewServerManager
{
    private readonly servers = new Map<string, { server: StaticFileServer; info: { url: string; port: number } }>();

    public async Start(root: string): Promise<{ url: string; port: number }>
    {
        const existing = this.servers.get(root);
        if (existing !== undefined)
        {
            return existing.info;
        }
        const server = new StaticFileServer(root);
        const info = await server.Start();
        this.servers.set(root, { server, info });
        return info;
    }

    public async Stop(root: string): Promise<void>
    {
        const entry = this.servers.get(root);
        if (entry === undefined)
        {
            return;
        }
        await entry.server.Stop();
        this.servers.delete(root);
    }

    public async StopAll(): Promise<void>
    {
        for (const entry of this.servers.values())
        {
            await entry.server.Stop();
        }
        this.servers.clear();
    }
}
