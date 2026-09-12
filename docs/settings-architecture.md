# Settings Architecture

An overview of how application settings work across the **mural** framework and the
**Plexus** app. The design splits cleanly: **mural = the settings engine**,
**Plexus = the persistence backend + the settings UI**.

## Big picture

One central service — `ApplicationSettings` (mural) — is the live, bindable aggregate
of every setting. It gathers *definitions* (defaults) from modules and from
`DiagramSettings`, overlays *persisted values* from an injected `ISettingsStore`, and
notifies on change. Plexus plugs in the store (Electron `settings.json` over IPC) and
the settings UI. Everything else reads and writes through that one service.

The seam between the two repos is the `ISettingsStore` interface: mural defines and
calls it; Plexus implements it over Electron.

## The layers

### Engine (mural)

- `Mural/src/framework/shell/services/application-settings-service.ts` — **`ApplicationSettings`**,
  the hub. Holds an `ObservableCollection<Setting>` plus a `_byKey` map; API is
  `Get / Set / Reset / GetSetting / Contribute`. On construction it aggregates module
  `.settings:` definitions, resolves an optional `ISettingsStore`, loads persisted
  values over the defaults, and re-persists on every value change. Serializes
  `SolidColorBrush` ↔ hex string for storage.
- `Mural/src/framework/shell/settings/setting.ts`, `setting-definition.ts` — a
  **`SettingDefinition`** carries `key, label, description, category, kind, default,
  min/max, choices`; a **`Setting`** is the live value (a DP you can bind to).
- `Mural/src/framework/diagram/diagram-settings.ts` — **`DiagramSettings`**, ~70 typed
  static accessors for diagram tunables (`ShapeDefaultSize()`, `ConnectorStrokeWidth()`,
  …). It **stores nothing** — each accessor reads live from `ApplicationSettings`,
  falling back to compiled defaults, with color defaults *theme-linked* (they track
  scheme tokens like `OnSurface` / `Primary` until a user override wins). It
  self-publishes all its definitions to `ApplicationSettings` on first access, and
  exposes `Subscribe()` (the Diagram re-lays out when values change).

### Backend + UI (Plexus)

- `Plexus/src/main/settings.ts` — file persistence at `userData/settings.json`; two IPC
  channels: a **synchronous** get-snapshot (read once at boot) and an **async** save
  (write-through).
- `Plexus/src/preload/index.ts` — snapshots settings synchronously at load, exposes
  `window.api.settings`.
- `Plexus/src/renderer/src/services/settings/settings-store.ts` — **`ElectronSettingsStore`**,
  the `ISettingsStore` impl the renderer registers; `Load()` returns the preloaded
  snapshot, `Save()` fires the async IPC write.
- `Plexus/src/shared/settings-api.ts` — the shared IPC channel/contract definitions.

## The three flows

### Define / default

A setting is declared either in a module's `.settings:` block (e.g.
`SettingDefinition [ Key="diagram.grid.show", Kind=Boolean, Default=true ]` in
`Plexus/src/renderer/src/modules/diagram/diagram.module.mu`) or in `DiagramSettings`'
SPEC arrays. Keys are dot-namespaced (`domain.category.setting`). Defaults live in the
definition; theme-linked colors resolve at read time.

### Read

`DiagramSettings.ShapeDefaultSize()` → `num(key)` → `ApplicationSettings.Get(key)` (with
a compiled fallback). Reads are **live** (no caching), so a change takes effect
immediately for subscribers; theme colors re-resolve on a Light↔Dark swap without
touching persisted values.

### Write / persist

`Set(key, value)` writes the `Setting.Value` DP → a listener fires `persist()` →
converts all values to storable form → `store.Save()` → Electron IPC → `settings.json`.
At boot the reverse runs: main reads the file → preload sync-snapshot → renderer store →
`ApplicationSettings` overlays persisted values onto definition defaults.

Persist is fire-and-forget per change; any debounce would be implicit in the IPC layer
(none is explicit in the store).

## The UI

`Plexus/src/renderer/src/services/settings/settings-page.ts` — **`SettingsPage`** is an
`IDocument` that groups `ApplicationSettings` by `Category` into `SettingsCategory` →
per-`Kind` `SettingRow` subclasses (Boolean / Number / String / Color / Choice /
FilePath).

`Plexus/src/renderer/src/services/settings/settings.resources.mu` maps each Kind to a
control (Switch, SpinEdit, TextBox, BrushPicker, ComboBox, Browse-button). The page is
opened from the footer gear via mural's `SettingsLauncher`
(`Mural/src/framework/shell/settings/settings-launcher.ts`), in a dialog, and wired in
through `ISettingsContribution`
(`Plexus/src/renderer/src/services/settings/settings-contribution.ts`).

Edits bind straight to `Setting.Value`, so they persist live — the page itself is never
"dirty" and its `Save()` is a no-op.

## Scoping — the key limitation

Settings are **global and per-OS-user only**. `ApplicationSettings` is a single
root-registered service; `settings.json` lives under the user's `userData`. There is
**no per-project or per-document scope** — grid size, connector styling, and the
`ShapeDefaultSize` that governs diagram icon sizing all apply app-wide.

If per-project tunables are ever needed, that's a new layer: a `ProjectSettings` service
reading a per-project config and overlaying it on the global defaults — the read path in
`DiagramSettings.num` / `color` is the natural place to consult it.

## Worth knowing

- `DiagramSettings` auto-publishes its ~70 definitions whenever the diagram is used, even
  if the host app shows no settings UI.
- `SettingDefinition.Choices` is currently populated programmatically; declaring option
  lists in `.settings:` markup is a noted follow-up.
- Serialization currently special-cases brushes (↔ hex); other complex value kinds pass
  through as primitives.

## Key files

| Component | Path |
|-----------|------|
| ApplicationSettings service | `Mural/src/framework/shell/services/application-settings-service.ts` |
| Setting / SettingDefinition | `Mural/src/framework/shell/settings/setting.ts`, `setting-definition.ts` |
| DiagramSettings (domain accessors) | `Mural/src/framework/diagram/diagram-settings.ts` |
| Settings launcher (gear → dialog) | `Mural/src/framework/shell/settings/settings-launcher.ts` |
| Main-process persistence | `Plexus/src/main/settings.ts` |
| Preload bridge | `Plexus/src/preload/index.ts` |
| Renderer store adapter | `Plexus/src/renderer/src/services/settings/settings-store.ts` |
| Settings page (UI model) | `Plexus/src/renderer/src/services/settings/settings-page.ts` |
| Settings UI resources | `Plexus/src/renderer/src/services/settings/settings.resources.mu` |
| Settings contribution | `Plexus/src/renderer/src/services/settings/settings-contribution.ts` |
| Shared IPC contracts | `Plexus/src/shared/settings-api.ts` |
| App registration | `Plexus/src/renderer/src/app.mu` |
| Module setting example | `Plexus/src/renderer/src/modules/diagram/diagram.module.mu` |
