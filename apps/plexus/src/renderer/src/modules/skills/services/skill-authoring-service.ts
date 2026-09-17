import { ServiceBase, ServiceKey, RelayCommand, type ICommand, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DialogService } from '@pragmatic-tech-ai/mural/framework'
import { SkillScope } from '../../../../../shared/skill-api.js'
import { FileSystemService } from '@pragmatic-tech-ai/plexus-core/renderer/file-system-storage'
import { EnvironmentService } from '@pragmatic-tech-ai/plexus-core/renderer/environment/environment-service.js'
import { OpenProjectsStore } from '@pragmatic-tech-ai/plexus-core/renderer/projects/open-projects-store.js'
import { CodeEditorService } from '../../code-editor/code-editor-service.js'
import { SkillCatalog } from './skill-catalog.js'
import { SkillRunner } from './skill-runner.js'
import type { Skill } from './skill.js'
import { SkillFileCodec } from './skill-file-codec.js'
import { SkillValidator } from './skill-validator.js'
import { SkillEditSession, type EditBuffer } from './skill-edit-session.js'
import { SkillScaffolder, type NewSkillRequest, type ScaffoldFs } from './skill-scaffolder.js'
import { SkillNewFormVm, SkillNewDialogVm, ProjectChoice } from './skill-new-dialog.js'
import { SkillListItemVm } from './skill-list-item.js'
import { SkillGroupVm } from './skill-group.js'

// Collaborators the authoring service needs, injected for testing; production is
// built from the provider in buildDeps.
export interface AuthoringDeps {
    skills(): readonly Skill[]
    openProjectDirs(): readonly string[]
    discover(): Promise<void>
    openBuffer(path: string): EditBuffer
    presentNewSkillDialog(defaultScope: SkillScope): Promise<NewSkillRequest | undefined>
    scaffold(req: NewSkillRequest): Promise<string>
    run(skill: Skill, projectDir: string, projectName: string): Promise<void>
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
    private _selected: Skill | undefined
    private _search = ''
    private readonly _new: RelayCommand
    private readonly _save: RelayCommand
    private readonly _refresh: RelayCommand
    private readonly _run: RelayCommand

    constructor(provider: IServiceProvider, deps?: AuthoringDeps) {
        super(provider)
        this.deps = deps ?? this.buildDeps()
        this._new = new RelayCommand(() => { void this.New() })
        this._save = new RelayCommand(() => { void this._session?.save() }, () => this.canSave())
        this._refresh = new RelayCommand(() => { void this.Refresh() })
        this._run = new RelayCommand(() => { void this.Run() }, () => this.canRun())
        // Production only (deps supplied ⇒ a test): re-discover when a project opens
        // or closes so the grouped list tracks the live workspace.
        if (deps === undefined) this.Provider.get(OpenProjectsStore.Key)?.Subscribe(() => { void this.Refresh() })
    }

    // The catalog, filtered by the current search text (name/title/description).
    get Skills(): readonly Skill[] {
        const q = this._search.trim().toLowerCase()
        const all = this.deps.skills()
        if (q === '') return all
        return all.filter(s => [s.Name, s.Title, s.Description].some(f => f.toLowerCase().includes(q)))
    }

    // The panel binds Groups: one section per open project (in open order, headed by
    // the folder name), then Global, then Packaged. Search filters within groups;
    // empty groups are omitted. Project-scoped skills sort under their origin project.
    get Groups(): SkillGroupVm[] {
        const skills = this.Skills
        const groups: SkillGroupVm[] = []
        for (const dir of this.deps.openProjectDirs()) {
            const items = this.rowsFor(skills.filter(s => s.IsProjectScoped && s.OriginProjectPath === dir))
            if (items.length > 0) groups.push(new SkillGroupVm(this.basename(dir), items))
        }
        const global = this.rowsFor(skills.filter(s => s.Scope === SkillScope.Global))
        if (global.length > 0) groups.push(new SkillGroupVm('Global', global))
        const packaged = this.rowsFor(skills.filter(s => s.Scope === SkillScope.Packaged))
        if (packaged.length > 0) groups.push(new SkillGroupVm('Packaged', packaged))
        return groups
    }

    get IsEmpty(): boolean { return this.Skills.length === 0 }

    private rowsFor(skills: readonly Skill[]): SkillListItemVm[] {
        return skills.map(s => new SkillListItemVm(s, sk => this.Select(sk)))
    }

    // Last path segment for a group header, tolerant of either separator.
    private basename(path: string): string {
        const trimmed = path.replace(/[/\\]+$/, '')
        const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
        return cut >= 0 ? trimmed.slice(cut + 1) : trimmed
    }

    get SearchText(): string { return this._search }
    set SearchText(v: string) { if (v === this._search) return; this._search = v; this.notifyList() }

