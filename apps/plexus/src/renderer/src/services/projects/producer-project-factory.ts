// The producer-factory capability (compileToDocument → a base TodlDocument) now
// lives in todl (which owns the compiler + the whole project ecosystem), where it
// was renamed to isBaseProducing / IBaseProducingProjectFactory. Re-exported under
// the plexus-local names so consumers keep their import path.
export { isBaseProducing as isProducer, type IBaseProducingProjectFactory as IProducerProjectFactory } from '@pragmatic-tech-ai/todl'
