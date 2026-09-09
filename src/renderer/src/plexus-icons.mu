// plexus-icons.mu — the shared icon dictionary for Plexus.
//
// A standalone `resources` dictionary of vector icons: each `include` splices
// an SVG (under ./icons) into a keyed Geometry resource at compile time (via
// the CLI's SVG→geometry resolver). One geometry per capability shown in the
// shell's activity bar.
//
// Merged into the app's Resources by app.mu's `resources: { merge PlexusIcons }`
// directive, so every module's capabilities resolve `Icon = @<Key>` (a
// DynamicResource) against Application.Resources at render time. Painted by a
// Shape/Path with a theme brush — no colour is baked into the geometry.

resources PlexusIcons {
    include "icons/tool-box.svg"                 as ToolBox
    include "icons/project-explorer.svg"         as ProjectExplorer
    include "icons/meta-models.svg"              as MetaModels
    include "icons/libraries.svg"                as Libraries
    include "icons/mcp.svg"                       as Mcp

    // Activity-bar footer action (VSCode-style settings gear).
    include "icons/settings.svg"                 as Settings

    // Agent capability nav glyph + the send affordance for its input.
    include "icons/agent.svg"                    as Agent
    include "icons/arrow-upward.svg"             as ArrowUpward
    // Stop/interrupt — the composer's send button becomes this while a turn runs.
    include "icons/stop.svg"                     as Stop

    // Conversations capability nav glyph (parallel agent chats panel) + the
    // per-row Search / Rename affordances in the conversation manager.
    include "icons/conversations.svg"            as Conversations
    include "icons/search.svg"                   as Search
    include "icons/edit.svg"                     as Edit
    // Approved-tools (persistent tool-approval rules) dialog affordance.
    include "icons/shield.svg"                   as Shield

    // Project Explorer command-bar glyphs (Open / New / New File / Save / Publish).
    include "icons/folder.svg"                   as Folder
    include "icons/new-folder.svg"               as NewFolder
    include "icons/note-add.svg"                 as NoteAdd
    include "icons/upload-file.svg"              as UploadFile
    include "icons/save.svg"                      as Save
    include "icons/save-all.svg"                 as SaveAll
    include "icons/publish.svg"                  as Publish

    // Project-tree leading glyphs, one per ProjectNodeKind (folder reuses
    // @Folder above). Painted as a Shape/Fill by the tree row's leading slot.
    include "icons/diagram.svg"                  as Diagram
    include "icons/todl.svg"                     as Todl
    include "icons/file.svg"                     as File

    // Copy glyph — the Problems popup's copy-all + per-row copy buttons.
    include "icons/copy.svg"                     as Copy
    // Filter-off glyph — the Problems popup's Clear (reset filters) button.
    include "icons/filter-off.svg"               as FilterOff

    // Layout inspector Run + Delete actions.
    include "icons/play.svg"                     as Play
    include "icons/delete.svg"                   as Delete
    // Layout inspector Preview / Apply / Cancel actions.
    include "icons/visibility.svg"               as Visibility
    include "icons/check.svg"                     as Check
    include "icons/close.svg"                     as Close
}
