import { test, expect, afterEach } from 'vitest';
import { StaticFileServer } from '../static-file-server.js';
import { PreviewServerManager } from '../preview-server-manager.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

class Fixture
{
    private static readonly Prefix = 'preview-';
    private static readonly IndexName = 'index.html';
    private static readonly IndexBody = '<h1>hello</h1>';
    private static readonly SiteDir = 'site';
    private static readonly SiblingDir = 'site-secret';
    private static readonly SecretName = 'secret.txt';
    public static readonly SecretBody = 'TOP-SECRET-CONTENT';
    private static readonly created: string[] = [];

    public static async Create(): Promise<string>
    {
        const dir = await mkdtemp(join(tmpdir(), Fixture.Prefix));
        Fixture.created.push(dir);
        await writeFile(join(dir, Fixture.IndexName), Fixture.IndexBody);
        return dir;
    }

    /** Root at <tmp>/site; secrets at <tmp>/secret.txt and <tmp>/site-secret/secret.txt. */
    public static async CreateWithSecrets(): Promise<string>
    {
        const base = await mkdtemp(join(tmpdir(), Fixture.Prefix));
        Fixture.created.push(base);
        const site = join(base, Fixture.SiteDir);
        await mkdir(site);
        await mkdir(join(base, Fixture.SiblingDir));
        await writeFile(join(site, Fixture.IndexName), Fixture.IndexBody);
        await writeFile(join(base, Fixture.SecretName), Fixture.SecretBody);
        await writeFile(join(base, Fixture.SiblingDir, Fixture.SecretName), Fixture.SecretBody);
        return site;
    }

    public static async Cleanup(): Promise<void>
    {
        const dirs = Fixture.created.splice(0);
        for (const dir of dirs)
        {
            await rm(dir, { recursive: true, force: true });
        }
    }
}

class RawClient
{
    public static Get(port: number, path: string): Promise<{ status: number; body: string }>
    {
        return new Promise((done, fail) =>
        {
            const req = request({ host: '127.0.0.1', port, path, agent: false }, (res) =>
            {
                let body = '';
                res.on('data', (c) => { body += c; });
                res.on('end', () => done({ status: res.statusCode ?? 0, body }));
            });
            req.on('error', fail);
            req.end();
        });
    }
}

afterEach(async () =>
{
    await Fixture.Cleanup();
});

test('serves index.html at / with 200', async () =>
{
    const server = new StaticFileServer(await Fixture.Create());
    try
    {
        const { url } = await server.Start();
        const res = await fetch(url + '/');
        expect(res.status).toBe(200);
        expect(await res.text()).toMatch(/hello/);
    }
    finally
    {
        await server.Stop();
    }
});

test('404 for a missing file', async () =>
{
    const server = new StaticFileServer(await Fixture.Create());
    try
    {
        const { url } = await server.Start();
        expect((await fetch(url + '/nope.js')).status).toBe(404);
    }
    finally
    {
        await server.Stop();
    }
});

test('denies raw path traversal outside the root', async () =>
{
    const server = new StaticFileServer(await Fixture.CreateWithSecrets());
    try
    {
        const { port } = await server.Start();
        for (const path of ['/../secret.txt', '/../../etc/passwd', '/../site-secret/secret.txt', '/..\secret.txt'])
        {
            const res = await RawClient.Get(port, path);
            expect([403, 404]).toContain(res.status);
            expect(res.body).not.toContain(Fixture.SecretBody);
        }
    }
    finally
    {
        await server.Stop();
    }
});

test('denies encoded traversal and sibling-prefix escapes', async () =>
{
    const server = new StaticFileServer(await Fixture.CreateWithSecrets());
    try
    {
        const { url } = await server.Start();
        for (const path of ['/%2e%2e%2fsecret.txt', '/%2e%2e%2f%2e%2e%2fetc%2fpasswd', '/%2e%2e%2fsite-secret%2fsecret.txt'])
        {
            const res = await fetch(url + path);
            expect([403, 404]).toContain(res.status);
            expect(await res.text()).not.toContain(Fixture.SecretBody);
        }
    }
    finally
    {
        await server.Stop();
    }
});

test('second Start on the same server rejects instead of leaking', async () =>
{
    const server = new StaticFileServer(await Fixture.Create());
    try
    {
        await server.Start();
        await expect(server.Start()).rejects.toThrow();
    }
    finally
    {
        await server.Stop();
    }
});

test('falls back to another port when the preferred one is busy', async () =>
{
    const a = new StaticFileServer(await Fixture.Create());
    const b = new StaticFileServer(await Fixture.Create());
    try
    {
        const first = await a.Start(0);
        const second = await b.Start(first.port);
        expect(second.port).not.toBe(first.port);
    }
    finally
    {
        await a.Stop();
        await b.Stop();
    }
});

test('manager reuses one server per root', async () =>
{
    const dir = await Fixture.Create();
    const mgr = new PreviewServerManager();
    try
    {
        const one = await mgr.Start(dir);
        const two = await mgr.Start(dir);
        expect(one.port).toBe(two.port);
    }
    finally
    {
        await mgr.StopAll();
    }
});

test('concurrent manager starts share one server', async () =>
{
    const dir = await Fixture.Create();
    const mgr = new PreviewServerManager();
    try
    {
        const [one, two] = await Promise.all([mgr.Start(dir), mgr.Start(dir + '/')]);
        expect(one.port).toBe(two.port);
        expect(mgr.Count).toBe(1);
    }
    finally
    {
        await mgr.StopAll();
    }
});
