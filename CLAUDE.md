# CLAUDE.md

Plexus — a diagram editor built on mural, packaged as an Electron desktop app
(electron-vite). Consumes `@pragmatic-tech-ai/mural` and `@pragmatic-tech-ai/fresco` from
GitHub Packages (`https://npm.pkg.github.com`, auth via `${PACKAGES_TOKEN}` in the
gitignored `.npmrc`); no relative `../src` imports into the framework.

## Work tracking

All work — tasks, features, bugs, and design notes — is tracked in the GitHub
Project **Architecture Agentic Suite** (org `pragmatic-tech-ai`, project number
`1`). Work descriptions, backlogs, and TODO lists are **not** stored in local
files anymore. Read and update the backlog with the `gh` CLI:

- List items: `gh project item-list 1 --owner pragmatic-tech-ai`
- Add an item: `gh project item-create 1 --owner pragmatic-tech-ai --title "…" --body "…"`

When you finish or pick up work, reflect it in the Project rather than a local
note.

**Specs & plans too.** Design specs and implementation plans (superpowers
`brainstorming` / `writing-plans` output) live in the Project, not under
`docs/superpowers/`. Create each as an item with the **Kind** field
(`PVTSSF_lADOE0Zc984Biu4ozhhmtQM`) set to `Spec` or `Plan`. The CLI `--body`
overflows Windows' arg limit on large docs — create via GraphQL, reading the
body from a file:
`gh api graphql -f query='mutation($p:ID!,$t:String!,$b:String!){addProjectV2DraftIssue(input:{projectId:$p,title:$t,body:$b}){projectItem{id}}}' -f p=PVT_kwDOE0Zc984Biu4o -f t="[Repo] title" -F b=@file.md`.

## Testing

- **Every test file lives in a `tests/` subfolder next to the code it
  exercises** — `src/main/agent/tests/agent-session.test.ts`, never
  `src/main/agent/agent-session.test.ts`. Vitest globs `src/**/*.test.ts` either
  way (see `vitest.config.ts`), so this is organizational: keep source
  directories free of test files.
