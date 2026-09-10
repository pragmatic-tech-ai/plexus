// (De)serialize a conversation transcript for persistence. The minimal text-bearing
// shape needed to re-display a stored conversation — tool cards / question cards are
// not fully round-tripped in v1; a tool activity is stored as its name so history
// reads sensibly.
import type { MuralBase } from '@pragmatic-tech-ai/mural/runtime'
import { UserMessage, AssistantMessage, ToolActivity, TranscriptRole, type MarkdownRender } from './transcript.js'

export interface SerializedMessage { Role: TranscriptRole; Text: string }

export function serializeTranscript(items: readonly MuralBase[]): SerializedMessage[]
{
    const out: SerializedMessage[] = []
    for (const item of items)
    {
        if (item instanceof UserMessage) out.push({ Role: TranscriptRole.User, Text: item.Text })
        else if (item instanceof AssistantMessage) out.push({ Role: TranscriptRole.Assistant, Text: item.Text })
        else if (item instanceof ToolActivity) out.push({ Role: TranscriptRole.Tool, Text: item.Name })
    }
    return out
}

export function rehydrateTranscript(records: readonly SerializedMessage[], render?: MarkdownRender): MuralBase[]
{
    const out: MuralBase[] = []
    for (const rec of records)
    {
        if (rec.Role === TranscriptRole.User) out.push(new UserMessage(rec.Text))
        else if (rec.Role === TranscriptRole.Assistant) { const a = new AssistantMessage(render); a.appendText(rec.Text); out.push(a) }
        else out.push(new ToolActivity(`restored-${out.length}`, rec.Text, {}))
    }
    return out
}
