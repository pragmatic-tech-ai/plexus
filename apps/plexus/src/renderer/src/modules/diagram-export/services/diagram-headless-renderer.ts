import { ServiceBase, ServiceKey, ServiceProvider, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { Diagram, DiagramDocument, DocumentTypeRegistry } from '@pragmatic-tech-ai/mural/framework'
import { HeadlessTarget } from '@pragmatic-tech-ai/mural/visual-engine'
import { PaginatedCanvas, ItemsPanelTemplate } from '@pragmatic-tech-ai/mural/basic'
import type { OpenProject } from '../../../services/projects/open-project.js'
import type { IDocumentFactory } from '../../../services/documents/document-factory.js'
import { ArchDiagramBindingService } from '../../architecture-projects/services/arch-diagram-binding-service.js'
import { DiagramSvgRenderer } from './diagram-svg-renderer.js'

// Renders a .diagram file to SVG WITHOUT opening it in the editor. A .diagram on
// disk is just node ids + geometry; its figures only exist once a Diagram control
// realizes them. So we: load the document (factory.openFile), attach a transient
// arch binding (so nodes get their concepts/icons), build an OFFSCREEN Diagram
// bound to the doc's nodes, force layout through a HeadlessTarget (Flush measures
// + arranges → figures realize at their geometry), publish it as the doc's
// ActiveView, and render via the shared DiagramSvgRenderer. Everything transient is
// disposed afterward, so the live editor/UI is untouched.
export class DiagramHeadlessRenderer extends ServiceBase
{
  public static readonly Key = new ServiceKey<DiagramHeadlessRenderer>('DiagramHeadlessRenderer')

  public constructor(provider: IServiceProvider) { super(provider) }

  private resolveDiagramFactory(): IDocumentFactory | undefined
  {
    const registry = this.Provider.get(DocumentTypeRegistry.Key)
    const def = registry?.GetByExtension('.diagram')
    if (def?.Factory === undefined) return undefined
    const token = ServiceProvider.tokenFor(def.Factory as unknown as new (...args: never[]) => IDocumentFactory)
    return this.Provider.get(token) as IDocumentFactory | undefined
  }

  // Render `path` (project-relative) in `op` to an SVG string sized to its content.
  public async renderFile(op: OpenProject, path: string): Promise<{ svg: string; width: number; height: number } | undefined>
  {
    const factory = this.resolveDiagramFactory()
    if (factory === undefined) return undefined

    const doc = await factory.openFile(op.Storage, path)
    if (!(doc instanceof DiagramDocument)) return undefined

    let binding: { dispose(): void } | undefined
    if (op.Project.Type === 'architecture') {
      binding = await this.Provider.get(ArchDiagramBindingService.Key)?.bindForRender(op, doc)
    }

    try {
      const diagram = new Diagram()
      diagram.ItemsPanel = new ItemsPanelTemplate(() => new PaginatedCanvas())
      diagram.ItemsSource = doc.Nodes
      diagram.Connectors = doc.Connectors
      // Publish the offscreen view so the binding's view-projection runs.
      doc.ActiveView = diagram

      // Force a full layout pass: HeadlessTarget.Flush measures + arranges the
      // Diagram, realizing every figure at its stored geometry. Size the surface
      // generously so nothing is clipped before we crop to the real content.
      const target = new HeadlessTarget(20000, 20000, diagram)
      target.Flush()

      // The loaded doc's Nodes are content VMs with NO geometry — the shared
      // renderer takes bounds from the now-arranged figures (the panel's realized
      // children) and paints them cropped to that content box.
      const panel = diagram.ItemsPanelInstance
      if (panel === undefined) return undefined
      const rendered = DiagramSvgRenderer.renderPanel(panel)
      if (rendered.width <= 1 && rendered.height <= 1) return undefined
      return rendered
    }
    finally {
      binding?.dispose()
    }
  }
}
