// Wire contract for the "Run/Test in environment" feature: the renderer<->main IPC channel name, the
// main-process API and the renderer-facing bridge shape (exposed on window.api.runTest by the preload).
// The load goes through the run-test relay of the target's source; no credential crosses this bridge.
import type { RunTestResult } from '@pragmatic-tech-ai/plexus-core/shared/run-test-api.js'
import type { RelayReply, TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'

export type { RunTestResult }

export enum RunTestChannel
{
    Run = 'run-test:run',
}

export interface IRunTestApi
{
    // Loads the already-built remote-flavor output directory into the environment's own runtime and
    // answers where the app is served.
    Run(target: TargetRef, outputDir: string): Promise<RunTestResult>;
}

export interface IRunTestBridge
{
    Run(target: TargetRef, outputDir: string): Promise<RelayReply<RunTestResult>>;
}
