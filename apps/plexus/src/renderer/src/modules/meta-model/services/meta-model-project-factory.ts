// The 'meta-model' project factory now lives in todl (which owns the compiler +
// the whole project ecosystem). Re-exported here so the module registration and
// consumers keep their import path. Its publish path resolves the mural/OS-coupled
// seams (IPresentationBaker, IPackageStore) from the container — registered by
// the app (see mural-presentation-baker.ts / storage-service-backends.ts).
export { MetaModelProjectFactory } from '@pragmatic-tech-ai/todl'
