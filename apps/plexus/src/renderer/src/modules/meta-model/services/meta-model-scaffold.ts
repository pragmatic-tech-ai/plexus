import type { ScaffoldFile } from '../../../services/projects/todl-project-factory.js'
import { CLAUDE_DIR, CLAUDE_MD_FILENAME } from '../../../services/projects/todl-project-factory.js'
import claudeRoot from './scaffold/claude-root.md?raw'
import metaModelGuide from './scaffold/meta-model-guide.md?raw'
import newConceptCommand from './scaffold/new-concept.md?raw'

// The meta-model project's own scaffold contributions, unioned by
// TodlProjectFactory.ensureScaffold with the shared TODL_BASE_SCAFFOLD
// (todl-manual.md + todl-rules.md). This module owns only the meta-model-specific
// docs: the root CLAUDE.md (meta-model intro + workflow), the authoring guide, and
// the /new-concept command.
export const META_MODEL_SCAFFOLD: readonly ScaffoldFile[] = [
    { path: CLAUDE_MD_FILENAME,                       content: claudeRoot },
    { path: `${CLAUDE_DIR}/meta-model-guide.md`,      content: metaModelGuide },
    { path: `${CLAUDE_DIR}/commands/new-concept.md`,  content: newConceptCommand },
]