    get Session(): SkillEditSession | undefined { return this._session }
    get HasSession(): boolean { return this._session !== undefined }
    get NewCommand(): ICommand { return this._new }
    get SaveCommand(): ICommand { return this._save }
    get RefreshCommand(): ICommand { return this._refresh }
    get RunCommand(): ICommand { return this._run }

    // Open the selected skill: bind the frontmatter form to its (shared) SKILL.md buffer.
    Select(skill: Skill): void {
        const buffer = this.deps.openBuffer(this.skillMdPath(skill))
        const prev = this._session
        this._session = new SkillEditSession(skill, buffer, this.codec, this.validator)
        this._selected = skill
        this.RaisePropertyChanged('Session', prev, this._session)
        this.RaisePropertyChanged('HasSession', prev !== undefined, true)
        this._save.RaiseCanExecuteChanged()
        this._run.RaiseCanExecuteChanged()
    }

    // Run the selected skill (public so it is awaitable; RunCommand delegates here).
    // A project skill runs against its origin project; global/packaged skills run
    // against the active (first open) project. No target ⇒ no-op.
    async Run(): Promise<void> {
        const skill = this._selected
        if (skill === undefined) return
        const dir = this.runTargetDir(skill)
        if (dir === undefined) return
        await this.deps.run(skill, dir, this.basename(dir))
    }

    Refresh(): Promise<void> {
        return this.deps.discover().then(() => this.notifyList())
    }

    private notifyList(): void {
        this.RaisePropertyChanged('Skills', undefined, this.Skills)
        this.RaisePropertyChanged('Groups', undefined, this.Groups)
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

    // Run is enabled once a skill is selected and a target project can be resolved
    // (its origin, or an open project for global/packaged skills).
    private canRun(): boolean { return this._selected !== undefined && this.runTargetDir(this._selected) !== undefined }

    // A project skill's own project; otherwise the active (first open) project.
    private runTargetDir(skill: Skill): string | undefined {
        return skill.OriginProjectPath ?? this.deps.openProjectDirs()[0]
    }

    private skillMdPath(skill: Skill): string {
        const dir = skill.Descriptor.folderPath
        return dir.endsWith('/') || dir.endsWith('\\') ? `${dir}SKILL.md` : `${dir}/SKILL.md`
    }

    // ── Production wiring ───────────────────────────────────────────────
    private buildDeps(): AuthoringDeps {
        return {
            skills: () => this.catalog().All,
            openProjectDirs: () => this.openProjectDirs(),
            discover: () => this.catalog().discoverAll(this.projectDirs()),
            openBuffer: (path) => this.editor().OpenAndGet(path),
            presentNewSkillDialog: (defaultScope) => this.presentNewDialog(defaultScope),
            scaffold: (req) => new SkillScaffolder(this.scaffoldFs(), { projectDir: req.projectDir ?? this.projectDirs()[0], homeDir: this.env().HomeDirectory }).create(req),
            run: (skill, dir, name) => this.runner().run(skill, dir, name),
        }
    }

    private async presentNewDialog(defaultScope: SkillScope): Promise<NewSkillRequest | undefined> {
        const dialogs = this.Provider.get(DialogService.Key)
        if (dialogs === undefined) return undefined
        const choices = this.openProjectDirs().map(d => new ProjectChoice(this.basename(d), d))
        const form = new SkillNewFormVm(defaultScope, choices, (r) => dialogs.Close(r))
        const dialog = new SkillNewDialogVm(form)
        const result = await dialogs.Show<NewSkillRequest | undefined>({ Title: 'New Skill', Content: dialog, Width: 440 })
        return result ?? undefined
    }

    // The open projects the panel groups and scaffolds into. Empty when no project
    // is open — grouping shows only Global/Packaged, and discovery/scaffold fall back
    // to the app cwd (projectDirs()).
    private openProjectDirs(): readonly string[] {
        return this.Provider.get(OpenProjectsStore.Key)?.Current() ?? []
    }

    // The dirs to scan/scaffold: every open project, or the app cwd as a single
    // fallback so global + packaged still surface with no project open.
    private projectDirs(): string[] {
        const open = this.openProjectDirs()
        return open.length > 0 ? [...open] : [this.env().CurrentDirectory]
    }

    private scaffoldFs(): ScaffoldFs {
        const fs = this.fs()
        return { exists: (p) => fs.Exists(p), createDirectory: (p) => fs.CreateDirectory(p), writeText: (p, c) => fs.WriteText(p, c) }
    }

    private catalog(): SkillCatalog { return this.Provider.getRequired(SkillCatalog.Key) }
    private runner(): SkillRunner { return this.Provider.getRequired(SkillRunner.Key) }
    private editor(): CodeEditorService { return this.Provider.getRequired(CodeEditorService.Key) }
    private env(): EnvironmentService { return this.Provider.getRequired(EnvironmentService.Key) }
    private fs(): FileSystemService { return this.Provider.getRequired(FileSystemService.Key) }
}
