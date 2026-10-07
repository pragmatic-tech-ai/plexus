import { createServer, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { normalize, join, extname, resolve, sep } from 'node:path';

export class StaticFileServer
{
    private static readonly Host = '127.0.0.1';
    private static readonly IndexFile = 'index.html';
    private static readonly DefaultPort = 4599;
    private static readonly MaxAttempts = 20;
    private static readonly AddrInUse = 'EADDRINUSE';
    private static readonly ErrorEvent = 'error';
    private static readonly ContentTypeHeader = 'Content-Type';
    private static readonly QuerySeparator = '?';
    private static readonly UrlRoot = '/';
    private static readonly LeadingParentSegments = /^(\.\.[\/\\])+/;
    private static readonly ContentTypes: Record<string, string> =
    {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.woff2': 'font/woff2',
    };
    private static readonly Scheme = 'http://';
    private static readonly Empty = '';
    private static readonly StatusOk = 200;
    private static readonly StatusBadRequest = 400;
    private static readonly StatusForbidden = 403;
    private static readonly StatusNotFound = 404;
    private static readonly AlreadyStarted = 'StaticFileServer is already started';
    private static readonly OctetStream = 'application/octet-stream';

    private server: Server | undefined;
    private readonly resolvedRoot: string;

    constructor(private readonly root: string)
    {
        this.resolvedRoot = resolve(root);
    }

    public get Root(): string
    {
        return this.root;
    }

    public Start(preferredPort?: number): Promise<{ url: string; port: number }>
    {
        if (this.server !== undefined)
        {
            return Promise.reject(new Error(StaticFileServer.AlreadyStarted));
        }
        this.server = createServer((req, res) => void this.handle(req.url ?? StaticFileServer.UrlRoot, res));
        const first = preferredPort ?? StaticFileServer.DefaultPort;
        return this.listen(first === 0 ? StaticFileServer.DefaultPort : first, StaticFileServer.MaxAttempts).catch((e: unknown) =>
        {
            this.server = undefined;
            throw e;
        });
    }

    public Stop(): Promise<void>
    {
        return new Promise((done) =>
        {
            if (this.server === undefined)
            {
                done();
                return;
            }
            this.server.close(() => done());
            this.server.closeAllConnections();
            this.server = undefined;
        });
    }

    private listen(port: number, attemptsLeft: number): Promise<{ url: string; port: number }>
    {
        return new Promise((done, fail) =>
        {
            const server = this.server!;
            const onError = (e: NodeJS.ErrnoException): void =>
            {
                server.removeListener(StaticFileServer.ErrorEvent, onError);
                if (e.code === StaticFileServer.AddrInUse && attemptsLeft > 1)
                {
                    done(this.listen(port + 1, attemptsLeft - 1));
                }
                else
                {
                    fail(e);
                }
            };
            server.once(StaticFileServer.ErrorEvent, onError);
            server.listen(port, StaticFileServer.Host, () =>
            {
                server.removeListener(StaticFileServer.ErrorEvent, onError);
                done({ url: `${StaticFileServer.Scheme}${StaticFileServer.Host}:${port}`, port });
            });
        });
    }

    private async handle(rawUrl: string, res: ServerResponse): Promise<void>
    {
        let target: string;
        try
        {
            const path = decodeURIComponent(rawUrl.split(StaticFileServer.QuerySeparator)[0]);
            const rel = normalize(path).replace(StaticFileServer.LeadingParentSegments, StaticFileServer.Empty);
            const isRoot = rel === StaticFileServer.UrlRoot || rel === sep || rel === StaticFileServer.Empty;
            target = resolve(isRoot ? join(this.resolvedRoot, StaticFileServer.IndexFile) : join(this.resolvedRoot, rel));
        }
        catch
        {
            res.statusCode = StaticFileServer.StatusBadRequest;
            res.end();
            return;
        }
        if (target !== this.resolvedRoot && !target.startsWith(this.resolvedRoot + sep))
        {
            res.statusCode = StaticFileServer.StatusForbidden;
            res.end();
            return;
        }
        try
        {
            const body = await readFile(target);
            res.statusCode = StaticFileServer.StatusOk;
            res.setHeader(StaticFileServer.ContentTypeHeader, StaticFileServer.ContentTypes[extname(target)] ?? StaticFileServer.OctetStream);
            res.end(body);
        }
        catch
        {
            res.statusCode = StaticFileServer.StatusNotFound;
            res.end();
        }
    }
}
