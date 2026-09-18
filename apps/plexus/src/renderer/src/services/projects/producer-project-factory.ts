// The producer-factory capability (compileToDocument → a base TodlDocument) now
// lives in todl (which owns the compiler + the whole project ecosystem).
// Re-exported here so plexus consumers keep their import path.
export { isProducer, type IProducerProjectFactory } from '@pragmatic-tech-ai/todl'
