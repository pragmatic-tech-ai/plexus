import { MetaKind, type Repository } from '@pragmatic-tech-ai/todl'

// Node ids are namespace-qualified (`tech_architecture.connector`). Plexus
// knows a few well-known concepts only by their SIMPLE name (`connector`,
// `scenario`, ...); this maps between the two without hardcoding the owning
// namespace.
export class NodeNames
{
    private static readonly Separator = '.'
    private static readonly ApplicationMarker = '@'
    private static readonly applicationIndex = new WeakMap<Repository, Map<string, ReturnType<Repository['resolve']>>>()

    // The unqualified name of a namespace-qualified id (`tech.connector` -> `connector`).
    public static Simple(conceptId: string): string
    {
        return conceptId.slice(conceptId.lastIndexOf(NodeNames.Separator) + 1)
    }

    // The annotation APPLICATION node `<owner>@<annotationId>` for the annotation
    // whose SIMPLE name is `annotationName`, whatever namespace declares it
    // (`owner@tech_architecture.materialize` for `annotate materialize`). Undefined
    // when the owner carries none. Indexed once per repository.
    public static Application(repo: Repository, ownerId: string, annotationName: string): ReturnType<Repository['resolve']>
    {
        let index = NodeNames.applicationIndex.get(repo)
        if (index === undefined)
        {
            index = new Map()
            for (const n of repo.allNodes())
            {
                const at = n.id.indexOf(NodeNames.ApplicationMarker)
                if (at < 0) continue
                const key = n.id.slice(0, at) + NodeNames.ApplicationMarker + NodeNames.Simple(n.id.slice(at + 1))
                if (!index.has(key)) index.set(key, n)
            }
            NodeNames.applicationIndex.set(repo, index)
        }
        return index.get(ownerId + NodeNames.ApplicationMarker + annotationName)
    }

    // Qualify a bare concept name written inside `contextId`'s source (e.g. the
    // `concept = application` param of an annotation on `m.Cats.special`): the
    // nearest enclosing namespace that declares it wins, else any concept with that
    // simple name, else the name unchanged.
    public static QualifyConcept(repo: Repository, name: string, contextId: string): string
    {
        if (repo.resolve(name)?.metaKind === MetaKind.Concept) return name
        for (let at = contextId.lastIndexOf(NodeNames.Separator); at > 0; at = contextId.lastIndexOf(NodeNames.Separator, at - 1))
        {
            const candidate = contextId.slice(0, at) + NodeNames.Separator + name
            if (repo.resolve(candidate)?.metaKind === MetaKind.Concept) return candidate
        }
        return NodeNames.Resolve(repo, name) ?? name
    }

    // True when `conceptId` is (or is qualified by a namespace and ends in) `simpleName`.
    public static Matches(conceptId: string, simpleName: string): boolean
    {
        return conceptId === simpleName || conceptId.endsWith(NodeNames.Separator + simpleName)
    }

    // The qualified id of the concept named `simpleName`, or undefined if the model
    // declares none. An exact id wins; otherwise the first concept whose id ends in
    // `.simpleName`.
    public static Resolve(repo: Repository, simpleName: string): string | undefined
    {
        if (repo.resolve(simpleName)?.metaKind === MetaKind.Concept) return simpleName
        return repo.allNodes().find((n) => n.metaKind === MetaKind.Concept && NodeNames.Matches(n.id, simpleName))?.id
    }
}
