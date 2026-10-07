import { test, expect } from 'vitest';
import { StaticFileServer } from '../static-file-server.js';
import { PreviewServerManager } from '../preview-server-manager.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

class Fixture
{
    private static readonly Prefix = 'preview-';
    private static readonly IndexName = 'index.html';
    private static readonly IndexBody = '<h1>hello</h1>';

    public static async Create(): Promise<string>
    {
        const dir = await mkdtemp(join(tmpdir(), Fixture.Prefix));
        await writeFile(join(dir, Fixture.IndexName), Fixture.IndexBody);
        return dir;
    }
}

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

test('denies path traversal outside the root', async () =>
{
    const server = new StaticFileServer(await Fixture.Create());
    try
    {
        const { url } = await server.Start();
        const res = await fetch(url + '/../../etc/passwd');
        expect([403, 404]).toContain(res.status);
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
