import { useState } from 'react'
import ValidationRunBuilder from './ValidationRunBuilder'
import ValidationRunsPanel from './ValidationRunsPanel'
import type { DatabaseInfo, ValidationRun } from '@/types'

interface Props {
  databases: DatabaseInfo[]
  activeDb: string | null
  readonly: boolean
}

export default function ValidationStudio({ databases, activeDb, readonly }: Props) {
  const [createdRun, setCreatedRun] = useState<ValidationRun | null>(null)
  return (
    <div className="workspace-tab validation-studio">
      <ValidationRunBuilder databases={databases} activeDb={activeDb} readonly={readonly} onRunCreated={setCreatedRun} />
      <ValidationRunsPanel activeDb={activeDb} readonly={readonly} createdRun={createdRun} />
    </div>
  )
}
