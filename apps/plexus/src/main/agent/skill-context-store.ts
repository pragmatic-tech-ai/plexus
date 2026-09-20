import { SkillContexts, type SkillContext } from '../../shared/skill-context-api.js'

// Per-session structured skill context, read back by the get_skill_context MCP
// tool. Fed over IPC by the renderer right before a skill's first turn; cleared
// on session close.
export class SkillContextStore
{
    private readonly bySession = new Map<string, SkillContext>()
    set(sessionId: string, context: SkillContext): void { this.bySession.set(sessionId, context) }
    get(sessionId: string): SkillContext { return this.bySession.get(sessionId) ?? SkillContexts.empty('') }
    clear(sessionId: string): void { this.bySession.delete(sessionId) }
}
