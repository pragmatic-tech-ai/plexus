// View-models for an AskUserQuestion card — a transcript item the agent produces
// when it calls the ask_user_question tool. QuestionCard holds one QuestionVM per
// question; each QuestionVM holds OptionVMs plus a free-text "Other".
//
// EVERY view-bound property is a registered DP: mural resolves `$Path` bindings
// via get_property_value (the DP system), so a plain field/getter binds to nothing.
// Selection reaction lives in OnPropertyChanged so it fires for binding-driven
// writes too (a binding calls set_property_value, not the TS setter).
import {
    MetaData, MuralBase, ObservableCollection, RelayCommand,
    type ICommand, type PropertyDescriptor,
} from '@pragmatic-tech-ai/mural/runtime'
import type { Question, QuestionAnswer, QuestionOption, QuestionRequest } from '../../../../../shared/agent-api.js'

export class OptionVM extends MuralBase
{
    public static readonly LabelKey          = MuralBase.RegisterProperty<string>(OptionVM, 'Label', '', MetaData.None)
    public static readonly DescriptionKey     = MuralBase.RegisterProperty<string>(OptionVM, 'Description', '', MetaData.None)
    public static readonly HasDescriptionKey  = MuralBase.RegisterProperty<boolean>(OptionVM, 'HasDescription', false, MetaData.None)
    public static readonly IsSelectedKey      = MuralBase.RegisterProperty<boolean>(OptionVM, 'IsSelected', false, MetaData.None)

    // The synthetic "Other" row carries IsOther = true. Not view-bound
    // (the row renders like any other via $Label), so a plain field is fine;
    // the owning QuestionVM reads it to route the answer to the typed text.
    public readonly IsOther: boolean

    constructor(private readonly owner: QuestionVM, option: QuestionOption, isOther = false)
    {
        super()
        this.IsOther = isOther
        this.set_property_value(OptionVM.LabelKey, option.label)
        this.set_property_value(OptionVM.DescriptionKey, option.description ?? '')
        this.set_property_value(OptionVM.HasDescriptionKey, (option.description ?? '') !== '')
    }

    public get Label(): string { return this.get_property_value(OptionVM.LabelKey) }
    public get Description(): string { return this.get_property_value(OptionVM.DescriptionKey) }
    public get HasDescription(): boolean { return this.get_property_value(OptionVM.HasDescriptionKey) }
    public get IsSelected(): boolean { return this.get_property_value(OptionVM.IsSelectedKey) }
    public set IsSelected(v: boolean) { this.set_property_value(OptionVM.IsSelectedKey, v) }

    protected override OnPropertyChanged(d: PropertyDescriptor, o: unknown, n: unknown): void
    {
        super.OnPropertyChanged(d, o, n)
        if (d.Name === 'IsSelected') this.owner.onOptionToggled(this, n as boolean)
    }
}

export class QuestionVM extends MuralBase
{
    public static readonly HeaderKey        = MuralBase.RegisterProperty<string>(QuestionVM, 'Header', '', MetaData.None)
    public static readonly QuestionKey      = MuralBase.RegisterProperty<string>(QuestionVM, 'Question', '', MetaData.None)
    public static readonly OptionsKey       = MuralBase.RegisterProperty<ObservableCollection<OptionVM>>(
        QuestionVM, 'Options', undefined as unknown as ObservableCollection<OptionVM>, MetaData.None)
    public static readonly OtherTextKey     = MuralBase.RegisterProperty<string>(QuestionVM, 'OtherText', '', MetaData.None)
    // True while the "Other" row is the current choice — drives the free-text
    // editor's visibility (it appears only then).
    public static readonly IsOtherChosenKey = MuralBase.RegisterProperty<boolean>(QuestionVM, 'IsOtherChosen', false, MetaData.None)
    // Single-select: the option the RadioButtonGroup has chosen (two-way
    // bound to its SelectedItem). Undefined = nothing picked (or "Other").
    public static readonly SelectedOptionKey = MuralBase.RegisterProperty<OptionVM | undefined>(
        QuestionVM, 'SelectedOption', undefined, MetaData.None)
    // Which option UI to show: a RadioButtonGroup for single-select, the
    // toggle list for multi. Two complementary bools because $Path <<
    // ToVisibility has no inverse converter — bind each branch to its own.
    public static readonly IsSingleSelectKey = MuralBase.RegisterProperty<boolean>(QuestionVM, 'IsSingleSelect', false, MetaData.None)
    public static readonly IsMultiSelectKey  = MuralBase.RegisterProperty<boolean>(QuestionVM, 'IsMultiSelect',  false, MetaData.None)

