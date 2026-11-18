// The one safety check for solution-relative upload paths, shared by the renderer-side enumerator and
// the main-process IPC trust boundary. Refuses a leading separator (absolute path), a '..' segment, any
// segment containing ':' (drive letter) and control characters; backslashes are separators.
export class UploadPathGuard
{
    private static readonly Separator = '/'
    private static readonly CurrentDir = '.'
    private static readonly SeparatorPattern = /[\\/]+/
    private static readonly LeadingSeparator = /^[\\/]/
    private static readonly ControlChars = /[\u0000-\u001f\u007f]/
    private static readonly Backslash = '\\'
    private static readonly ParentSegment = '..'
    private static readonly DriveMarker = ':'
    private static readonly UnsafePath = 'Refusing to upload an unsafe path: '

    // '' for the solution root itself, else 'member/path/'. Backslashes are treated as separators.
    public static Prefix(memberPath: string): string
    {
        const parts = UploadPathGuard.Segments(memberPath)
        return parts.length === 0 ? '' : parts.join(UploadPathGuard.Separator) + UploadPathGuard.Separator
    }

    // A file path: POSIX segments only; same rules as Prefix, and no backslash at all.
    public static Clean(path: string): string
    {
        if (path.includes(UploadPathGuard.Backslash)) throw new Error(UploadPathGuard.UnsafePath + path)
        return UploadPathGuard.Segments(path).join(UploadPathGuard.Separator)
    }

    // Splits on either separator, drops empty and '.' segments, and refuses the unsafe shapes above.
    public static Segments(path: string): string[]
    {
        if (UploadPathGuard.LeadingSeparator.test(path) || UploadPathGuard.ControlChars.test(path)) throw new Error(UploadPathGuard.UnsafePath + path)
        const parts = path.split(UploadPathGuard.SeparatorPattern).filter((s) => s !== '' && s !== UploadPathGuard.CurrentDir)
        if (parts.some((s) => s === UploadPathGuard.ParentSegment || s.includes(UploadPathGuard.DriveMarker))) throw new Error(UploadPathGuard.UnsafePath + path)
        return parts
    }
}
