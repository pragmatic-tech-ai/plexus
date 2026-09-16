// Re-export the compiled probe resource dictionary (a ResourceDictionary
// subclass with a static Clone()) so consumers import a stable JS entry, never
// the .mu directly.
export { ProbeResources } from './probe.mu.js'
