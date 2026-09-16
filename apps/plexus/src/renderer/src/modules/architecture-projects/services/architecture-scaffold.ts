import type { ScaffoldFile } from '../../../services/projects/todl-project-factory.js'
import { CLAUDE_MD_FILENAME } from '../../../services/projects/todl-project-factory.js'
import claudeRoot from './scaffold/claude-root.md?raw'

// The architecture project's own scaffold contribution — its root CLAUDE.md.
// Unioned by TodlProjectFactory.ensureScaffold with the shared TODL_BASE_SCAFFOLD
// (todl-manual.md + todl-rules.md), so an architecture project now gets the same
// TODL guidance the other TODL project types have.
export const ARCHITECTURE_SCAFFOLD: readonly ScaffoldFile[] = [
    { path: CLAUDE_MD_FILENAME, content: claudeRoot },
]
