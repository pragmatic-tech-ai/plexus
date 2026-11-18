import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { RunTestResult } from '../../../shared/run-test-api.js'
import type { TargetRef } from '../../../shared/account-api.js'

// Host-agnostic run/test capability: load a built remote app into a dev environment's own runtime and
// answer where it is served. The UX side (RunTestContributor) depends only on this interface + key; the
// desktop host (apps/plexus) supplies the impl over its preload bridge.
export interface IEnvironmentRunTester
{
    Run(target: TargetRef, outputDir: string): Promise<RunTestResult>;
}

export const EnvironmentRunTesterKey = new ServiceKey<IEnvironmentRunTester>('EnvironmentRunTester')
