import { resolve } from 'node:path';
import { StaticFileServer } from './static-file-server.js';

export class PreviewServerManager
{
    private readonly servers = new Map<string, { server: StaticFileServer; info: Promise<{ url: string; port: number }> }>();

    public Start(root: string): Promise<{ url: string; port: number }>
    {
        const key = resolve(root);
        const existing = this.servers.get(key);
        if (existing !== undefined)
        {
            return existing.info;
        }
        const server = new StaticFileServer(key);
        const info = server.Start();
        this.servers.set(key, { server, info });
        info.catch(() =>
        {
            if (this.servers.get(key)?.info === info)
            {
                this.servers.delete(key);
            }
        });
        return info;
    }

    public get Count(): number
    {
        return this.servers.size;
    }

    public async Stop(root: string): Promise<void>
    {
        const key = resolve(root);
        const entry = this.servers.get(key);
        if (entry === undefined)
        {
            return;
        }
        this.servers.delete(key);
        await entry.info.catch(() => undefined);
        await entry.server.Stop();
    }

    public async StopAll(): Promise<void>
    {
        const entries = [...this.servers.values()];
        this.servers.clear();
        for (const entry of entries)
        {
            await entry.info.catch(() => undefined);
            await entry.server.Stop();
        }
    }
}
