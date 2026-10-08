// Bundler wire contract — the html-bundle esbuild bundle runs in the Electron main
// process; the renderer resolves IBundler to an IpcBundler that invokes this channel.
// BundleAppRequest / BundleAppResult are plain todl types (plain-serializable), imported
// directly where used, so they cross IPC unchanged.

export enum BundleChannel
{
    Bundle = 'bundle:app',
}
