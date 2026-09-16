import { isToolboxContextTarget } from '@pragmatic-tech-ai/mural/framework'

const EMPTY: ReadonlySet<string> = new Set()

// The active document's content-context tokens the toolbox filters pages against.
// An architecture diagram document carries the set of published refs it references
// (`<id>@<version>`) plus its own model token (`model:<namespace>`); documents that
// activate no toolbox content return the empty set (only static pages show).
export function toolboxContextsOf(doc: unknown): ReadonlySet<string>
{
    return isToolboxContextTarget(doc) ? doc.ToolboxContexts : EMPTY
}
