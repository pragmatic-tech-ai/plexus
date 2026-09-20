import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { homedir, tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { NodeEnvironment } from '../environment.js';
import { OperatingSystem } from '../../shared/environment-api.js';

const HOME = homedir();

describe('NodeEnvironment — directories (Electron-parity conventions)', () => {
    test('CurrentDirectory / HomeDirectory / TempDirectory come from Node built-ins', () => {
        const info = new NodeEnvironment().Build();
        expect(info.CurrentDirectory).toBe(process.cwd());
        expect(info.HomeDirectory).toBe(HOME);
        expect(info.TempDirectory).toBe(tmpdir());
    });

    test('UserDataDirectory follows the platform config-root convention + app name', () => {
        const info = new NodeEnvironment({ appName: 'plexus-test' }).Build();
        let expectedRoot: string;
        switch (process.platform) {
            case 'win32':
                expectedRoot = process.env.APPDATA ?? join(HOME, 'AppData', 'Roaming');
                break;
            case 'darwin':
                expectedRoot = join(HOME, 'Library', 'Application Support');
                break;
            default:
                expectedRoot = process.env.XDG_CONFIG_HOME || join(HOME, '.config');
                break;
        }
        expect(info.UserDataDirectory).toBe(join(expectedRoot, 'plexus-test'));
    });

    test('DocumentsDirectory / DownloadsDirectory default to ~/<Name>', () => {
        // Neutralize any XDG overrides so the fallback path is deterministic.
        delete process.env.XDG_DOCUMENTS_DIR;
        delete process.env.XDG_DOWNLOAD_DIR;
        const info = new NodeEnvironment().Build();
        expect(info.DocumentsDirectory).toBe(join(HOME, 'Documents'));
        expect(info.DownloadsDirectory).toBe(join(HOME, 'Downloads'));
    });

    test('PathSeparator is the platform separator', () => {
        expect(new NodeEnvironment().Build().PathSeparator).toBe(sep);
    });
});

describe('NodeEnvironment — Linux XDG user-dir overrides', () => {
    const saved: Record<string, string | undefined> = {};
    beforeEach(() => {
        saved.XDG_DOCUMENTS_DIR = process.env.XDG_DOCUMENTS_DIR;
        saved.XDG_DOWNLOAD_DIR = process.env.XDG_DOWNLOAD_DIR;
    });
    afterEach(() => {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    });

    test.runIf(process.platform === 'linux')(
        'honors XDG_DOCUMENTS_DIR / XDG_DOWNLOAD_DIR when set',
        () => {
            process.env.XDG_DOCUMENTS_DIR = '/data/docs';
            process.env.XDG_DOWNLOAD_DIR = '/data/dl';
            const info = new NodeEnvironment().Build();
            expect(info.DocumentsDirectory).toBe('/data/docs');
            expect(info.DownloadsDirectory).toBe('/data/dl');
        },
    );
});

describe('NodeEnvironment — platform, versions, flags', () => {
    test('Platform maps process.platform to the OperatingSystem enum', () => {
        const expected =
            process.platform === 'win32'
                ? OperatingSystem.Windows
                : process.platform === 'darwin'
                  ? OperatingSystem.MacOS
                  : process.platform === 'linux'
                    ? OperatingSystem.Linux
                    : OperatingSystem.Other;
        expect(new NodeEnvironment().Build().Platform).toBe(expected);
    });

    test('NodeVersion passes through; Electron/Chrome versions are empty under plain Node', () => {
        const info = new NodeEnvironment().Build();
        expect(info.NodeVersion).toBe(process.versions.node);
        // Vitest runs under Node (no Chromium), so these are out of reach → ''.
        expect(info.ElectronVersion).toBe(process.versions.electron ?? '');
        expect(info.ChromeVersion).toBe(process.versions.chrome ?? '');
    });

    test('app facts come from options, with sensible defaults', () => {
        const def = new NodeEnvironment().Build();
        expect(def.AppVersion).toBe('');
        expect(def.IsPackaged).toBe(false);

        const given = new NodeEnvironment({
            appVersion: '1.2.3',
            isDevelopment: false,
            isPackaged: true,
        }).Build();
        expect(given.AppVersion).toBe('1.2.3');
        expect(given.IsDevelopment).toBe(false);
        expect(given.IsPackaged).toBe(true);
    });
});
