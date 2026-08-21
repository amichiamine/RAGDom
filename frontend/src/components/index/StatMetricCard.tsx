import { formatNumber } from '@/lib/utils'

interface Props {
  icon: string
  colorVar: string
  value: number
  label: string
}

export default function StatMetricCard({ icon, colorVar, value, label }: Props) {
  return (
    <div className="stat-metric-card">
      <i className={`fa-solid ${icon}`} style={{ fontSize: '1.6rem', color: colorVar, marginBottom: 8 }} />
      <div className="stat-val font-num" style={{ color: 'var(--text-heading)' }}>{formatNumber(value)}</div>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600 }}>{label}</div>
    </div>
  )
}