    // Not view-bound (used only by the selection logic), so a plain field is fine.
    public readonly MultiSelect: boolean
    // The synthetic "Other" row, appended to Options so it renders as a real
    // radio (single) / toggle (multi) member with native mutual exclusion.
    public readonly OtherOption: OptionVM

    // Set by the owning card to recompute submittability on any change.
    public onChanged: (() => void) | undefined

    constructor(question: Question)
    {
        super()
        this.MultiSelect = question.multiSelect
        this.set_property_value(QuestionVM.HeaderKey, question.header)
        this.set_property_value(QuestionVM.QuestionKey, question.question)
        // "Other" is always offered — build it as the trailing option so the
        // RadioButtonGroup owns its exclusion (single) and it toggles like any
        // other row (multi). Its typed answer comes from OtherText, not "Other".
        this.OtherOption = new OptionVM(this, { label: 'Other' }, true)
        const options = question.options.map((o) => new OptionVM(this, o))
        options.push(this.OtherOption)
        this.set_property_value(QuestionVM.OptionsKey, new ObservableCollection<OptionVM>(options))
        this.set_property_value(QuestionVM.IsMultiSelectKey,  question.multiSelect)
        this.set_property_value(QuestionVM.IsSingleSelectKey, !question.multiSelect)
    }

    public get Header(): string { return this.get_property_value(QuestionVM.HeaderKey) }
    public get Question(): string { return this.get_property_value(QuestionVM.QuestionKey) }
    public get Options(): ObservableCollection<OptionVM> { return this.get_property_value(QuestionVM.OptionsKey) }
    public get OtherText(): string { return this.get_property_value(QuestionVM.OtherTextKey) }
    public set OtherText(v: string) { this.set_property_value(QuestionVM.OtherTextKey, v) }
    public get IsOtherChosen(): boolean { return this.get_property_value(QuestionVM.IsOtherChosenKey) }
    public get SelectedOption(): OptionVM | undefined { return this.get_property_value(QuestionVM.SelectedOptionKey) }
    public set SelectedOption(v: OptionVM | undefined) { this.set_property_value(QuestionVM.SelectedOptionKey, v) }
    public get IsSingleSelect(): boolean { return this.get_property_value(QuestionVM.IsSingleSelectKey) }
    public get IsMultiSelect(): boolean { return this.get_property_value(QuestionVM.IsMultiSelectKey) }

    // Multi-select: a toggle flipped. Refresh whether "Other" is among the
    // checked rows (drives the editor) and re-check submittability.
    public onOptionToggled(_option: OptionVM, _selected: boolean): void
    {
        this.set_property_value(QuestionVM.IsOtherChosenKey, this.OtherOption.IsSelected)
        this.onChanged?.()
    }

    protected override OnPropertyChanged(d: PropertyDescriptor, o: unknown, n: unknown): void
    {
        super.OnPropertyChanged(d, o, n)
        if (d.Name === 'SelectedOption')
        {
            // Single-select: the RadioButtonGroup wrote the pick. The editor
            // shows only when that pick is the "Other" row.
            const chosen = n as OptionVM | undefined
            this.set_property_value(QuestionVM.IsOtherChosenKey, chosen?.IsOther === true)
            this.onChanged?.()
        }
        if (d.Name === 'OtherText') this.onChanged?.()
    }

    // The chosen labels for this question. Single-select reads the
    // RadioButtonGroup's pick; multi reads each option's IsSelected. The
    // "Other" row contributes the typed text (when non-empty) rather than
    // the literal "Other" label.
    public SelectedLabels(): string[]
    {
        const out: string[] = []
        const contribute = (o: OptionVM): void => {
            if (o.IsOther)
            {
                const text = this.OtherText.trim()
                if (text !== '') out.push(text)
            }
            else out.push(o.Label)
        }
        if (this.MultiSelect)
        {
            for (const o of this.Options) if (o.IsSelected) contribute(o)
        }
        else
        {
            const sel = this.SelectedOption
            if (sel !== undefined) contribute(sel)
        }
        return out
    }

