import { describe, it, expect } from 'vitest'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { PROJECT_MANIFEST_FILENAME } from '../../../projects/project-factory.js'
import { SolutionTreeEnumerator } from '../solution-tree-enumerator.js'

class FakeSolution
{
    public readonly Members = { ToArray: () => this.members }

    constructor(public readonly Name: string, public readonly Storage: FakeStorage | undefined, private readonly members: Array<{ Ref: { path: string }; Storage: FakeStorage | undefined }>)
    {
    }
}

class Fixture
{
    public static async Solution(): Promise<FakeSolution>
    {
        const root = new FakeStorage()
        await root.WriteText('S.pksln', '{"kind":"todl-solution"}')
        const a = new FakeStorage()
        await a.WriteText(PROJECT_MANIFEST_FILENAME, '{"name":"a"}')
        await a.WriteText('main.todl', 'model a')
        await a.WriteText('sub/deep.todl', 'model deep')
        await a.WriteText('notes.md', 'ignored')
        const b = new FakeStorage()
        await b.WriteText(PROJECT_MANIFEST_FILENAME, '{"name":"b"}')
        return new FakeSolution('S', root, [
            { Ref: { path: './a' }, Storage: a },
            { Ref: { path: 'libs/b' }, Storage: b },
            { Ref: { path: 'gone' }, Storage: undefined },
        ])
    }
}

describe('SolutionTreeEnumerator', () =>
{
    it('walks the solution manifest, each member project.plexus and its .todl sources', async () =>
    {
        const tree = await new SolutionTreeEnumerator().Enumerate(await Fixture.Solution() as any)
        expect(tree.map((e) => e.Path).sort()).toEqual([
            'S.pksln', 'a/main.todl', 'a/project.plexus', 'a/sub/deep.todl', 'libs/b/project.plexus',
        ])
        expect(tree.find((e) => e.Path === 'a/main.todl')).toEqual({ Path: 'a/main.todl', Text: 'model a' })
        expect(tree.every((e) => e.BytesBase64 === undefined)).toBe(true)
    })

    it('skips the top-level dist output folder, as the engine does', async () =>
    {
        const a = new FakeStorage()
        await a.WriteText('main.todl', 'm')
        await a.WriteText('dist/out.todl', 'built')
        const root = new FakeStorage()
        await root.WriteText('S.pksln', '{}')
        const tree = await new SolutionTreeEnumerator().Enumerate(new FakeSolution('S', root, [{ Ref: { path: 'a' }, Storage: a }]) as any)
        expect(tree.map((e) => e.Path).sort()).toEqual(['S.pksln', 'a/main.todl'])
    })

    it('normalizes backslash member paths to POSIX', async () =>
    {
        const a = new FakeStorage()
        await a.WriteText('main.todl', 'm')
        const tree = await new SolutionTreeEnumerator().Enumerate(new FakeSolution('S', new FakeStorage(), [{ Ref: { path: 'libs\\a' }, Storage: a }]) as any)
        expect(tree.map((e) => e.Path)).toEqual(['libs/a/main.todl'])
    })

    it('refuses a member path that escapes the solution', async () =>
    {
        const a = new FakeStorage()
        await a.WriteText('main.todl', 'm')
        for (const path of ['../x', 'libs\\..\\..\\x'])
        {
            await expect(new SolutionTreeEnumerator().Enumerate(new FakeSolution('S', new FakeStorage(), [{ Ref: { path }, Storage: a }]) as any)).rejects.toThrow(/unsafe path/)
        }
    })

    it('refuses an empty solution rather than uploading nothing', async () =>
    {
        await expect(new SolutionTreeEnumerator().Enumerate(new FakeSolution('S', new FakeStorage(), []) as any)).rejects.toThrow(/no files to upload/)
    })

    it('refuses an unsaved solution', async () =>
    {
        await expect(new SolutionTreeEnumerator().Enumerate(new FakeSolution('S', undefined, []) as any)).rejects.toThrow(/not been saved/)
    })
})
