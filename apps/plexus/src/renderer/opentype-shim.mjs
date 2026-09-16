// Shim for `import opentype from 'opentype.js'`.
//
// opentype.js's published ESM bundle (dist/opentype.mjs) exposes only named
// exports — no default. mural's runtime imports it as a default
// (`import opentype from 'opentype.js'`), which Node's CJS interop binds but
// a pure-ESM bundler (Vite/Rollup) does not synthesise — hence the build
// error "'default' is not exported by opentype.mjs". This shim re-exports the
// namespace as the default so the default-import form resolves.
//
// electron.vite.config aliases the BARE specifier `opentype.js` to this file
// (regex-anchored), so the deep import below bypasses the alias and reaches
// the real package. Mirrors demo/opentype-shim.mjs.
import * as ot from 'opentype.js/dist/opentype.mjs'
export default ot
