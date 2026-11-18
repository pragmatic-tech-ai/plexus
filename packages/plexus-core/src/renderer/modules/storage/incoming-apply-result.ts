// Outcome of applying an incoming remote change to an open buffer (see ITrackedDocument).
export enum IncomingApplyResult
{
    // The buffer was clean at apply time and now holds the server content.
    Applied = 'applied',
    // Server content equals the buffer's last-saved content (an own-write echo): nothing to do.
    Unchanged = 'unchanged',
    // The buffer was dirty when the content arrived: left untouched.
    DirtySkipped = 'dirty-skipped',
}
