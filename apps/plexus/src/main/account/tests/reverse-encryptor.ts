import type { ITokenEncryptor } from '../desktop-session-store.js'

// A test encryptor whose ciphertext is the reversed text, so a test can tell that nothing was written in the clear.
export class ReverseEncryptor implements ITokenEncryptor
{
    public constructor(public Available = true)
    {
    }

    public IsAvailable(): boolean { return this.Available }
    public Encrypt(plain: string): Buffer { return Buffer.from([...plain].reverse().join('')) }
    public Decrypt(blob: Buffer): string { return [...blob.toString()].reverse().join('') }
}
