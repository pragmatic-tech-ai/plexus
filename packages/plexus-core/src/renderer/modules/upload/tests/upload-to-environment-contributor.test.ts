import { describe, it, expect } from 'vitest'
import { Solution } from '@pragmatic-tech-ai/todl'
import { UploadToEnvironmentContributor } from '../../solution-explorer/services/upload-to-environment-contributor.js'
import { ScriptedPicker } from '../../solution-explorer/services/tests/fake-target-sources.js'
import { TargetSource, type TargetChoice, type TargetRef } from '../../../../shared/account-api.js'
import type { IUploadContributor } from '../upload-contributor.js'
import type { UploadContribution, UploadEntry } from '../../../../shared/upload-api.js'

class FakeUploader implements IUploadContributor
{
    public Calls: Array<{ target: TargetRef; name: string; tree: UploadEntry[]; contribution?: UploadContribution }> = []

    public Upload(target: TargetRef, name: string, tree: UploadEntry[], contribution?: UploadContribution): Promise<void>
    {
        this.Calls.push({ target, name, tree, ...(contribution !== undefined ? { contribution } : {}) })
        return Promise.resolve()
    }
}

class Fixture
{
    public static readonly Tree: UploadEntry[] = [{ Path: 'S.pksln', Text: '{}' }]
    public static readonly Packages = [{ id: 'p', version: '1.0.0', modelJson: '{}' }]

    public static Work(): any
    {
        const w: any = { run: (t: string, fn: any) => { w.Title = t; w.task = fn({}); return { handle: {}, done: w.task } } }
        return w
    }

    public static Flush(): Promise<void>
    {
        return new Promise((res) => setTimeout(res, 0))
    }

    public static Builds = 0

    public static Make(uploader: IUploadContributor | undefined, choice: TargetChoice | undefined, work: any = Fixture.Work(), enumerator: any = { Enumerate: () => Promise.resolve(Fixture.Tree) }, withBuilder = true): UploadToEnvironmentContributor
    {
        const builder = withBuilder ? { Build: () => { Fixture.Builds++; return Promise.resolve(Fixture.Packages) } } : undefined
        return new UploadToEnvironmentContributor(new Solution('S'), enumerator, builder as any, work, uploader, undefined, new ScriptedPicker([ScriptedPicker.PickOf(choice)]))
    }
}

describe('UploadToEnvironmentContributor', () =>
{
    it('offers the upload command on the solution', () =>
    {
        const c = Fixture.Make(new FakeUploader(), undefined)
        expect(c.Actions.map((a) => a.Id)).toEqual(['environment.upload'])
        expect(c.Actions[0]!.Title).toBe('Upload to dev environment…')
        expect(c.Resolve('nope', {} as any)).toBeUndefined()
    })

    it('enumerates, builds packages and uploads to the chosen target', async () =>
    {
        const up = new FakeUploader()
        const work = Fixture.Work()
        Fixture.Make(up, { Environment: 'dev', Source: TargetSource.Platform, GraphName: 'main' }, work).Resolve('environment.upload', {} as any)!.Execute()
        await Fixture.Flush()
        await expect(work.task).resolves.toBe(1)
        expect(up.Calls).toEqual([{
            target: { Name: 'dev', Source: TargetSource.Platform }, name: 'S', tree: Fixture.Tree,
            contribution: { GraphName: 'main', SolutionId: 'S', Packages: Fixture.Packages },
        }])
        expect(work.Title).toBe('Uploading S to dev')
    })

    it('uploads files only, without building, when no graph is chosen', async () =>
    {
        const up = new FakeUploader()
        const work = Fixture.Work()
        Fixture.Builds = 0
        Fixture.Make(up, { Environment: 'dev', Source: TargetSource.Console }, work).Resolve('environment.upload', {} as any)!.Execute()
        await Fixture.Flush()
        await expect(work.task).resolves.toBe(1)
        expect(up.Calls).toHaveLength(1)
        expect(up.Calls[0]!.contribution).toBeUndefined()
        expect(Fixture.Builds).toBe(0)
    })

    it('rejects the task when the uploader fails', async () =>
    {
        const up = new FakeUploader()
        up.Upload = () => Promise.reject(new Error('relay down'))
        const work = Fixture.Work()
        Fixture.Make(up, { Environment: 'dev', Source: TargetSource.Console, GraphName: 'main' }, work).Resolve('environment.upload', {} as any)!.Execute()
        await Fixture.Flush()
        await expect(work.task).rejects.toThrow('relay down')
    })

    it('rejects the task when the enumerator fails, uploading nothing', async () =>
    {
        const up = new FakeUploader()
        const work = Fixture.Work()
        const bad = { Enumerate: () => Promise.reject(new Error('unsafe path')) }
        Fixture.Make(up, { Environment: 'dev', Source: TargetSource.Console }, work, bad).Resolve('environment.upload', {} as any)!.Execute()
        await Fixture.Flush()
        await expect(work.task).rejects.toThrow('unsafe path')
        expect(up.Calls).toEqual([])
    })

    it('fails explicitly when a graph is chosen but no builder is available', async () =>
    {
        const up = new FakeUploader()
        const work = Fixture.Work()
        Fixture.Make(up, { Environment: 'dev', Source: TargetSource.Console, GraphName: 'main' }, work, undefined, false).Resolve('environment.upload', {} as any)!.Execute()
        await Fixture.Flush()
        await expect(work.task).rejects.toThrow(/cannot be built/)
        expect(up.Calls).toEqual([])
    })

    it('does nothing when the picker is cancelled, and is disabled without a contributor', async () =>
    {
        const up = new FakeUploader()
        const work = Fixture.Work()
        Fixture.Make(up, undefined, work).Resolve('environment.upload', {} as any)!.Execute()
        await Fixture.Flush()
        expect(work.task).toBeUndefined()
        expect(up.Calls).toEqual([])
        expect(Fixture.Make(undefined, undefined).Resolve('environment.upload', {} as any)!.CanExecute()).toBe(false)
    })
})
