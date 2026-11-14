import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { EnvironmentPublishResult } from '../../../shared/environment-publish-api.js'
import type { TargetRef } from '../../../shared/account-api.js'

// Host-agnostic publish capability: upload a built remote app to a Runtime environment. The UX side
// (PublishToEnvironmentContributor) depends only on this interface + key; the desktop host (apps/plexus)
// supplies the impl over its preload bridge, and the upload itself runs in the main process through
// the relay of the target's source (which holds the environment credential).
export interface IEnvironmentPublisher
{
    Publish(target: TargetRef, outputDir: string): Promise<EnvironmentPublishResult>;
}

export const EnvironmentPublisherKey = new ServiceKey<IEnvironmentPublisher>('EnvironmentPublisher')
