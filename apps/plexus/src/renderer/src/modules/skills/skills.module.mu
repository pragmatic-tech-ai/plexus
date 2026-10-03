// skills.module.mu — the Skills authoring capability.
//
// Contributes a left-rail "Skills" panel to author skills: a searchable catalog
// list (SkillCatalog, from #1) with ＋New scaffolding, and a frontmatter form that
// edits the selected skill's x-plexus block against the same Monaco buffer the body
// tab shows (SkillAuthoringService). A pure contributor — one service + a Capability
// nav entry; the panel is rendered by DataTemplate[SkillAuthoringService] in
// skills-authoring.resources.mu (merged app-global).

import SkillAuthoringService from "./services/skill-authoring-service.js"
import SkillActionContributor from "./services/skill-action-contributor.js"
import SkillRunSubmenuContributor from "./services/skill-run-submenu-contributor.js"

shell module SkillsModule [ Name = "Skills" ] {
    .services: {
        SkillAuthoringService
        SkillActionContributor
        SkillRunSubmenuContributor
    }

    // "Run Agent / Skill" on a project (member) row — the IProjectMenuSource
    // replacement on the B+C1 command seam. SkillActionContributor resolves the header
    // and each dynamic `skill.run::<name>` child; the catalog submenu is filled lazily by
    // SkillRunSubmenuContributor (ChildrenContributor), the replacement for the old
    // async HierarchyAction.Children.Add fill.
    Hierarchy {
        Contributor [ Under = "project", Use = SkillActionContributor, Order = 100 ] {
            CommandDefinition
                [ Id                 = "skill.run",
                  Title              = "Run Agent / Skill",
                  Context            = "project",
                  ChildrenContributor = SkillRunSubmenuContributor ]
        }
    }

    Capability [ Name = "Skills", Icon = @Skill, ServiceKey = SkillAuthoringService ]
}