    public get HasSelection(): boolean { return this.SelectedLabels().length > 0 }
}

export class QuestionCard extends MuralBase
{
    public static readonly QuestionsKey      = MuralBase.RegisterProperty<ObservableCollection<QuestionVM>>(
        QuestionCard, 'Questions', undefined as unknown as ObservableCollection<QuestionVM>, MetaData.None)
    public static readonly IsAnsweredKey     = MuralBase.RegisterProperty<boolean>(QuestionCard, 'IsAnswered', false, MetaData.None)
    // Complement of IsAnswered — no inverse Visibility converter, so bind the
    // question list + Submit to $IsPending and the summary to $IsAnswered.
    public static readonly IsPendingKey      = MuralBase.RegisterProperty<boolean>(QuestionCard, 'IsPending', true, MetaData.None)
    public static readonly IsSubmittableKey  = MuralBase.RegisterProperty<boolean>(QuestionCard, 'IsSubmittable', false, MetaData.None)
    public static readonly AnswerSummaryKey  = MuralBase.RegisterProperty<string>(QuestionCard, 'AnswerSummary', '', MetaData.None)
    public static readonly SubmitCommandKey  = MuralBase.RegisterProperty<ICommand>(
        QuestionCard, 'SubmitCommand', undefined as unknown as ICommand, MetaData.None)

    // Not view-bound (correlation id for the answer), so a plain field is fine.
    public readonly Id: string

    constructor(request: QuestionRequest, onSubmit: (answer: QuestionAnswer) => void)
    {
        super()
        this.Id = request.id
        const questions = new ObservableCollection<QuestionVM>(request.questions.map((q) => new QuestionVM(q)))
        for (const q of questions) q.onChanged = () => this.recompute()
        this.set_property_value(QuestionCard.QuestionsKey, questions)
        this.set_property_value(QuestionCard.SubmitCommandKey, new RelayCommand(() => this.submit(onSubmit)))
        this.recompute()
    }

    public get Questions(): ObservableCollection<QuestionVM> { return this.get_property_value(QuestionCard.QuestionsKey) }
    public get IsAnswered(): boolean { return this.get_property_value(QuestionCard.IsAnsweredKey) }
    public get IsPending(): boolean { return this.get_property_value(QuestionCard.IsPendingKey) }
    public get IsSubmittable(): boolean { return this.get_property_value(QuestionCard.IsSubmittableKey) }
    public get AnswerSummary(): string { return this.get_property_value(QuestionCard.AnswerSummaryKey) }
    public get SubmitCommand(): ICommand { return this.get_property_value(QuestionCard.SubmitCommandKey) }

    // Assemble the answer keyed by question text (mirrors the tool contract).
    public BuildAnswer(): QuestionAnswer
    {
        const answers: Record<string, string[]> = {}
        for (const q of this.Questions) answers[q.Question] = q.SelectedLabels()
        return { id: this.Id, answers }
    }

    private recompute(): void
    {
        this.set_property_value(QuestionCard.IsSubmittableKey, [...this.Questions].every((q) => q.HasSelection))
    }

    private submit(onSubmit: (answer: QuestionAnswer) => void): void
    {
        if (this.IsAnswered || !this.IsSubmittable) return
        const answer = this.BuildAnswer()
        this.set_property_value(QuestionCard.AnswerSummaryKey, summarize(this.Questions))
        this.set_property_value(QuestionCard.IsAnsweredKey, true)
        this.set_property_value(QuestionCard.IsPendingKey, false)
        onSubmit(answer)
    }
}

// A compact read-only recap shown after answering: "Approach: A, C · Scope: X".
function summarize(questions: ObservableCollection<QuestionVM>): string
{
    return [...questions]
        .map((q) => `${q.Header}: ${q.SelectedLabels().join(', ')}`)
        .join('  ·  ')
}
