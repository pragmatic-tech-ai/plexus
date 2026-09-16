// Pure: one raw `claude -p --output-format stream-json` line → domain AgentEvents.
// Assumes --include-partial-messages is on, so assistant TEXT comes from
// stream_event text deltas; the full `assistant` message is read only for
// tool_use blocks (reading its text too would double every token). Stateless
// per line: tool_use arrives whole in the assistant message, deltas whole in a
// stream_event, so no cross-line assembly is needed. Unknown line types
// (hook_started, status, rate_limit_event, …) fall through to [].
import {
    AgentEventKind,
    ASK_TOOL_QUALIFIED,
    type AgentEvent,
} from '../../shared/agent-api.js'

// A readable sentence for a CLI error result subtype (used only when the CLI
// gave no `result` text of its own). Keeps machine codes out of the markdown-
// rendered chat bubble.
function friendlyErrorMessage(subtype: unknown): string
{
    switch (subtype)
    {
        case 'error_max_turns':        return 'The agent reached its turn limit and stopped.'
        case 'error_during_execution': return 'The agent hit an error during execution.'
        default:                       return 'The agent stopped with an error.'
    }
}

// Capture a tool_result's content (a string or an array of text blocks) as the
// OUT block: the first ~20 lines, capped at ~2000 chars, with a trailing ellipsis
// when clipped. Enough to read typical command output without pasting a whole log.
const OUT_MAX_LINES = 20
const OUT_MAX_CHARS = 2000
function captureOutput(content: unknown): string
{
    let text = ''
    if (typeof content === 'string') text = content
    else if (Array.isArray(content))
        text = content
            .map((b) => (b !== null && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : ''))
            .join('\n')
            .trim()
    if (text === '') return ''

    const lines = text.split('\n')
    let clipped = lines.length > OUT_MAX_LINES
    let out = lines.slice(0, OUT_MAX_LINES).join('\n')
    if (out.length > OUT_MAX_CHARS) { out = out.slice(0, OUT_MAX_CHARS); clipped = true }
    return clipped ? out + '\n…' : out
}

export class StreamJsonParser
{
    public push(line: string): AgentEvent[]
    {
        const trimmed = line.trim()
        if (trimmed === '') return []

        let msg: Record<string, unknown>
        try { msg = JSON.parse(trimmed) as Record<string, unknown> }
        catch { return [] }   // skip malformed line, keep the stream alive

        const out: AgentEvent[] = []
        switch (msg.type)
        {
            case 'system':
                if (msg.subtype === 'init' && typeof msg.session_id === 'string')
                    out.push({ Kind: AgentEventKind.SessionStarted, SessionId: msg.session_id })
                break

            case 'stream_event':
            {
                const ev = msg.event as { type?: string; delta?: { type?: string; text?: unknown } } | undefined
                if (ev?.type === 'content_block_delta'
                    && ev.delta?.type === 'text_delta'
                    && typeof ev.delta.text === 'string')
                    out.push({ Kind: AgentEventKind.AssistantText, Text: ev.delta.text })
                break
            }

            case 'assistant':
            {
                const content = (msg.message as { content?: unknown })?.content
                if (Array.isArray(content))
                    for (const block of content as Array<Record<string, unknown>>)
                        // The ask-user-question tool has its own card (driven by the
                        // Question event), so its tool_use doesn't get a generic chip.
                        if (block?.type === 'tool_use' && String(block.name) !== ASK_TOOL_QUALIFIED)
                            out.push({
                                Kind:  AgentEventKind.ToolUse,
                                Id:    String(block.id),
                                Name:  String(block.name),
                                Input: block.input,
                            })
                break
            }

            case 'user':
            {
                const content = (msg.message as { content?: unknown })?.content
                if (Array.isArray(content))
                    for (const block of content as Array<Record<string, unknown>>)
                        if (block?.type === 'tool_result')
                            out.push({
                                Kind:    AgentEventKind.ToolResult,
                                Id:      String(block.tool_use_id),
                                Ok:      block.is_error !== true,
                                Summary: captureOutput(block.content),
                            })
                break
            }

            case 'result':
                if (msg.is_error === true || msg.subtype === 'error_max_turns' || msg.subtype === 'error_during_execution')
                {
                    // Prefer the CLI's own result text; else a readable sentence for
                    // the subtype. Never surface the raw snake_case code — it's shown
                    // in a markdown view where `error_during_execution` renders as
                    // "error<italic>during</italic>execution" (underscores eaten).
                    const result = typeof msg.result === 'string' ? msg.result.trim() : ''
                    out.push({ Kind: AgentEventKind.Error, Message: result !== '' ? result : friendlyErrorMessage(msg.subtype) })
                }
                else
                    out.push({ Kind: AgentEventKind.TurnComplete })
                break
        }
        return out
    }
}
