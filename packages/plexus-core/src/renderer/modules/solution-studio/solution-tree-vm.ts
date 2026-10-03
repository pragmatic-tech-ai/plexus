import { ObservableCollection } from '@pragmatic-tech-ai/mural/runtime';
import {
    Observable,
    compareStorageEntries,
    type IStorage,
} from '@pragmatic-tech-ai/todl-runtime';
import type { Solution, SolutionMember } from '@pragmatic-tech-ai/todl';

// Resolves the backing storage for a resolved member root (devUI supplies the
// per-member storage via the solution folder + the member's relative path).
export type MemberStorageFor = (member: SolutionMember) => IStorage;

// A file/folder node in the Solution Explorer tree. A directory lazily lists its
// children on first expand (via IStorage.List, folders-first); a file is a leaf
// (Children === undefined). This presentation tree was previously supplied by
// `@pragmatic-tech-ai/todl`; Wave 2 dissolved that layer, so the (UI-band) tree
// now lives here, built over the surviving SolutionMember/Solution engine types.
export class SolutionNodeVM extends Observable
{
    public readonly Title: string;
    public readonly IsDirectory: boolean;
    public readonly Children: ObservableCollection<SolutionNodeVM> | undefined;
    private readonly storage: IStorage;
    private readonly path: string;
    private loaded = false;

    constructor(storage: IStorage, path: string, title: string, isDirectory: boolean)
    {
        super();
        this.storage = storage;
        this.path = path;
        this.Title = title;
        this.IsDirectory = isDirectory;
        this.Children = isDirectory ? new ObservableCollection<SolutionNodeVM>() : undefined;
    }

    // One-shot lazy load of this directory's children.
    public async OnExpand(): Promise<void>
    {
        if (!this.IsDirectory || this.loaded) return;
        this.loaded = true;
        await SolutionNodeVM.Populate(this.storage, this.path, this.Children!);
    }

    // List `dir` in `storage` (folders-first) and append a child node per entry.
    public static async Populate(storage: IStorage, dir: string, into: ObservableCollection<SolutionNodeVM>): Promise<void>
    {
        const entries = [...await storage.List(dir)].sort(compareStorageEntries);
        for (const e of entries)
        {
            const childPath = dir === '' ? e.Name : `${dir}/${e.Name}`;
            into.Add(new SolutionNodeVM(storage, childPath, e.Name, e.IsDirectory));
        }
    }
}

// A member-project root row in the Solution Explorer. Resolved members expand to
// their folder structure; an unresolved member (no registered factory) shows as a
// leaf with IsResolved === false and never expands.
export class SolutionMemberNodeVM extends Observable
{
    public readonly Member: SolutionMember;
    public readonly Children: ObservableCollection<SolutionNodeVM> | undefined;
    private readonly storage: IStorage | undefined;
    private loaded = false;

    constructor(member: SolutionMember, storage: IStorage | undefined)
    {
        super();
        this.Member = member;
        this.storage = member.IsResolved ? storage : undefined;
        this.Children = this.storage !== undefined ? new ObservableCollection<SolutionNodeVM>() : undefined;
    }

    public get Title(): string
    {
        return this.Member.Title;
    }

    public get IsResolved(): boolean
    {
        return this.Member.IsResolved;
    }

    public async OnExpand(): Promise<void>
    {
        if (this.storage === undefined || this.loaded) return;
        this.loaded = true;
        await SolutionNodeVM.Populate(this.storage, '', this.Children!);
    }
}

// The Solution Explorer root: one member row per session member.
export class SolutionTreeVM extends Observable
{
    public readonly Roots = new ObservableCollection<SolutionMemberNodeVM>();

    constructor(session: Solution, storageFor: MemberStorageFor)
    {
        super();
        for (const member of session.Members)
        {
            const storage = member.IsResolved ? storageFor(member) : undefined;
            this.Roots.Add(new SolutionMemberNodeVM(member, storage));
        }
    }
}
