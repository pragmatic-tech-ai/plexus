// Shared (renderer + main) contract types for listing an environment's applications and graphs.
// Protocol-free structural twins of the wire DTOs (plexus-core does not depend on the protocol
// package). No credentials ever appear in these types.

export interface AppSummary
{
    Name: string;
    Version: string;
}

export interface GraphSummary
{
    Name: string;
    PackageCount?: number;
}

export interface EnvironmentContents
{
    Applications: AppSummary[];
    Graphs: GraphSummary[];
}
