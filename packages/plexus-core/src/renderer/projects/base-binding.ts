// The base-binding contracts (BaseRef / BaseBindings) now live in todl; aliased
// here so plexus consumers keep their import path against the single source of
// truth. Meta-models and libraries are unified: bindings carry `metaModels[]` +
// `libraries[]` (both any number), so BaseBindings mirrors that plurality.
import type { PublishedBaseModelReference, ProjectBaseModelBindings } from '@pragmatic-tech-ai/todl'

export type BaseRef = PublishedBaseModelReference
export type BaseBindings = ProjectBaseModelBindings
