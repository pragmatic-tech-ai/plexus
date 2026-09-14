import { ServiceBase, ServiceKey, RelayCommand, type ICommand, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DialogService } from '@pragmatic-tech-ai/mural/framework'
import { SkillScope } from '../../../../../shared/skill-api.js'
import { FileSystemService } from '../../../services/file-system/file-system-service.js'
import { EnvironmentService } from '../../../services/environment/environment-service.js'
import { OpenProjectsStore } from '../../../services/projects/open-projects-store.js'
import { CodeEditorService } from '../../code-editor/code-editor-service.js'
import { SkillCatalog } from './skill-catalog.js'
import type { Skill } from './skill.js'
import { SkillFileCodec } from './skill-file-codec.js'
import { SkillValidator } from './skill-validator.js'
import { SkillEditSession, type EditBuffer } from './skill-edit-session.js'
import { SkillScaffolder, type NewSkillRequest, type ScaffoldFs } from './skill-scaffolder.js'
import { SkillNewFormVm, SkillNewDialogVm } from './skill-new-dialog.js'
import { SkillListItemVm } from './skill-list-item.js'

// Collaborators the authoring service needs, injected for testing; production is
// built from the provider in buildDeps.
export interface AuthoringDeps {
    skills(): readonly Skill[]
    discover(): Promise<void>
    openBuffer(path: string): EditBuffer
    presentNewSkillDialog(defaultScope: SkillScope): Promise<NewSkillRequest | undefined>
    scaffold(req: NewSkillRequest): Promise<string>
}

// The "Skills" capability nav service. Lists the catalog (search-filtered), opens a
// SkillEditSession for the selected skill (form ⇄ the same Monaco buffer), and
// scaffolds new skills via ＋New. Save persists the shared buffer.
export class SkillAuthoringService extends ServiceBase {
    public static readonly Key = new ServiceKey<SkillAuthoringService>('SkillAuthoringService')

    private readonly deps: AuthoringDeps
    private readonly codec = new SkillFileCodec()
    private readonly validator = new SkillValidator()
    private _session: SkillEditSession | undefined
    private _search = ''
    private readonly _new: RelayCommand
    private readonly _save: RelayCommand
    private readonly _refresh: RelayCommand

    constructor(provider: IServiceProvider, deps?: AuthoringDeps) {
        super(provider)
        this.deps = deps ?? this.buildDeps()
        this._new = new RelayCommand(() => { void this.New() })
        this._save = new RelayCommand(() => { void this._session?.save() }, () => this.canSave())
        this._refresh = new RelayCommand(() => { void this.Refresh() })
    }

    // The catalog, filtered by the current search text (name/title/description).
    get Skills(): readonly Skill[] {
        const q = this._search.trim().toLowerCase()
        const all = this.deps.skills()
        if (q === '') return all
        return all.filter(s => [s.Name, s.Title, s.Description].some(f => f.toLowerCase().includes(q)))
    }

    // The list rows the panel binds — each wraps a Skill with a SelectCommand.
    get Items(): SkillListItemVm[] { return this.Skills.map(s => new SkillListItemVm(s, sk => this.Select(sk))) }
    get IsEmpty(): boolean { return this.Skills.length === 0 }

    get SearchText(): string { return this._search }
    set SearchText(v: string) { if (v === this._search) return; this._search = v; this.notifyList() }

    get Session(): SkillEditSession | undefined { return this._session }
    get HasSession(): boolean { return this._session !== undefined }
    get NewCommand(): ICommand { return this._new }
    get SaveCommand(): ICommand { return this._save }
    get RefreshCommand(): ICommand { return this._refresh }

    // Open the selected skill: bind the frontmatter form to its (shared) SKILL.md buffer.
    Select(skill: Skill): void {
        const buffer = this.deps.openBuffer(this.skillMdPath(skill))
        const prev = this._session
        this._session = new SkillEditSession(skill, buffer, this.codec, this.validator)
        this.RaisePropertyChanged('Session', prev, this._session)
        this.RaisePropertyChanged('HasSession', prev !== undefined, true)
        this._save.RaiseCanExecuteChanged()
    }

    Refresh(): Promise<void> {
        return this.deps.discover().then(() => this.notifyList())
    }

    private notifyList(): void {
        this.RaisePropertyChanged('Skills', undefined, this.Skills)
        this.RaisePropertyChanged('Items', undefined, this.Items)
        this.RaisePropertyChanged('IsEmpty', undefined, this.IsEmpty)
    }

    // The ＋New flow (public so it is awaitable; the NewCommand delegates here).
    async New(): Promise<void> {
        const req = await this.deps.presentNewSkillDialog(SkillScope.Project)
        if (req === undefined) return
        const folder = await this.deps.scaffold(req)
        await this.deps.discover()
        this.notifyList()
        const created = this.deps.skills().find(s => s.Descriptor.folderPath === folder)
        if (created !== undefined) this.Select(created)
    }

    private canSave(): boolean { return this._session !== undefined && !this._session.IsReadOnly }

    private skillMdPath(skill: Skill): string {
        const dir = skill.Descriptor.folderPath
        return dir.endsWith('/') || dir.endsWith('\\') ? `${dir}SKILL.md` : `${dir}/SKILL.md`
    }

    // ── Production wiring ───────────────────────────────────────────────
    private buildDeps(): AuthoringDeps {
        return {
            skills: () => this.catalog().All,
            discover: () => this.catalog().discover(this.projectDir()),
            openBuffer: (path) => this.editor().OpenAndGet(path),
            presentNewSkillDialog: (defaultScope) => this.presentNewDialog(defaultScope),
            scaffold: (req) => new SkillScaffolder(this.scaffoldFs(), { projectDir: this.projectDir(), homeDir: this.env().HomeDirectory }).create(req),
        }
    }

    private async presentNewDialog(defaultScope: SkillScope): Promise<NewSkillRequest | undefined> {
        const dialogs = this.Provider.get(DialogService.Key)
        if (dialogs === undefined) return undefined
        const form = new SkillNewFormVm(defaultScope, (r) => dialogs.Close(r))
        const dialog = new SkillNewDialogVm(form)
        const result = await dialogs.Show<NewSkillRequest | undefined>({ Title: 'New Skill', Content: dialog, Width: 440 })
        return result ?? undefined
    }

    // The panel is project-agnostic; scope skills to the first open project (or the
    // app cwd when none is open). v1 limitation: a multi-project workspace surfaces
    // the first project's `.claude/skills` alongside global + packaged.
    private projectDir(): string {
        return this.Provider.get(OpenProjectsStore.Key)?.Current()[0] ?? this.env().CurrentDirectory
    }

    private scaffoldFs(): ScaffoldFs {
        const fs = this.fs()
        return { exists: (p) => fs.Exists(p), createDirectory: (p) => fs.CreateDirectory(p), writeText: (p, c) => fs.WriteText(p, c) }
    }

    private catalog(): SkillCatalog { return this.Provider.getRequired(SkillCatalog.Key) }
    private editor(): CodeEditorService { return this.Provider.getRequired(CodeEditorService.Key) }
    private env(): EnvironmentService { return this.Provider.getRequired(EnvironmentService.Key) }
    private fs(): FileSystemService { return this.Provider.getRequired(FileSystemService.Key) }
}
