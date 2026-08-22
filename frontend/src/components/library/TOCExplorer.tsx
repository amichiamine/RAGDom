import { useState } from 'react'
import type { TocNode } from '@/types'

interface Props {
  nodes: TocNode[]
  onSelectPage: (page: number) => void
  activePage: number | null
  /**
   * Navigation RELATIONNELLE optionnelle « entrée de sommaire → cours » (défaut 3).
   * Quand elle est fournie, un clic sur le titre d'un nœud remonte le nœud complet
   * (id/level/pages) à l'appelant, qui peut basculer vers l'onglet Cours et illuminer
   * la carte correspondante (`cours_{toc_id}`). Sans ce callback, le comportement
   * historique (sélection de page) est INCHANGÉ — extension purement additive.
   */
  onSelectNode?: (node: TocNode) => void
}

function buildTree(flat: TocNode[]): TocNode[] {
  const byId = new Map<string, TocNode>()
  flat.forEach(n => byId.set(n.id, { ...n, children: [] }))
  const roots: TocNode[] = []
  byId.forEach(n => {
    if (n.parent_id && byId.has(n.parent_id)) byId.get(n.parent_id)!.children!.push(n)
    else roots.push(n)
  })
  return roots
}

function TocItem({ node, onSelectPage, onSelectNode, activePage, depth }: { node: TocNode; onSelectPage: (p: number) => void; onSelectNode?: (n: TocNode) => void; activePage: number | null; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 1)
  const hasChildren = !!node.children && node.children.length > 0
  const isActive = activePage !== null && activePage === node.page_start

  // Un clic sur le titre : navigation relationnelle vers le cours si l'appelant
  // l'a activée (onSelectNode), sinon sélection de page (comportement historique).
  const handleTitleClick = () => {
    if (onSelectNode) onSelectNode(node)
    else onSelectPage(node.page_start)
  }

  return (
    <li role="treeitem" aria-expanded={hasChildren ? expanded : undefined}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 8,
          cursor: 'pointer', paddingInlineStart: 8 + depth * 14,
          background: isActive ? 'rgba(37,99,235,0.12)' : 'transparent',
          color: isActive ? 'var(--primary)' : 'var(--text-main)', fontWeight: isActive ? 700 : 500,
        }}
      >
        {hasChildren ? (
          <button
            onClick={() => setExpanded(e => !e)}
            aria-label="toggle"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', width: 18 }}
          >
            <i className={`fa-solid ${expanded ? 'fa-chevron-down' : 'fa-chevron-left'}`} style={{ fontSize: '0.7rem' }} />
          </button>
        ) : <span style={{ width: 18 }} />}
        <span
          style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          onClick={handleTitleClick}
          title={node.title}
          dir="auto"
        >
          {node.title}
        </span>
        {/* Le badge de page conserve TOUJOURS la sélection de page (aller au scan). */}
        <span className="badge badge-subtle" onClick={() => onSelectPage(node.page_start)}>ص {node.page_start}</span>
      </div>
      {hasChildren && expanded && (
        <ul role="group" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {node.children!.map(c => (
            <TocItem key={c.id} node={c} onSelectPage={onSelectPage} onSelectNode={onSelectNode} activePage={activePage} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function TOCExplorer({ nodes, onSelectPage, activePage, onSelectNode }: Props) {
  const tree = buildTree(nodes)
  return (
    <ul role="tree" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {tree.map(n => (
        <TocItem key={n.id} node={n} onSelectPage={onSelectPage} onSelectNode={onSelectNode} activePage={activePage} depth={0} />
      ))}
    </ul>
  )
}
