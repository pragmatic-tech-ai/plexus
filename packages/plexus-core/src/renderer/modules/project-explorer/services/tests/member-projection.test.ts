import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import {
    SolutionMember,
    Project,
    ProjectNode,
    ProjectNodeKind,
    ProjectFactoryRegistryKey,
    type IProjectFactory,
    type IProjectFactoryRegistry,
    type SolutionMemberRef,
} from '@pragmatic-tech-ai/todl'

import { MemberProjection, UnresolvedSolutionMemberError } from '../member-projection.js'

const FakeTypeId = 'fake-type'
const MissingTypeId = 'missing-type'
const FakeRootPath = 'mem://solution/fake-project'

// A minimal IProjectFactory — MemberProjection.Build only needs it resolvable
// via the registry and passed through to OpenProject unchanged.
class FakeProjectFactory implements IProjectFactory
{
    public readonly typeId = FakeTypeId
    public readonly title = 'Fake'
    public readonly description = 'A fake project factory for tests.'
    public readonly formats = []

    public async createProject(): Promise<Project>
    {
        throw new Error('not used in this test')
    }

    public async openProject(): Promise<Project>
    {
        throw new Error('not used in this test')
    }

    public async saveProject(): Promise<void> {}
}

function makeRegistry(factory: IProjectFactory | undefined): IProjectFactoryRegistry
{
    return {
        factoryFor: (typeId) => (typeId === FakeTypeId ? factory : undefined),
        All: () => (factory === undefined ? [] : [factory]),
    }
}

function makeProvider(factory: IProjectFactory | undefined): ServiceProvider
{
    const provider = new ServiceProvider()
    provider.registerInstance(ProjectFactoryRegistryKey, makeRegistry(factory))
    return provider
}

// A resolved member: its Project/Storage set as Solution.OpenMembers would.
function makeResolvedMember(): { member: SolutionMember; project: Project; storage: FakeStorage }
{
    const ref: SolutionMemberRef = { path: 'fake-project', type: FakeTypeId }
    const member = new SolutionMember(ref)
    const root = new ProjectNode('root', '', ProjectNodeKind.Folder)
    const project = new Project(FakeTypeId, 'FakeProject', FakeRootPath, root)
    const storage = new FakeStorage(FakeRootPath)
    member.Project = project
    member.Storage = storage
    return { member, project, storage }
}

test('Build resolves the factory and constructs an OpenProject carrying the member Project/Storage', () => {
    const factory = new FakeProjectFactory()
    const { member, project, storage } = makeResolvedMember()
    const projection = new MemberProjection(makeProvider(factory))

    const open = projection.Build(member)

    expect(open.Project).toBe(project)
    expect(open.Factory).toBe(factory)
    expect(open.Storage).toBe(storage)
})

test('FolderOf returns the resolved project root path', () => {
    const { member } = makeResolvedMember()
    const projection = new MemberProjection(makeProvider(new FakeProjectFactory()))

    expect(projection.FolderOf(member)).toBe(FakeRootPath)
})

test('FolderOf falls back to the ref path when unresolved', () => {
    const ref: SolutionMemberRef = { path: 'unresolved-project', type: MissingTypeId }
    const member = new SolutionMember(ref)
    const projection = new MemberProjection(makeProvider(undefined))

    expect(projection.FolderOf(member)).toBe(ref.path)
})

test('Build throws UnresolvedSolutionMemberError when no factory is registered for the member type', () => {
    const ref: SolutionMemberRef = { path: 'unresolved-project', type: MissingTypeId }
    const member = new SolutionMember(ref)
    const projection = new MemberProjection(makeProvider(undefined))

    expect(() => projection.Build(member)).toThrow(UnresolvedSolutionMemberError)
})

test('Build throws UnresolvedSolutionMemberError when the member Project/Storage are not yet resolved', () => {
    const ref: SolutionMemberRef = { path: 'fake-project', type: FakeTypeId }
    const member = new SolutionMember(ref)
    const projection = new MemberProjection(makeProvider(new FakeProjectFactory()))

    expect(() => projection.Build(member)).toThrow(UnresolvedSolutionMemberError)
})
