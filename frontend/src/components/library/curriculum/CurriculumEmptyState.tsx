import { Link } from 'react-router-dom'
import { TriangleAlert, Info, Cog } from 'lucide-react'
import type { ReactNode } from 'react'

interface Props {
  /** Titre principal (ex. « المصفوفة الشاملة غير متوفرة »). */
  title: string
  /** Explication honnête (ex. « المنهاج غير مبني لهذه القاعدة »). */
  description: string
  /** Icône lucide de tête (défaut : triangle d'alerte). */
  icon?: ReactNode
}

/**
 * Empty-state élégant, style library.php (l.1165-1186) : carte `.content-box`
 * centrée, icône dorée, titre, explication, encadré d'aide et CTA vers le studio
 * curriculum de la console d'automatisation (CurriculumStudio).
 *
 * Utilisé par les onglets qui EXIGENT le curriculum (Matrice, Programme) quand
 * `curriculum_available === false` — jamais d'écran cassé.
 */
export default function CurriculumEmptyState({ title, description, icon }: Props) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 0' }} dir="rtl">
      <div className="content-box" style={{ maxWidth: 680, margin: '0 auto', padding: 40 }}>
        <div style={{ fontSize: '2.6rem', color: 'var(--warning)', marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
          {icon ?? <TriangleAlert size={52} strokeWidth={1.6} />}
        </div>
        <h4 style={{ fontWeight: 800, marginBottom: 8 }}>{title}</h4>
        <p style={{ color: 'var(--text-muted)', marginBottom: 24 }} dir="auto">{description}</p>

        <div
          className="alert-secondary-box"
          style={{ display: 'flex', alignItems: 'center', gap: 14, textAlign: 'start', justifyContent: 'center', marginBottom: 24 }}
        >
          <Info size={30} style={{ color: 'var(--warning)', flexShrink: 0 }} />
          <div>
            <h6 style={{ fontWeight: 700, margin: 0 }}>جاهز للبناء الفوري :</h6>
            <small style={{ color: 'var(--text-muted)' }}>
              يمكنك بناء المنهاج والتدرج السنوي من مركز الأتمتة (استوديو المنهاج) خلال ثوانٍ.
            </small>
          </div>
        </div>

        <Link to="/automation" className="btn btn-success rounded-pill" style={{ padding: '10px 24px', fontWeight: 700 }}>
          <Cog size={16} /> الانتقال إلى استوديو المنهاج (لوحة الأتمتة)
        </Link>
      </div>
    </div>
  )
}
