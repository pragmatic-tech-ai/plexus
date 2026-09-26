// The 'meta-model' project factory now lives in todl (which owns the compiler +
// the whole project ecosystem). Re-exported here so the module registration and
// consumers keep their import path. Its publish path resolves the package store
// (IPackageStore) from the container — registered by the app (see
// storage-service-backends.ts); presentation baking is TODL's own default baker.
export { MetaModelProjectFactory } from '@pragmatic-tech-ai/todl'
