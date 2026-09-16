import { test, expect } from 'vitest'
import { ApprovalRuleRow, ApprovalRulesVM, type ApprovalRulesPort } from '../approval-rules.js'
import type { ApprovalRule } from '../../../../../../shared/agent-api.js'

function sameRule(a: ApprovalRule, b: ApprovalRule): boolean {
    return a.tool === b.tool && (a.prefix ?? '') === (b.prefix ?? '')
}

test('a row labels tool+prefix and its RevokeCommand calls back with the rule', () => {
    const seen: ApprovalRule[] = []
    const row = new ApprovalRuleRow({ tool: 'Bash', prefix: 'npm' }, (r) => seen.push(r))
    expect(row.Label).toBe('Bash: npm')
    row.RevokeCommand.Execute(undefined)
    expect(seen).toEqual([{ tool: 'Bash', prefix: 'npm' }])
})

test('a prefix-less rule labels the tool alone', () => {
    const row = new ApprovalRuleRow({ tool: 'WebFetch' }, () => {})
    expect(row.Label).toBe('WebFetch')
})

test('Refresh lists the port rules; Revoke calls the port and drops the row', async () => {
    let rules: ApprovalRule[] = [{ tool: 'Bash', prefix: 'python' }, { tool: 'WebFetch' }]
    const revoked: Array<{ key: string; rule: ApprovalRule }> = []
    const port: ApprovalRulesPort = {
        list: () => Promise.resolve([...rules]),
        revoke: (key, rule) => {
            revoked.push({ key, rule })
            rules = rules.filter((r) => !sameRule(r, rule))
            return Promise.resolve()
        },
    }
    const vm = new ApprovalRulesVM(port, () => '/proj')
    await vm.Refresh()
    expect(vm.Rules.Count).toBe(2)
    expect(vm.HasRules).toBe(true)

    await vm.Revoke({ tool: 'Bash', prefix: 'python' })
    expect(revoked).toEqual([{ key: '/proj', rule: { tool: 'Bash', prefix: 'python' } }])
    expect(vm.Rules.Count).toBe(1)
    expect([...vm.Rules][0]!.Label).toBe('WebFetch')
})

test('HasRules is false when the project has no rules', async () => {
    const port: ApprovalRulesPort = { list: () => Promise.resolve([]), revoke: () => Promise.resolve() }
    const vm = new ApprovalRulesVM(port, () => '/empty')
    await vm.Refresh()
    expect(vm.Rules.Count).toBe(0)
    expect(vm.HasRules).toBe(false)
})
