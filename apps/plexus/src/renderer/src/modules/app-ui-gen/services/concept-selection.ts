import type { IPromptService } from '@pragmatic-tech-ai/todl-runtime'

// Where the "Generate UI" command gets its target concept from. The project tree carries
// no concept rows, so the default source asks the maker; a future tree/editor selection
// can implement the same seam.
export interface IConceptSelection
{
    // The full concept name (e.g. "acme.Customer") to generate for, or undefined when the
    // maker declines.
    Select(projectTitle: string): Promise<string | undefined>
}

export class PromptConceptSelection implements IConceptSelection
{
    private static readonly PromptLabel = 'Concept to generate UI for (full name, e.g. acme.Customer)'

    public constructor(private readonly prompts: IPromptService) {}

    public async Select(_projectTitle: string): Promise<string | undefined>
    {
        const answer = await this.prompts.PromptText(PromptConceptSelection.PromptLabel)
        const trimmed = answer?.trim()
        return trimmed === undefined || trimmed === '' ? undefined : trimmed
    }
}
