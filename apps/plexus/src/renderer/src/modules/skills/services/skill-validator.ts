import { InputKind, SkillProblemSeverity, type SkillProblem } from '../../../../../shared/skill-api.js'
import type { XPlexus } from './skill-file-codec.js'

// Validates a structured x-plexus object, in parity with the main
// SkillFrontmatterParser rules, so problems shown live in the authoring form match
// what the catalog scanner would report. Pure + non-throwing.
export class SkillValidator
{
    validate(ext: XPlexus): SkillProblem[]
    {
        const out: SkillProblem[] = []
        if (ext.version !== undefined && ext.version !== 1)
        {
            out.push({ message: `Unsupported x-plexus.version ${ext.version}; expected 1.`, severity: SkillProblemSeverity.Warning })
        }
        const seen = new Set<string>()
        for (const input of ext.inputs)
        {
            if (input.key.trim() === '')
            {
                out.push({ message: `An input is missing its key.`, severity: SkillProblemSeverity.Error })
            }
            else if (seen.has(input.key))
            {
                out.push({ message: `Duplicate input key "${input.key}".`, severity: SkillProblemSeverity.Warning })
            }
            else
            {
                seen.add(input.key)
            }
            if (input.type === InputKind.Enum && (input.options?.length ?? 0) === 0)
            {
                out.push({ message: `Enum input "${input.key || '(unnamed)'}" has no options.`, severity: SkillProblemSeverity.Warning })
            }
        }
        return out
    }
}
