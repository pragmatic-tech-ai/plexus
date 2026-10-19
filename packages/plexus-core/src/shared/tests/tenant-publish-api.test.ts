import { describe, it, expect } from 'vitest'
import { TenantServerUrl } from '../tenant-publish-api.js'

describe('TenantServerUrl.Validate', () =>
{
    it('accepts wss and https hosts and trims', () =>
    {
        expect(TenantServerUrl.Validate(' wss://srv.example.com/ws ')).toBe('wss://srv.example.com/ws')
        expect(TenantServerUrl.Validate('https://srv.example.com')).toBe('https://srv.example.com')
    })

    it('allows cleartext only for loopback hosts', () =>
    {
        expect(TenantServerUrl.Validate('ws://localhost:8080')).toBe('ws://localhost:8080')
        expect(TenantServerUrl.Validate('ws://127.0.0.1:8080')).toBe('ws://127.0.0.1:8080')
        expect(() => TenantServerUrl.Validate('ws://srv.example.com')).toThrow(/cleartext/)
        expect(() => TenantServerUrl.Validate('http://srv.example.com')).toThrow(/cleartext/)
    })

    it('rejects malformed URLs and other schemes', () =>
    {
        expect(() => TenantServerUrl.Validate('not a url')).toThrow(/not a valid URL/)
        expect(() => TenantServerUrl.Validate('ftp://srv.example.com')).toThrow(/wss/)
    })
})
