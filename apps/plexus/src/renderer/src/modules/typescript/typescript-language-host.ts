import * as monaco from 'monaco-editor'
import { CanonicalTypeScriptOptions, type CanonicalCompilerOptions } from '@pragmatic-tech-ai/todl/build-system-core'
import { FrameworkTypings } from './framework-typings.generated.js'

// One-time configuration of Monaco's BUILT-IN TypeScript language (no custom
// language registration): applies the canonical compiler options to the worker and
// loads the bundled framework .d.ts as ambient extraLibs so bare-specifier imports
// ("@pragmatic-tech-ai/mural", ...) resolve in the editor. Called once at bootstrap.
export class TypeScriptLanguageHost
{
    private static readonly LoadFailureMessage = '[typescript] failed to load framework typing'

    // Monaco's ModuleResolutionKind enum omits Bundler, but its bundled TypeScript
    // worker (>= 5.0) understands the raw value, so canonical "Bundler" maps to it.
    private static readonly BundlerResolutionKind = 100
    private static readonly BundlerName = 'Bundler'

    private static readonly LibPrefix = 'lib.'
    private static readonly LibSuffix = '.d.ts'

    private static configured = false

    public static Configure(): void
    {
        if (TypeScriptLanguageHost.configured) return
        TypeScriptLanguageHost.configured = true

        const defaults = monaco.typescript.typescriptDefaults
        defaults.setCompilerOptions(TypeScriptLanguageHost.MonacoOptions(CanonicalTypeScriptOptions))
        defaults.setEagerModelSync(true)
        for (const entry of FrameworkTypings)
        {
            try
            {
                defaults.addExtraLib(entry.Content, entry.FilePath)
            }
            catch (err)
            {
                console.warn(TypeScriptLanguageHost.LoadFailureMessage, entry.FilePath, err)
            }
        }
    }

    // Pure map of the dependency-free canonical strings to Monaco's enum values.
    public static MonacoOptions(canonical: CanonicalCompilerOptions): monaco.typescript.CompilerOptions
    {
        const ts = monaco.typescript
        return {
            target: ts.ScriptTarget[canonical.Target as keyof typeof ts.ScriptTarget] ?? ts.ScriptTarget.ES2020,
            module: ts.ModuleKind[canonical.Module as keyof typeof ts.ModuleKind] ?? ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind[canonical.ModuleResolution as keyof typeof ts.ModuleResolutionKind]
                ?? (canonical.ModuleResolution === TypeScriptLanguageHost.BundlerName
                    ? TypeScriptLanguageHost.BundlerResolutionKind
                    : ts.ModuleResolutionKind.NodeJs),
            jsx: ts.JsxEmit[canonical.Jsx as keyof typeof ts.JsxEmit] ?? ts.JsxEmit.Preserve,
            // tsc file-name form (same as the build gate); bare names load no standard lib.
            lib: canonical.Lib.map((l) => `${TypeScriptLanguageHost.LibPrefix}${l.toLowerCase()}${TypeScriptLanguageHost.LibSuffix}`),
            strict: canonical.Strict,
            noEmit: canonical.NoEmit,
            skipLibCheck: canonical.SkipLibCheck,
            esModuleInterop: canonical.EsModuleInterop,
            allowNonTsExtensions: true,
        }
    }
}
