import { describe, expect, it } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { Severity, type BuildDiagnostic } from '@pragmatic-tech-ai/todl/build-system-core'
import type { BuildPublishOutcome } from '@pragmatic-tech-ai/todl'
import { PublishFailure } from '../publish-failure.js'
import { PublishTaskExecutor } from '../publish-task-executor.js'
import { BackgroundWorkService, TaskKind, TaskStatus, type InlineJob } from '../../modules/background-work/index.js'

// The failed-publish gate: a successful outcome passes through; a failed one is thrown as a
// PublishFailure so the background-work TaskHandle ends FAILED, while the error still carries
// the structured outcome so the awaiting caller can route it through the normal handling.
describe('PublishFailure.Guard', () =>
{
    it('returns a successful outcome unchanged', () =>
    {
        const ok: BuildPublishOutcome = { Ok: true, Diagnostics: [], Id: 'acme/model', Version: '1.0.0' }
        expect(PublishFailure.Guard(ok)).toBe(ok)
    })

    it('throws a PublishFailure carrying the failed outcome and the joined error text', () =>
    {
        const diagnostics: readonly BuildDiagnostic[] = [{ severity: Severity.Error, message: 'boom' }]
        const bad: BuildPublishOutcome = { Ok: false, Diagnostics: diagnostics, Id: 'acme/model', Version: '1.0.0' }
        try
        {
            PublishFailure.Guard(bad)
            expect.fail('Guard should have thrown on a failed outcome')
        }
        catch (e)
        {
            expect(e).toBeInstanceOf(PublishFailure)
            expect((e as PublishFailure).Outcome).toBe(bad)
            expect((e as PublishFailure).message).toContain('boom')
        }
    })
})

// End-to-end over the real BackgroundWorkService + PublishTaskExecutor + TaskHandle state
// machine: a Guard-wrapped failed publish job must leave the task handle FAILED (not
// Succeeded), while the caller still recovers the carried outcome from the rejected Done.
describe('failed publish task', () =>
{
    it('ends the TaskHandle FAILED yet lets the caller recover the outcome', async () =>
    {
        const work = new BackgroundWorkService(new ServiceProvider())
        work.Register(new PublishTaskExecutor())
        const bad: BuildPublishOutcome = {
            Ok: false,
            Diagnostics: [{ severity: Severity.Error, message: 'boom' }] as readonly BuildDiagnostic[],
            Id: 'acme/model', Version: '1.0.0',
        }
        const job: InlineJob<BuildPublishOutcome> = async () => PublishFailure.Guard(bad)
        const { handle, done } = work.submit<InlineJob<BuildPublishOutcome>, BuildPublishOutcome>({
            kind: TaskKind.Publish, title: 'Publishing acme/model', payload: job,
        })
        const recovered = await done.catch((e) => e instanceof PublishFailure ? e.Outcome : Promise.reject(e))

        expect(recovered).toBe(bad)
        expect(handle.Status).toBe(TaskStatus.Failed)
        expect(handle.Error).toContain('boom')
    })

    it('ends the TaskHandle SUCCEEDED for a successful publish', async () =>
    {
        const work = new BackgroundWorkService(new ServiceProvider())
        work.Register(new PublishTaskExecutor())
        const ok: BuildPublishOutcome = { Ok: true, Diagnostics: [], Id: 'acme/model', Version: '1.0.0' }
        const { handle, done } = work.submit<InlineJob<BuildPublishOutcome>, BuildPublishOutcome>({
            kind: TaskKind.Publish, title: 'Publishing acme/model', payload: async () => PublishFailure.Guard(ok),
        })
        const outcome = await done

        expect(outcome).toBe(ok)
        expect(handle.Status).toBe(TaskStatus.Succeeded)
    })
})
