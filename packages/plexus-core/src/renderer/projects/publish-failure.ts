import { BuildService, type BuildPublishOutcome } from '@pragmatic-tech-ai/todl'

// A publish whose build produced error diagnostics (outcome.Ok === false). The publish job
// throws this so the background-work TaskHandle ends FAILED (its row shows the joined error
// text via message), while the error carries the structured outcome so the awaiting caller
// can recover it and still route it through the normal Status / Problems-dock handling —
// BackgroundWorkService.startOne calls handle.succeed() on ANY resolution, so a failed
// publish must reject the job, not resolve with {Ok:false}. Guard() is the single home of
// the throw/return decision, so the job and its test agree.
export class PublishFailure extends Error
{
    public readonly Outcome: BuildPublishOutcome

    constructor(outcome: BuildPublishOutcome)
    {
        super(BuildService.FormatErrors(outcome.Diagnostics))
        this.Outcome = outcome
    }

    // Pass a successful outcome through; throw a PublishFailure on a failed one so the task
    // handle fails. The caller recovers the outcome from the thrown PublishFailure.
    public static Guard(outcome: BuildPublishOutcome): BuildPublishOutcome
    {
        if (!outcome.Ok) throw new PublishFailure(outcome)
        return outcome
    }
}
