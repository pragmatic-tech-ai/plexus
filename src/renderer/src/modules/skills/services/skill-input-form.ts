import { Observable, ObservableCollection, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import type { SkillInput } from '../../../../../shared/skill-api.js'
import type { ResolvedInput } from '../../../../../shared/skill-context-api.js'
import { SkillInputVm } from './skill-input.js'

// Presentation-agnostic form over a skill's declared inputs. Both hosts (modal
// dialog, inline transcript card) bind this same VM; the host supplies onDone,
// which the runner sets to close-the-dialog / release-the-card + continue.
// Confirm passes the collected values; Cancel passes undefined.
export class SkillInputFormVm extends Observable {
    public readonly Inputs = new ObservableCollection<SkillInputVm>()
    private readonly onDone: (result: ResolvedInput[] | undefined) => void
    private readonly _confirm: RelayCommand
    private readonly _cancel: RelayCommand

    constructor(inputs: SkillInput[], onDone: (result: ResolvedInput[] | undefined) => void) {
        super()
        this.onDone = onDone
        for (const i of inputs) {
            const vm = new SkillInputVm(i)
            // An input's validity flips as its value changes; re-raise the form's
            // IsValid and re-query the Run button's enablement.
            vm.PropertyChanged('IsValid').subscribe(() => {
                this.RaisePropertyChanged('IsValid', undefined, this.IsValid)
                this._confirm.RaiseCanExecuteChanged()
            })
            this.Inputs.Add(vm)
        }
        this._confirm = new RelayCommand(() => this.confirm(), () => this.IsValid)
        this._cancel = new RelayCommand(() => this.onDone(undefined))
    }

    get IsValid(): boolean {
        for (let i = 0; i < this.Inputs.Count; i++) if (!this.Inputs.Get(i).IsValid) return false
        return true
    }
    get ConfirmCommand(): ICommand { return this._confirm }
    get CancelCommand(): ICommand { return this._cancel }

    private confirm(): void {
        if (!this.IsValid) return
        const out: ResolvedInput[] = []
        for (let i = 0; i < this.Inputs.Count; i++) { const vm = this.Inputs.Get(i); out.push({ key: vm.Key, value: vm.Value }) }
        this.onDone(out)
    }
}
