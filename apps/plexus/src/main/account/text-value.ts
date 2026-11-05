// Shape checks shared by the account readers that take untyped JSON.
export class TextValue
{
    // A non-empty string.
    public static Filled(value: unknown): value is string
    {
        return typeof value === 'string' && value !== ''
    }
}
