// An isolated Electron profile for one e2e run: a fresh temporary user-data directory the app is
// launched on (--user-data-dir), so the run never reads or writes the developer's own profile (the
// default %APPDATA%\Electron of an unpackaged dev run): not its desktop session, not its settings,
// not its restore-session file. Dispose() deletes the directory and everything the app wrote into it
// (the session the run signed in included). It holds only what Electron writes, never node_modules.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

export class E2eProfile
{
    private static readonly DirPrefix = 'plexus-e2e-profile-'
    private static readonly UserDataSwitch = '--user-data-dir='
    // The restore-session file the app reads at launch (see plexus-app.ts seedSession).
    private static readonly SessionFileName = 'open-projects.json'
    private static readonly Utf8 = 'utf8'
    private static readonly RemoveRetries = 10
    private static readonly RemoveRetryDelayMs = 200
    private static readonly DisposeFailed = 'E2eProfile: could not remove the temporary profile directory; delete it by hand:'

    private constructor(public readonly Dir: string)
    {
    }

    public static Create(): E2eProfile
    {
        return new E2eProfile(mkdtempSync(join(tmpdir(), E2eProfile.DirPrefix)))
    }

    // Extra Electron command-line arguments that put the app's userData in this profile.
    public get LaunchArgs(): string[]
    {
        return [E2eProfile.UserDataSwitch + this.Dir]
    }

    public get SessionFile(): string
    {
        return join(this.Dir, E2eProfile.SessionFileName)
    }

    // Seeds the restore-session file with the given project folders, inside this profile.
    public SeedSession(projects: readonly string[]): void
    {
        writeFileSync(this.SessionFile, JSON.stringify(projects), E2eProfile.Utf8)
    }

    // Whether `userDataPath` (the launched app's app.getPath('userData')) is this profile. path.relative
    // compares case-insensitively on Windows, as the file system does.
    public Owns(userDataPath: string): boolean
    {
        return relative(resolve(this.Dir), resolve(userDataPath)) === ''
    }

    // Removes the profile directory. Retries while Chromium still holds a file after the app closed.
    public Dispose(): void
    {
        rmSync(this.Dir, {
            recursive: true, force: true,
            maxRetries: E2eProfile.RemoveRetries, retryDelay: E2eProfile.RemoveRetryDelayMs,
        })
    }

    // Dispose for a test's finally: a directory Chromium still holds is reported (its path only)
    // instead of thrown, so it can never replace the run's own failure.
    public DisposeQuietly(): void
    {
        try
        {
            this.Dispose()
        }
        catch
        {
            console.warn(E2eProfile.DisposeFailed, this.Dir)
        }
    }
}
