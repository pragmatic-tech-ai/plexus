// ChatStore — persists restorable conversations to a plain JSON array at
// <UserDataDirectory>/conversations.json (through FileSystemService, no new IPC),
// mirroring OpenProjectsStore. ChatSessionsService upserts a conversation only when
// the provider can resume it (Resumable && ResumeToken), so non-resumable chats are
// never written.
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { EnvironmentService } from '../../../services/environment/environment-service.js'
import { FileSystemService } from '../../../services/file-system/file-system-service.js'
import type { SerializedMessage } from './transcript-serializer.js'

export interface StoredConversation
{
    Id: string
    Title: string
    Transcript: SerializedMessage[]
    ResumeToken: string
    // The working directory the CLI session was created under. The backend keys its
    // resumable session store BY cwd, so `--resume` only finds the conversation when
    // spawned at this exact directory — resuming with the (volatile) current
    // workspace cwd instead fails with "No conversation found". Persisted so restore
    // is deterministic regardless of which projects are open. Older records without
    // it read as '' (→ the caller falls back to the current cwd).
    Cwd: string
    // Epoch ms of the last activity (set on every Upsert). Drives the "12h / 2d"
    // relative-time label in the Conversations list. Records written before this
    // field existed parse as 0 (normalised on read) → no time label.
    UpdatedAt: number
}

export class ChatStore extends ServiceBase
{
    public static readonly Key = new ServiceKey<ChatStore>('ChatStore')
    private static readonly FileName = 'conversations.json'

    // In-memory mirror of the persisted list, lazily loaded on first List().
    private records: StoredConversation[] | null = null

    constructor(provider: IServiceProvider) { super(provider) }

    private get fs(): FileSystemService { return this.Provider.getRequired(FileSystemService.Key) }
    private get env(): EnvironmentService { return this.Provider.getRequired(EnvironmentService.Key) }
    private get filePath(): string { return join(this.env.UserDataDirectory, ChatStore.FileName) }

    // The stored conversations. Loads the file into the mirror once (subsequent
    // calls return the mirror). Tolerates a missing/corrupt file → [].
    public async List(): Promise<readonly StoredConversation[]>
    {
        if (this.records !== null) return this.records
        try {
            if (!(await this.fs.Exists(this.filePath))) { this.records = []; return this.records }
            const parsed = JSON.parse(await this.fs.ReadText(this.filePath))
            this.records = Array.isArray(parsed) ? (parsed as StoredConversation[]).map(normalize) : []
        } catch { this.records = [] }
        return this.records
    }

    // Insert or replace by id.
    public async Upsert(rec: StoredConversation): Promise<void>
    {
        const list = [...await this.List()]
        const i = list.findIndex((r) => r.Id === rec.Id)
        if (i >= 0) list[i] = rec; else list.push(rec)
        this.records = list
        await this.write(list)
    }

    public async Remove(id: string): Promise<void>
    {
        const list = (await this.List()).filter((r) => r.Id !== id)
        this.records = list
        await this.write(list)
    }

    private write(list: readonly StoredConversation[]): Promise<void>
    {
        return this.fs.WriteText(this.filePath, JSON.stringify(list, null, 2))
    }
}

// Back-fill fields added after records were first written: UpdatedAt (0 → no
// time label) and Cwd ('' → the caller resumes at the current cwd).
function normalize(rec: StoredConversation): StoredConversation
{
    return {
        ...rec,
        UpdatedAt: typeof rec.UpdatedAt === 'number' ? rec.UpdatedAt : 0,
        Cwd: typeof rec.Cwd === 'string' ? rec.Cwd : '',
    }
}

// Join with the directory's own separator (no node:path in the renderer). Copied
// from OpenProjectsStore.
function join(dir: string, name: string): string
{
    const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
    return dir.endsWith(sep) ? dir + name : dir + sep + name
}
