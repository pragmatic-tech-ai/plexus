import { defineConfig } from 'vitest/config'

// Unit tests only. mural-framework/.mu integration is verified via typecheck,
// compile:mu, and manual `npm run dev`, not Vitest.
//
// @pragmatic-tech-ai/* are EXTERNALIZED (not inlined): Node's native ESM loader
// resolves each package's `import.default` → ./dist/*.js (the "development"
// condition is not active under Node, so src is never touched) AND handles
// mural's internal circular imports via live bindings. Inlining them through
// Vite's transform instead broke those circular bindings once npm workspaces
// hoisted the packages to the repo root ("Class extends undefined" at init).
const CONDITIONS = ['import', 'module', 'browser', 'default']

export default defineConfig({
    resolve: { conditions: CONDITIONS },
    ssr: { resolve: { conditions: CONDITIONS } },
    test: {
        include: ['src/**/*.test.ts'],
        environment: 'node',
    },
})
