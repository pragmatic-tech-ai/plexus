// The shared theming subsystem for the Plexus suite. Theme activation itself is
// intrinsically bound to the Application (ThemeManager merges the theme into
// Application.current.Resources), so each app declares its theme in its own app.mu
// (`Application [ Theme = Material, Scheme = MaterialDark ]`) — the only valid
// activation point. What IS shareable is the colour-scheme picker; both apps
// register it through ThemeSchemePicker so it looks and behaves identically.
export { ThemeSchemePicker } from './theme-scheme-picker.js'
