// Shared (renderer + main) contract types for the "Contribute solution to graph" feature.
// Protocol-free structural twins of the wire DTOs (plexus-core does not depend on the protocol
// package). No credentials ever appear in these types.

export interface ContributedPackage
{
    id: string;
    version: string;
    modelJson: string;
}

export interface GraphContributeResult
{
    GraphName: string;
    PackageCount: number;
}
