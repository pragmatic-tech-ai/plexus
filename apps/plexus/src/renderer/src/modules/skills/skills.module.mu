// skills.module.mu — the Skills authoring capability.
//
// Contributes a left-rail "Skills" panel to author skills: a searchable catalog
// list (SkillCatalog, from #1) with ＋New scaffolding, and a frontmatter form that
// edits the selected skill's x-plexus block against the same Monaco buffer the body
// tab shows (SkillAuthoringService). A pure contributor — one service + a Capability
// nav entry; the panel is rendered by DataTemplate[SkillAuthoringService] in
// skills-authoring.resources.mu (merged app-global).

import SkillAuthoringService from "./services/skill-authoring-service.js"

module SkillsModule [ Name = "Skills" ] {
    .services: {
        SkillAuthoringService
    }

    Capability [ Name = "Skills", Icon = @Skill, ServiceKey = SkillAuthoringService ]
}
