// The WikiOrigin model + locator now live in todl (solution-services); re-exported
// here so plexus import paths stay stable (mirrors base-binding.ts). The packages
// backend is passed into WikiLocator.LocateFile by the host at the call site.
export { WikiOriginKind, WikiLocator, type WikiOrigin } from '@pragmatic-tech-ai/todl'
