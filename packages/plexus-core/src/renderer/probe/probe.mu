// Probe: proves a plexus-core .mu compiles and imports across the package
// boundary. A harmless keyed Border (nothing resolves this key, so merging it
// applies nothing) — deliberately NOT a type-targeted Style, which would restyle
// the host app. Removed once Phase B lands real shared resources.
resources ProbeResources {
    Border x:key="CoreProbe" [ Height = 1, Fill = @Surface ]
}
