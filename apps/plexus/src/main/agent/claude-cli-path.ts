// A GUI-launched macOS/Linux app gets a minimal PATH, so append the usual `claude` install dirs.
export function withCliPath(env: NodeJS.ProcessEnv, home: string, platform: NodeJS.Platform): NodeJS.ProcessEnv
{
    if (platform === 'win32') return env
    const extra = [
        `${home}/.local/bin`, `${home}/.claude/local`, `${home}/.npm-global/bin`, `${home}/.volta/bin`,
        '/opt/homebrew/bin', '/usr/local/bin',
    ]
    const current = (env.PATH ?? '').split(':').filter((p) => p !== '')
    const missing = extra.filter((p) => !current.includes(p))
    return { ...env, PATH: [...current, ...missing].join(':') }
}
