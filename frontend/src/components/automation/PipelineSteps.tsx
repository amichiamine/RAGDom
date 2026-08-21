import type { PipelineStatus } from '@/types'

interface Props {
  currentStatus: PipelineStatus | null
  running: boolean
}

// 8 couches 0→7 (§5.3). Ordre aligné sur PipelineStatus.
const LAYERS: Array<{ key: string; label: string; matches: PipelineStatus[] }> = [
  { key: '0', label: 'Layer 0 · Queue', matches: ['QUEUED'] },
  { key: '1', label: 'Layer 1 · CV / Deskew', matches: ['PROCESSING_CV'] },
  { key: '2', label: 'Layer 2 · Segmentation', matches: ['SEGMENTING'] },
  { key: '3', label: 'Layer 3 · Extraction', matches: ['EXTRACTING'] },
  { key: '4', label: 'Layer 4 · Linting', matches: ['LINTING'] },
  { key: '5', label: 'Layer 5 · VLM Recovery', matches: ['VLM_RECOVERY'] },
  { key: '6', label: 'Layer 6 · Indexation', matches: ['INDEXED'] },
  { key: '7', label: 'Layer 7 · Ready', matches: ['READY'] },
]

const ORDER: PipelineStatus[] = ['QUEUED', 'PROCESSING_CV', 'SEGMENTING', 'EXTRACTING', 'LINTING', 'VLM_RECOVERY', 'INDEXED', 'READY']

export default function PipelineSteps({ currentStatus, running }: Props) {
  const currentIdx = currentStatus ? ORDER.indexOf(currentStatus) : -1

  return (
    <div>
      {LAYERS.map(layer => {
        const layerIdx = ORDER.indexOf(layer.matches[0])
        let state: 'waiting' | 'active' | 'done' = 'waiting'
        if (currentIdx >= 0) {
          if (layerIdx < currentIdx) state = 'done'
          else if (layerIdx === currentIdx) state = running ? 'active' : 'done'
        }
        return (
          <div key={layer.key} className="step-pill" style={{ transition: 'background-color 150ms ease' }}>
            <span style={{ fontWeight: 700 }}>{layer.label}</span>
            {state === 'done' ? (
              <span className="badge badge-success">✅</span>
            ) : state === 'active' ? (
              <span className="badge badge-warning"><i className="fa-solid fa-spinner fa-spin" /></span>
            ) : (
              <span className="badge badge-secondary">—</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
