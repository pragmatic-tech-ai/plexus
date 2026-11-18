// Shared (renderer + main) contract types for the "Upload to dev environment" feature.
// Protocol-free structural twins of the main-process upload types. No credentials appear here.
import type { ContributedPackage } from './graph-contribute-api.js'

// One enumerated file of the local solution: text, or bytes as base64 (exactly one is set).
export interface UploadEntry
{
    Path: string;
    Text?: string;
    BytesBase64?: string;
}

// The graph recompose that follows the uploaded writes.
export interface UploadContribution
{
    GraphName: string;
    SolutionId: string;
    Packages: readonly ContributedPackage[];
}
