import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import type { IBuildStorageProvider, OpenedOutput, BuildOptions } from '@pragmatic-tech-ai/todl/build-system-core'

// A build-storage-provider decorator that lets a whole-solution build run in the renderer without
// the engine's own capture step wiping each project's freshly built model.json.
//
// TODL's SolutionBuildManager builds each project with options={OutputRootOverride: id} (writing
// model.json into that output) and then RE-OPENS the same output to read model.json back. The real
// RendererBuildStorageProvider.OpenOutput deletes + recreates an existing output dir, so that second
// open would wipe the just-built model.json. This decorator MEMOIZES OpenOutput by (outputName,
// OutputRootOverride): the first open delegates and caches the result; every later open of the same
// key returns the cached OpenedOutput WITHOUT delegating, so the delegate's delete+recreate never
// runs a second time (the "never re-open" discipline). The decorator itself never re-opens or mutates
// storage — it only records, per OutputRootOverride, the output IStorage so the builder can read each
// captured model.json after the build.
export class CapturingBuildStorageProvider implements IBuildStorageProvider
{
    // Composes the memo key from (outputName, OutputRootOverride). NUL never occurs in either, so the
    // join is unambiguous.
    private static readonly KeySeparator = '\u0000'

    private readonly openedByKey = new Map<string, OpenedOutput>()
    private readonly capturedByRoot = new Map<string, IStorage>()

    constructor(private readonly delegate: IBuildStorageProvider)
    {
    }

    public CreateSandbox(): Promise<IStorage>
    {
        return this.delegate.CreateSandbox()
    }

    public DeleteSandbox(sandbox: IStorage): Promise<void>
    {
        return this.delegate.DeleteSandbox(sandbox)
    }

    public async OpenOutput(outputName: string, options: BuildOptions): Promise<OpenedOutput>
    {
        const rootOverride = options.OutputRootOverride
        const key = outputName + CapturingBuildStorageProvider.KeySeparator + (rootOverride ?? '')
        const cached = this.openedByKey.get(key)
        if (cached !== undefined)
        {
            return cached
        }
        const output = await this.delegate.OpenOutput(outputName, options)
        this.openedByKey.set(key, output)
        // First write wins: the first open per root is the build-write handle that receives model.json.
        if (rootOverride !== undefined && !this.capturedByRoot.has(rootOverride))
        {
            this.capturedByRoot.set(rootOverride, output.Storage)
        }
        return output
    }

    // The per-project outputs captured during the build, keyed by OutputRootOverride (the project id).
    public CapturedOutputs(): ReadonlyMap<string, IStorage>
    {
        return this.capturedByRoot
    }
}
