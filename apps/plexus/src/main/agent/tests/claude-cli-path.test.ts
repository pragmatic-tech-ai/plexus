import { test, expect } from 'vitest'
import { withCliPath } from '../claude-cli-path.js'

test('appends the usual claude install dirs to a minimal macOS PATH', () => {
    const env = withCliPath({ PATH: '/usr/bin:/bin' }, '/Users/me', 'darwin')
    expect(env.PATH).toBe('/usr/bin:/bin:/Users/me/.local/bin:/Users/me/.claude/local:/Users/me/.npm-global/bin:/Users/me/.volta/bin:/opt/homebrew/bin:/usr/local/bin')
})

test('keeps existing entries first and does not duplicate dirs already present', () => {
    const env = withCliPath({ PATH: '/opt/homebrew/bin:/usr/bin' }, '/Users/me', 'linux')
    expect(env.PATH!.startsWith('/opt/homebrew/bin:/usr/bin:')).toBe(true)
    expect(env.PATH!.split(':').filter((p) => p === '/opt/homebrew/bin')).toHaveLength(1)
})

test('leaves the environment untouched on Windows', () => {
    const env = { PATH: 'C:\\Windows' }
    expect(withCliPath(env, 'C:\\Users\\me', 'win32')).toBe(env)
})
