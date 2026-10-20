import { describe, it, expect } from 'vitest'
import { FakeStorage, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { Severity } from '@pragmatic-tech-ai/todl/build-system-core'
import type { IBuildStorageProvider, OpenedOutput, BuildOptions } from '@pragmatic-tech-ai/todl/build-system-core'
import type { SolutionBuildRequest, SolutionBuildResult, IPackageSource } from '@pragmatic-tech-ai/todl/todl-build-system'
import type { SolutionManagerService } from '@pragmatic-tech-ai/todl'
import { PROJECT_MANIFEST_FILENAME } from '../../../projects/project-factory.js'
import { SolutionPackageBuilder, type SolutionBuildManagerFactory } from '../solution-package-builder.js'

// --- Fakes -----------------------------------------------------------------------------------

const ModelFileName = 'model.json'
const NpmPackageId = 'npm-package'

class FakeMember
{
    constructor(public readonly Storage: IStorage | undefined)
    {
    }
}

class FakeMembers
{
    constructor(private readonly members: readonly FakeMember[])
    {
    }

    public ToArray(): FakeMember[]
    {
        return [...this.members]
    }
}

class FakeSolution
{
    public readonly Members: FakeMembers

    constructor(members: readonly FakeMember[])
    {
        this.Members = new FakeMembers(members)
    }
}

class FakeSolutions
{
    constructor(private readonly solution: FakeSolution | undefined)
    {
    }

    public get ActiveSolution(): FakeSolution | undefined
    {
        return this.solution
    }
}

class FakeExternalSource implements IPackageSource
{
    public async TryGet(): Promise<undefined>
    {
        return undefined
    }
}

// Delegate that hands back a pre-seeded output storage per OutputRootOverride (the "already built"
// model.json lives there). Its OpenOutput is what the capturing decorator wraps.
class SeededDelegate implements IBuildStorageProvider
{
    constructor(private readonly outputs: ReadonlyMap<string, IStorage>)
    {
    }

    public async CreateSandbox(): Promise<IStorage>
    {
        return new FakeStorage()
    }

    public async DeleteSandbox(_sandbox: IStorage): Promise<void>
    {
    }

    public async OpenOutput(outputName: string, options: BuildOptions): Promise<OpenedOutput>
    {
        const root = options.OutputRootOverride ?? ''
        const storage = this.outputs.get(root) ?? new FakeStorage()
        return { Storage: storage, Path: `${outputName}:${root}` }
    }
}

// Test fixture helpers — kept OOP (static methods) rather than module-level functions.
class Fixture
{
    public static async Member(manifestJson: string): Promise<FakeMember>
    {
        const storage = new FakeStorage()
        await storage.WriteText(PROJECT_MANIFEST_FILENAME, manifestJson)
        return new FakeMember(storage)
    }

    public static async Output(modelJson: string): Promise<IStorage>
    {
        const storage = new FakeStorage()
        await storage.WriteText(ModelFileName, modelJson)
        return storage
    }

    public static Library(id: string, version: string, name: string): string
    {
        return JSON.stringify({ type: 'library', name, version: 1, id, packageVersion: version })
    }

    public static Architecture(name: string): string
    {
        return JSON.stringify({ type: 'architecture', name, version: 1 })
    }

    // A factory that simulates the real SolutionBuildManager: it threads each project's output
    // through the capturing provider (so the capture path is genuinely exercised) and reports Ok.
    public static OkFactory(): SolutionBuildManagerFactory
    {
        return (_registry, storage) => ({
            async Build(request: SolutionBuildRequest): Promise<SolutionBuildResult>
            {
                for (const project of request.Projects)
                {
                    await storage.OpenOutput(NpmPackageId, { OutputRootOverride: project.Id })
                }
                return { Ok: true, Order: request.Projects.map((p) => p.Id), Projects: [], Diagnostics: [], DurationMs: 0 }
            },
        })
    }

    public static FailingFactory(message: string): SolutionBuildManagerFactory
    {
        return () => ({
            async Build(_request: SolutionBuildRequest): Promise<SolutionBuildResult>
            {
                return { Ok: false, Order: [], Projects: [], Diagnostics: [{ severity: Severity.Error, message }], DurationMs: 0 }
            },
        })
    }

    public static Builder(solution: FakeSolution | undefined, delegate: IBuildStorageProvider, factory: SolutionBuildManagerFactory): SolutionPackageBuilder
    {
        const registry = {} as unknown as ConstructorParameters<typeof SolutionPackageBuilder>[0]
        const solutions = new FakeSolutions(solution) as unknown as SolutionManagerService
        return new SolutionPackageBuilder(registry, delegate, new FakeExternalSource(), solutions, factory)
    }
}

// --- Tests -----------------------------------------------------------------------------------

describe('SolutionPackageBuilder', () =>
{
    it('throws when there is no active solution', async () =>
    {
        const builder = Fixture.Builder(undefined, new SeededDelegate(new Map()), Fixture.OkFactory())
        await expect(builder.Build()).rejects.toThrow(/no active solution/i)
    })

    it('emits one ContributedPackage per project from the captured model.json', async () =>
    {
        const m1 = await Fixture.Member(Fixture.Library('p1', '1.0.0', 'One'))
        const m2 = await Fixture.Member(Fixture.Library('p2', '2.1.0', 'Two'))
        const outputs = new Map<string, IStorage>([
            ['p1', await Fixture.Output('{"model":1}')],
            ['p2', await Fixture.Output('{"model":2}')],
        ])
        const builder = Fixture.Builder(new FakeSolution([m1, m2]), new SeededDelegate(outputs), Fixture.OkFactory())
        const packages = await builder.Build()
        expect(packages).toHaveLength(2)
        expect(packages).toContainEqual({ id: 'p1', version: '1.0.0', modelJson: '{"model":1}' })
        expect(packages).toContainEqual({ id: 'p2', version: '2.1.0', modelJson: '{"model":2}' })
    })

    it('throws the build-failed error with formatted diagnostics and yields no packages', async () =>
    {
        const m1 = await Fixture.Member(Fixture.Library('p1', '1.0.0', 'One'))
        const builder = Fixture.Builder(new FakeSolution([m1]), new SeededDelegate(new Map()), Fixture.FailingFactory('boom'))
        await expect(builder.Build()).rejects.toThrow(/boom/)
    })

    it('dedupes projects that resolve to the same id and version into a single package', async () =>
    {
        const m1 = await Fixture.Member(Fixture.Library('dup', '1.0.0', 'First'))
        const m2 = await Fixture.Member(Fixture.Library('dup', '1.0.0', 'Second'))
        const outputs = new Map<string, IStorage>([['dup', await Fixture.Output('{"model":"dup"}')]])
        const builder = Fixture.Builder(new FakeSolution([m1, m2]), new SeededDelegate(outputs), Fixture.OkFactory())
        const packages = await builder.Build()
        expect(packages).toHaveLength(1)
        expect(packages[0]).toEqual({ id: 'dup', version: '1.0.0', modelJson: '{"model":"dup"}' })
    })

    it('skips a non-publishable (architecture) manifest while still emitting the others', async () =>
    {
        const lib = await Fixture.Member(Fixture.Library('lib', '1.0.0', 'Lib'))
        const arch = await Fixture.Member(Fixture.Architecture('Arch'))
        const outputs = new Map<string, IStorage>([
            ['lib', await Fixture.Output('{"model":"lib"}')],
            ['Arch', await Fixture.Output('{"model":"arch"}')],
        ])
        const builder = Fixture.Builder(new FakeSolution([lib, arch]), new SeededDelegate(outputs), Fixture.OkFactory())
        const packages = await builder.Build()
        expect(packages).toHaveLength(1)
        expect(packages[0]).toEqual({ id: 'lib', version: '1.0.0', modelJson: '{"model":"lib"}' })
    })
})
