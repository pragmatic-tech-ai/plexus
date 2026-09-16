import type { ScaffoldFile } from '../../../services/projects/todl-project-factory.js'
import { CLAUDE_MD_FILENAME } from '../../../services/projects/todl-project-factory.js'
import claudeRoot from './scaffold/claude-root.md?raw'

// The library project's own scaffold contribution — its root CLAUDE.md. Unioned
// by TodlProjectFactory.ensureScaffold with the shared TODL_BASE_SCAFFOLD
// (todl-manual.md + todl-rules.md), so a library project gets the full TODL
// guidance a meta-model project already had.
export const LIBRARY_SCAFFOLD: readonly ScaffoldFile[] = [
    { path: CLAUDE_MD_FILENAME, content: claudeRoot },
]
