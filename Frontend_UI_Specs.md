# **SPÉCIFICATIONS UI/UX FRONTEND : RAGDom — Pixel-Perfect React**

**Version :** 3.5 (Base Autonome — scans servis par page_scans, vignettes thumb, dimensions BBox via en-têtes)

**Statut :** Référence Normative Absolue pour l'Implémentation Frontend

**Source :** Extraite et traduite depuis les templates PHP (`Template_UI-UX/index.php`, `library.php`, `automation.php`) en composants React/TypeScript/Tailwind conformes au stack RAGDom-V3.

**Principe :** L'agent doit reproduire **pixel-perfect** chaque vue, composant, animation, comportement, couleur, typographie et interaction des templates PHP. Aucune liberté créative n'est autorisée sur l'UI.

> [!IMPORTANT]
> ### 🛑 DIRECTIVE AGENTIQUE OBLIGATOIRE : CHECKPOINT TRANSITION FRONTEND (PHASE 4)
> Lors de l'entrée dans la Phase 4 (Développement Frontend), l'agent **DOIT IMPÉRATIVEMENT** :
> 1. **Demander la confirmation explicite à ArchiSys3.0** avant d'écrire le moindre composant React.
> 2. **Demander la soumission / relecture intégrale des 3 fichiers originaux** du dossier `Template_UI-UX/` (`index.php`, `library.php`, `automation.php`).
> 3. **Inspecter le code source réel de ces 3 templates** pour s'imprégner à 100% de la disposition visuelle, des classes CSS, des états de chargement, du halo radiant doré, des comportements de navigation et de la réactivité, afin de garantir une conformité sans faille avec le présent document.

---

## **PARTIE 1 : CONFIGURATION RACINE DU PROJET FRONTEND**

### **1.1 Structure des Fichiers (Imposée)**

```
/frontend/
├── package.json                    ← Défini dans tech_specs.md §9
├── vite.config.ts                  ← Défini ci-dessous (§1.2)
├── tailwind.config.ts              ← Défini ci-dessous (§1.3)
├── postcss.config.js
├── tsconfig.json                   ← Défini ci-dessous (§1.4)
├── index.html                      ← Défini ci-dessous (§1.5)
├── src/
│   ├── main.tsx                    ← Point d'entrée React
│   ├── App.tsx                     ← Router (3 routes)
│   ├── index.css                   ← Variables CSS globales + Design System
│   ├── contexts/
│   │   ├── DatabaseContext.tsx     ← Contexte global de la base active
│   │   ├── ThemeContext.tsx        ← Contexte global du thème dark/light
│   │   └── LanguageContext.tsx     ← Contexte i18n Trilingue (Arabe/FR/EN, AR par défaut)
│   ├── locales/
│   │   ├── ar.json                 ← Dictionnaire Arabe (Source de vérité par défaut)
│   │   ├── fr.json                 ← Dictionnaire Français
│   │   └── en.json                 ← Dictionnaire Anglais
│   ├── lib/
│   │   └── api.ts                  ← Client API centralisé
│   ├── types/
│   │   └── index.ts                ← Interfaces TypeScript (DTO)
│   ├── views/
│   │   ├── IndexView.tsx           ← Vue 1 : Dashboard (index.php)
│   │   ├── LibraryView.tsx         ← Vue 2 : Bibliothèque (library.php)
│   │   └── AutomationView.tsx      ← Vue 3 : Automation Hub (automation.php)
│   └── components/
│       ├── layout/
│       │   ├── Topbar.tsx
│       │   ├── Sidebar.tsx
│       │   ├── ThemeToggle.tsx
│       │   └── LanguageSelector.tsx  ← Sélecteur de langue 🌐 AR | FR | EN
│       ├── index/
│       │   ├── StatMetricCard.tsx
│       │   ├── DisciplineCard.tsx
│       │   ├── CycleCard.tsx
│       │   └── DatabaseTelemetryRow.tsx
│       ├── library/
│       │   ├── SplashScreen.tsx
│       │   ├── TOCExplorer.tsx
│       │   ├── CurriculumMatrix.tsx
│       │   ├── CoursViewer.tsx
│       │   ├── ExercicesTab.tsx
│       │   ├── EvaluationsTab.tsx
│       │   ├── SideBySideViewer.tsx
│       │   ├── ScanGallery.tsx
│       │   ├── ArtifactRenderer.tsx
│       │   └── SearchStudio.tsx
│       └── automation/
│           ├── PipelineSteps.tsx
│           ├── LiveConsole.tsx
│           ├── LLMModelSelector.tsx
│           ├── SourceDocumentsTable.tsx
│           └── KeyManager.tsx
```

### **1.2 vite.config.ts (Imposé)**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path,
      },
    },
  },
})
```

### **1.3 tailwind.config.ts (Design System Imposé)**

```typescript
import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['attribute', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        main:    ['Tajawal', 'sans-serif'],
        heading: ['Cairo', 'sans-serif'],
        num:     ['Outfit', 'sans-serif'],
      },
      colors: {
        'bg-body-dark':        '#070d1e',
        'bg-surface-dark':     '#0f172a',
        'bg-surface-sec-dark': '#1e293b',
        'bg-surface-elv-dark': '#16223b',
        'bg-card-dark':        '#070d1e',
        'border-dark':         'rgba(255,255,255,0.1)',
        'bg-body-light':       '#f8fafc',
        'bg-surface-light':    '#ffffff',
        'bg-surface-sec-light':'#f1f5f9',
        primary:    '#2563eb',
        'primary-dark': '#3b82f6',
        success:    '#10b981',
        warning:    '#f59e0b',
        danger:     '#ef4444',
        info:       '#06b6d4',
      },
      borderRadius: {
        card: '20px',
        node: '14px',
        pill: '30px',
      },
      boxShadow: {
        card:       '0 4px 20px -2px rgba(0,0,0,0.05)',
        'card-hover':'0 12px 30px -4px rgba(37,99,235,0.12)',
        'card-dark': '0 10px 30px -10px rgba(0,0,0,0.5)',
        'card-dark-hover':'0 20px 40px -10px rgba(37,99,235,0.3)',
        glow:       '0 0 25px rgba(37,99,235,0.35)',
      },
      animation: {
        'tab-in':     'tabFadeSlide 0.35s cubic-bezier(0.16,1,0.3,1) forwards',
        'pulse-glow': 'pulseGlow 2s infinite ease-in-out',
        'flash-glow': 'targetFlashGlow 2.2s cubic-bezier(0.16,1,0.3,1) forwards',
      },
      keyframes: {
        tabFadeSlide: {
          '0%':   { opacity: '0', transform: 'translateY(12px) scale(0.995)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        pulseGlow: {
          '0%,100%': { transform: 'scale(1)', filter: 'drop-shadow(0 0 15px rgba(245,158,11,0.5))' },
          '50%':     { transform: 'scale(1.08)', filter: 'drop-shadow(0 0 25px rgba(37,99,235,0.8))' },
        },
        targetFlashGlow: {
          '0%':   { backgroundColor: '#fef08a', borderColor: '#f59e0b', boxShadow: '0 0 35px rgba(245,158,11,0.6)', transform: 'scale(1.02)' },
          '60%':  { backgroundColor: 'rgba(254,240,138,0.45)', boxShadow: '0 0 20px rgba(245,158,11,0.3)', transform: 'scale(1.005)' },
          '100%': { backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)', transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
```

### **1.4 tsconfig.json (Strict Mode Imposé)**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}
```

### **1.5 index.html (Structure RTL Imposée)**

```html
<!DOCTYPE html>
<html lang="ar" dir="rtl" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>RAGDom Library — المنصة الرقمية للمناهج العلمية</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Outfit:wght@400;600;700;800&family=Tajawal:wght@400;500;700;800&family=Inter:wght@400;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

---

## **PARTIE 2 : DESIGN SYSTEM CSS (VARIABLES GLOBALES)**

### **2.1 src/index.css — Intégralité Imposée**

Le fichier `index.css` doit contenir **exactement** les variables CSS et classes extraites des templates PHP. Voici le contenu complet.

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* ==========================================================================
   THÈME DUAL (DARK NAVY / LIGHT MODERN)
   Source exacte : Template_UI-UX/library.php + index.php + automation.php
   ========================================================================== */
:root, [data-theme="light"] {
  --font-main:    'Tajawal', sans-serif;
  --font-heading: 'Cairo', sans-serif;
  --font-num:     'Outfit', sans-serif;
  --bg-body:            #f8fafc;
  --bg-body-radial:     radial-gradient(circle at 50% 0%, rgba(37,99,235,0.06) 0%, transparent 60%);
  --bg-surface:         #ffffff;
  --bg-surface-secondary: #f1f5f9;
  --bg-surface-elevated:  #ffffff;
  --bg-card-inner:      #f8fafc;
  --border-color:       #e2e8f0;
  --border-glow:        rgba(37,99,235,0.25);
  --text-main:    #0f172a;
  --text-heading: #0f172a;
  --text-sub:     #334155;
  --text-muted:   #64748b;
  --sidebar-width: 320px;
  --sidebar-bg:           #0f172a;
  --sidebar-bg-secondary: #1e293b;
  --card-shadow:       0 4px 20px -2px rgba(0,0,0,0.05);
  --card-shadow-hover: 0 12px 30px -4px rgba(37,99,235,0.12);
  --topbar-bg:         rgba(255,255,255,0.95);
  --primary:           #2563eb;
  --header-bg:         rgba(255,255,255,0.95);
  --badge-bg-subtle:   #e2e8f0;
  --badge-text-subtle: #1e293b;
}

[data-theme="dark"] {
  --bg-body:     #070d1e;
  --bg-body-radial:
    radial-gradient(circle at 50% 0%, rgba(37,99,235,0.18) 0%, transparent 60%),
    radial-gradient(circle at 10% 40%, rgba(245,158,11,0.08) 0%, transparent 50%),
    radial-gradient(circle at 90% 70%, rgba(16,185,129,0.08) 0%, transparent 50%);
  --bg-surface:          #0f172a;
  --bg-surface-secondary:#1e293b;
  --bg-surface-elevated: #16223b;
  --bg-card-inner:       #070d1e;
  --border-color:        rgba(255,255,255,0.1);
  --border-glow:         rgba(59,130,246,0.35);
  --text-main:    #f8fafc;
  --text-heading: #ffffff;
  --text-sub:     #cbd5e1;
  --text-muted:   #94a3b8;
  --sidebar-bg:           #070d1e;
  --sidebar-bg-secondary: #0f172a;
  --card-shadow:       0 10px 30px -10px rgba(0,0,0,0.5);
  --card-shadow-hover: 0 20px 40px -10px rgba(37,99,235,0.3);
  --topbar-bg:         rgba(15,23,42,0.95);
  --primary:           #3b82f6;
  --header-bg:         rgba(15,23,42,0.95);
  --badge-bg-subtle:   #1e293b;
  --badge-text-subtle: #e2e8f0;
}

body {
  font-family: var(--font-main);
  background-color: var(--bg-body);
  background-image: var(--bg-body-radial);
  color: var(--text-main);
  margin: 0; padding: 0;
  overflow-x: hidden;
  transition: background-color 0.3s ease, color 0.3s ease;
}
h1,h2,h3,h4,h5,h6 { font-family: var(--font-heading); font-weight:700; color: var(--text-heading); }
.font-num { font-family: var(--font-num); }

/* ── Portal Card (Glassmorphism) ── */
.portal-card {
  background: var(--bg-surface); backdrop-filter: blur(16px);
  border: 1px solid var(--border-color); border-radius: 20px; padding: 24px;
  box-shadow: var(--card-shadow); transition: all 0.3s cubic-bezier(0.16,1,0.3,1);
  position: relative; overflow: hidden;
}
.portal-card:hover { transform: translateY(-4px); border-color: var(--border-glow); box-shadow: var(--card-shadow-hover); }

/* ── Stat Metric Card ── */
.stat-metric-card {
  background: var(--bg-surface); border: 1px solid var(--border-color);
  border-radius: 16px; padding: 20px; text-align: center;
  box-shadow: var(--card-shadow); transition: all 0.25s ease;
}
.stat-metric-card:hover { border-color: #3b82f6; transform: translateY(-2px); }
.stat-val { font-size: 2.2rem; font-weight: 800; line-height: 1.2; margin-bottom: 4px; }

/* ── Hero ── */
.hero-banner { padding: 50px 0 35px 0; text-align: center; }
.hero-badge {
  display: inline-flex; align-items: center; gap: 8px;
  background: rgba(245,158,11,0.12); border: 1px solid rgba(245,158,11,0.35);
  color: #f59e0b; padding: 6px 18px; border-radius: 30px;
  font-weight: 700; font-size: 0.9rem; margin-bottom: 20px;
  box-shadow: 0 0 20px rgba(245,158,11,0.15);
}
.hero-title { font-size: 2.8rem; font-weight: 900; margin-bottom: 16px; letter-spacing: -0.5px; }
[data-theme="dark"] .hero-title {
  background: linear-gradient(135deg, #ffffff 0%, #cbd5e1 50%, #94a3b8 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
}
[data-theme="light"] .hero-title { color: #0f172a; }
.hero-desc { font-size: 1.15rem; color: var(--text-sub); max-width: 820px; margin: 0 auto 30px auto; line-height: 1.8; }

/* ── Buttons ── */
.btn-launch-hero {
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
  color: #fff !important; font-weight: 800; font-size: 1.1rem;
  padding: 14px 36px; border-radius: 30px; border: 1px solid rgba(255,255,255,0.2);
  box-shadow: 0 10px 25px rgba(37,99,235,0.4); text-decoration: none;
  display: inline-flex; align-items: center; gap: 10px;
  transition: all 0.25s cubic-bezier(0.16,1,0.3,1);
}
.btn-launch-hero:hover { background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); transform: scale(1.04); box-shadow: 0 15px 35px rgba(37,99,235,0.6); }
.btn-viewer-hero {
  background: var(--bg-surface); color: var(--text-heading); font-weight: 700; font-size: 1rem;
  padding: 14px 28px; border-radius: 30px; border: 1px solid var(--border-color);
  text-decoration: none; display: inline-flex; align-items: center; gap: 8px;
  box-shadow: var(--card-shadow); transition: all 0.2s ease;
}
.btn-viewer-hero:hover { background: var(--bg-surface-secondary); color: var(--text-heading); border-color: #3b82f6; }

/* ── Hero Search ── */
.hero-search-box { max-width: 600px; margin: 0 auto 30px auto; position: relative; }
.hero-search-input {
  background: var(--bg-surface); border: 1px solid var(--border-color);
  border-radius: 30px; padding: 14px 24px 14px 50px; color: var(--text-heading);
  width: 100%; font-size: 1rem; box-shadow: var(--card-shadow); transition: all 0.25s ease;
}
.hero-search-input:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 25px rgba(37,99,235,0.35); }
.hero-search-icon { position: absolute; left: 20px; top: 50%; transform: translateY(-50%); color: var(--text-muted); font-size: 1.1rem; }

/* ── Database Badge Row ── */
.db-badge-row {
  background: var(--bg-card-inner); border: 1px solid var(--border-color);
  border-radius: 14px; padding: 14px 18px; margin-bottom: 12px;
  display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;
}

/* ── Theme Toggle ── */
.theme-toggle-btn {
  background: var(--bg-surface); border: 1px solid var(--border-color);
  color: var(--text-heading); padding: 8px 16px; border-radius: 30px;
  font-weight: 700; display: inline-flex; align-items: center; gap: 8px;
  cursor: pointer; box-shadow: var(--card-shadow); transition: all 0.2s ease;
}
.theme-toggle-btn:hover { transform: scale(1.05); border-color: #3b82f6; }

/* ── App Layout (Library) ── */
.app-layout { display: flex; min-height: 100vh; position: relative; }
.app-sidebar {
  width: var(--sidebar-width);
  background: linear-gradient(180deg, var(--sidebar-bg) 0%, var(--sidebar-bg-secondary) 100%);
  color: #fff; height: 100vh; position: fixed; top: 0; right: 0; z-index: 1040;
  overflow-y: auto; border-left: 2px solid rgba(255,255,255,0.08);
  transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);
  box-shadow: -4px 0 25px rgba(0,0,0,0.25);
  display: flex; flex-direction: column; transform: translateX(100%);
}
.app-sidebar.show-sidebar { transform: translateX(0); }
.app-workspace { flex-grow: 1; margin-right: 0; transition: margin-right 0.3s cubic-bezier(0.4,0,0.2,1); min-width: 0; display: flex; flex-direction: column; }
.app-workspace.with-sidebar { margin-right: var(--sidebar-width); }
.workspace-topbar {
  position: sticky; top: 0; z-index: 1020; background: var(--topbar-bg);
  backdrop-filter: blur(12px); border-bottom: 1px solid var(--border-color);
  padding: 12px 24px; display: flex; justify-content: space-between; align-items: center;
  box-shadow: var(--card-shadow);
}
.sidebar-nav-btn {
  background: transparent; border: 1px solid transparent; color: #94a3b8;
  font-weight: 700; padding: 10px 16px; border-radius: 12px; width: 100%; text-align: right;
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;
  transition: all 0.2s cubic-bezier(0.16,1,0.3,1); text-decoration: none; cursor: pointer;
}
.sidebar-nav-btn:hover { background: rgba(255,255,255,0.08); color: #fff; transform: translateX(-4px); }
.sidebar-nav-btn.active { background: var(--primary); color: #fff; border-color: var(--primary); box-shadow: 0 4px 14px rgba(37,99,235,0.35); }

/* ── Content Box ── */
.content-box {
  font-size: 1rem; line-height: 1.9; background: var(--bg-surface);
  border-radius: 16px; padding: 20px; border: 1px solid var(--border-color);
  box-shadow: var(--card-shadow); transition: transform 0.2s cubic-bezier(0.16,1,0.3,1), box-shadow 0.2s;
}
.content-box:hover { box-shadow: var(--card-shadow-hover); }

/* ── Relational Node ── */
.relational-node {
  background: var(--bg-surface); border: 1px solid var(--border-color);
  border-radius: 14px; padding: 14px 18px; margin-bottom: 12px;
  transition: all 0.2s cubic-bezier(0.16,1,0.3,1);
}
.relational-node:hover { border-color: var(--primary); box-shadow: var(--card-shadow-hover); transform: translateY(-2px); }

/* ── Bridge Buttons ── */
.bridge-btn { font-size: 0.8rem; font-weight: 700; padding: 4px 12px; border-radius: 20px; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; transition: all 0.2s cubic-bezier(0.16,1,0.3,1); }
.bridge-btn:hover { transform: translateY(-1px); }
.bridge-cours { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
.bridge-cours:hover { background: #fde68a; color: #78350f; }
.bridge-exo { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
.bridge-exo:hover { background: #fecaca; color: #7f1d1d; }
.bridge-eval { background: #e0f2fe; color: #075985; border: 1px solid #bae6fd; }
.bridge-eval:hover { background: #bae6fd; color: #0c4a6e; }
.bridge-scan { background: var(--bg-surface-secondary); color: var(--text-heading); border: 1px solid var(--border-color); }
.bridge-scan:hover { background: var(--bg-surface-elevated); color: var(--primary); }
.bridge-prog { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
.bridge-prog:hover { background: #bbf7d0; color: #14532d; }

/* ── Scan Grid ── */
.scan-grid-card { background: var(--bg-surface); border-radius: 14px; border: 1px solid var(--border-color); box-shadow: var(--card-shadow); overflow: hidden; transition: all 0.25s cubic-bezier(0.16,1,0.3,1); }
.scan-grid-card:hover { transform: translateY(-4px); box-shadow: var(--card-shadow-hover); border-color: var(--primary); }
.scan-thumb-wrap { height: 220px; overflow: hidden; background: #0f172a; position: relative; cursor: pointer; }
.scan-thumb-wrap img { width: 100%; height: 100%; object-fit: cover; object-position: top; transition: transform 0.3s ease; }
.scan-thumb-wrap:hover img { transform: scale(1.05); }

/* ── Splash Screen ── */
.splash-screen { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: radial-gradient(circle at center, #1e293b 0%, #070d1e 100%); z-index: 99999; display: flex; flex-direction: column; justify-content: center; align-items: center; color: #fff; transition: opacity 0.6s cubic-bezier(0.4,0,0.2,1); }
.splash-card { background: rgba(15,23,42,0.85); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.12); border-radius: 28px; padding: 40px; max-width: 600px; width: 90%; text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5), 0 0 40px rgba(37,99,235,0.2); }
.splash-icon { font-size: 3.5rem; color: #f59e0b; margin-bottom: 20px; animation: pulseGlow 2s infinite ease-in-out; }
.splash-progress-track { background: rgba(255,255,255,0.1); height: 10px; border-radius: 20px; overflow: hidden; margin: 24px 0 16px 0; }
.splash-progress-bar { height: 100%; width: 0%; background: linear-gradient(90deg, #3b82f6, #10b981, #f59e0b); border-radius: 20px; transition: width 0.1s ease-out; box-shadow: 0 0 15px rgba(16,185,129,0.8); }
@keyframes pulseGlow { 0%,100% { transform: scale(1); filter: drop-shadow(0 0 15px rgba(245,158,11,0.5)); } 50% { transform: scale(1.08); filter: drop-shadow(0 0 25px rgba(37,99,235,0.8)); } }

/* ── Automation ── */
.auto-card { background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 20px; padding: 24px; box-shadow: var(--card-shadow); margin-bottom: 24px; }
.console-terminal { background: #050811; border: 1px solid rgba(255,255,255,0.15); border-radius: 16px; padding: 20px; font-family: 'Consolas','Courier New',monospace; font-size: 0.95rem; color: #10b981; min-height: 280px; max-height: 460px; overflow-y: auto; white-space: pre-wrap; direction: ltr; text-align: left; box-shadow: inset 0 0 20px rgba(0,0,0,0.8); }
.step-pill { background: var(--bg-card-inner); border: 1px solid var(--border-color); border-radius: 12px; padding: 12px 16px; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between; }

/* ── Didactic Rubrics (Library) ── */
.didactic-rubric-discover { background: linear-gradient(135deg, rgba(37,99,235,0.08) 0%, rgba(59,130,246,0.03) 100%); border-right: 5px solid #2563eb; border-radius: 8px; padding: 10px 16px; margin: 20px 0 12px 0; font-weight: 800; font-size: 1.15rem; color: #1e40af; }
.didactic-rubric-learn { background: linear-gradient(135deg, rgba(234,179,8,0.10) 0%, rgba(202,138,4,0.04) 100%); border: 2px solid #eab308; border-radius: 12px; padding: 12px 18px; margin: 20px 0; font-weight: 800; font-size: 1.15rem; color: #854d0e; }
.didactic-rubric-methods { background: linear-gradient(135deg, rgba(168,85,247,0.08) 0%, rgba(147,51,234,0.03) 100%); border-right: 5px solid #9333ea; border-radius: 8px; padding: 10px 16px; margin: 20px 0 12px 0; font-weight: 800; font-size: 1.15rem; color: #6b21a8; }
.didactic-rubric-now { background: linear-gradient(135deg, rgba(22,163,74,0.08) 0%, rgba(34,197,94,0.03) 100%); border: 2px dashed #16a34a; border-radius: 10px; padding: 10px 16px; margin: 18px 0; font-weight: 800; font-size: 1.1rem; color: #15803d; }
.didactic-rubric-assess { background: linear-gradient(135deg, rgba(13,148,136,0.10) 0%, rgba(20,184,166,0.04) 100%); border-right: 5px solid #0d9488; border-radius: 10px; padding: 12px 18px; margin: 20px 0; font-weight: 800; font-size: 1.15rem; color: #0f766e; }
.didactic-remediation-badge { display: inline-flex; align-items: center; gap: 6px; background: #0d9488; color: #fff !important; padding: 4px 12px; border-radius: 20px; font-size: 0.85rem; font-weight: 700; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 2px 6px rgba(13,148,136,0.25); margin: 2px 4px; }
.didactic-remediation-badge:hover { background: #0f766e; transform: translateY(-1px); }

/* ── KaTeX LTR Isolation & BiDi Textes Mixtes (Arabe + FR/EN) ── */
.katex { direction: ltr !important; unicode-bidi: isolate !important; text-align: left !important; display: inline-block; font-family: KaTeX_Main, 'Times New Roman', serif !important; }
.katex-display { direction: ltr !important; unicode-bidi: isolate !important; text-align: center !important; margin: 1.2em 0 !important; overflow-x: auto; overflow-y: hidden; padding: 8px 0; }
.bidi-isolate, .latin-term, .code-snippet, .chem-formula, .shiki-container, [dir="ltr"] {
  direction: ltr !important; unicode-bidi: isolate !important; text-align: left;
}
.bidi-inline-latin { display: inline-block; direction: ltr !important; unicode-bidi: isolate !important; }
.content-box, .rendered-html-container { unicode-bidi: plaintext; }

/* ── Tables Markdown Rendues ── */
.content-box table, .rendered-html-container table { width: 100%; margin: 1.5rem 0; border-collapse: separate; border-spacing: 0; border-radius: 12px; overflow: hidden; border: 1px solid var(--border-color); box-shadow: 0 4px 15px rgba(0,0,0,0.04); }
.content-box table th, .rendered-html-container table th { background: linear-gradient(135deg, #1e3a8a, #2563eb); color: #fff; font-weight: 700; padding: 12px 16px; text-align: center; font-family: 'Cairo', sans-serif; }
.content-box table td, .rendered-html-container table td { padding: 12px 16px; border-bottom: 1px solid var(--border-color); border-right: 1px solid var(--border-color); vertical-align: middle; text-align: center; line-height: 1.8; }
.content-box table tr:nth-child(even) { background-color: var(--bg-surface-secondary); }
.content-box table tr:hover { background-color: rgba(37,99,235,0.05); }
[data-theme="dark"] .rendered-html-container table { background-color: var(--bg-surface) !important; color: var(--text-main) !important; }
[data-theme="dark"] .rendered-html-container th, [data-theme="dark"] .rendered-html-container td { border-color: var(--border-color) !important; color: var(--text-main) !important; }

/* ── Matrix Trimestre Card ── */
.matrix-trim-card { background: var(--bg-surface); border-radius: 20px; border: 1px solid var(--border-color); box-shadow: var(--card-shadow); margin-bottom: 20px; overflow: hidden; transition: transform 0.2s ease; }

/* ── Target Highlight (scroll-to animation) ── */
.target-highlight { animation: targetFlashGlow 2.2s cubic-bezier(0.16,1,0.3,1) forwards !important; z-index: 20; position: relative; }
@keyframes targetFlashGlow {
  0% { background-color: #fef08a !important; border-color: #f59e0b !important; box-shadow: 0 0 35px rgba(245,158,11,0.6) !important; transform: scale(1.02); }
  60% { background-color: rgba(254,240,138,0.45); border-color: #f59e0b; box-shadow: 0 0 20px rgba(245,158,11,0.3); transform: scale(1.005); }
  100% { background-color: var(--bg-surface); border-color: var(--border-color); box-shadow: var(--card-shadow); transform: scale(1); }
}

/* ── Workspace Tab Animation ── */
.workspace-tab { animation: tabFadeSlide 0.35s cubic-bezier(0.16,1,0.3,1) forwards; }
@keyframes tabFadeSlide { 0% { opacity: 0; transform: translateY(12px) scale(0.995); } 100% { opacity: 1; transform: translateY(0) scale(1); } }

/* ── Floating Sidebar Toggle (mobile) ── */
.floating-sidebar-toggle { position: fixed; bottom: 24px; right: 24px; z-index: 1050; background: var(--primary); color: #fff; border: none; width: 54px; height: 54px; border-radius: 50%; box-shadow: 0 6px 20px rgba(37,99,235,0.4); display: flex; align-items: center; justify-content: center; font-size: 1.25rem; cursor: pointer; transition: all 0.2s cubic-bezier(0.16,1,0.3,1); }
.floating-sidebar-toggle:hover { transform: scale(1.1); }
@media (min-width: 993px) { .floating-sidebar-toggle { display: none; } }

/* ── Scans Side Rail ── */
.scans-side-rail { position: sticky; top: 70px; max-height: calc(100vh - 100px); overflow-y: auto; background: var(--bg-surface-secondary); border-radius: 14px; padding: 14px; border: 1px solid var(--border-color); }

/* ── Footer ── */
footer { border-top: 1px solid var(--border-color); padding: 30px 0; margin-top: 60px; text-align: center; color: var(--text-muted); font-size: 0.9rem; }
```

---

## **PARTIE 3 : INTERFACES TYPESCRIPT (DTO)**

### **3.1 src/types/index.ts (Imposé)**

```typescript
export interface DatabaseMetrics {
  document_count: number;
  chunk_count: number;
  artifact_count: number;
  page_count: number;
  indexed_page_count: number;
}

export interface DatabaseInfo {
  filename: string;
  size_bytes: number;
  last_modified: string;
  metrics: DatabaseMetrics;
}

export interface SystemHealth {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  queue_length: number;
  vector_engine: 'sqlite-vec' | 'fts5-fallback';
  vector_engine_status: 'ready' | 'fallback_bm25_only' | 'error';
  vector_engine_message: string;
  force_sqlite_vec: boolean;
}

export interface Document {
  id: string;
  title: string;
  filename: string;
  total_pages: number;
  doc_type: string;
  academic_level: string | null;
  domain_tags_json: string;
  created_at: string;
}

export interface TocNode {
  id: string;
  parent_id: string | null;
  level: number;
  title: string;
  page_start: number;
  page_end: number | null;
  children?: TocNode[];
}

export interface Chunk {
  id: string;
  page_number: number;
  chunk_index: number;
  section_title: string | null;
  content_markdown: string;
  pedagogical_type: PedagogicalType | null;
  pedagogical_index: number | null;  // V3.5 : numéro d'exercice/leçon extrait — badge des cartes Vue 2
  has_solution: 0 | 1;
  is_human_edited: 0 | 1;            // V3.2/V3.5 : badge « مصحّح يدويًا »
  updated_at: string | null;         // V3.5 : date de correction humaine
  token_count: number | null;
}

export type PedagogicalType =
  | 'course_theory' | 'proof_demonstration' | 'exercise_unsolved'
  | 'exercise_solved' | 'solution_only' | 'evaluation_exam'
  | 'practical_work' | 'general_content';

export interface Artifact {
  id: string;
  domain: string;
  artifact_type: string;
  raw_data: string | null;
  raw_binary: null; // BLOB jamais sérialisé en JSON — les binaires sont servis via /library/page-scan (image/webp)
  render_config_json: string;
  caption: string | null;
  bounding_box_json: string | null;
}

export interface FacetItem {
  domain?: string;
  pedagogical_type?: string;
  artifact_type?: string;
  count: number;
}

export interface Facets {
  domains: FacetItem[];
  pedagogical_types: FacetItem[];
  artifact_types: FacetItem[];
}

// ── Curriculum (V3.1 — D1-B, tables optionnelles) ──
export interface CurriculumTerm { id: string; term_index: number; label: string; }
export interface CurriculumProgram { id: string; term_id: string | null; seq_index: number | null; title: string; source: string | null; competencies_json: string | null; }
export interface Assessment { id: string; document_id: string | null; term_id: string | null; kind: 'devoir' | 'composition' | 'examen' | 'autre'; title: string; subject_chunk_id: string | null; correction_chunk_id: string | null; scale_json: string | null; }
export interface ContentLink { id: string; link_type: 'course_exercise' | 'course_program' | 'course_scan' | 'exercise_scan' | 'assessment_scan' | 'program_term'; from_id: string; to_id: string; page_number: number | null; }
export interface CurriculumPayload { curriculum_available: boolean; terms: CurriculumTerm[]; programs: CurriculumProgram[]; assessments: Assessment[]; links: ContentLink[]; }

export interface PipelineJob {
  id: string;
  document_id: string;
  page_number: number;
  status: PipelineStatus;
  retry_count: number;
  error_log: string | null;
  updated_at: string;
}

export type PipelineStatus =
  | 'QUEUED' | 'PROCESSING_CV' | 'SEGMENTING' | 'EXTRACTING'
  | 'LINTING' | 'VLM_RECOVERY' | 'INDEXED' | 'READY'
  | 'QUARANTINE' | 'INVALID_SOURCE';

export interface SearchResult {
  chunk_id: string;
  document_id: string;
  document_title: string;
  page_number: number;
  section_title: string | null;
  pedagogical_type: PedagogicalType | null;
  content_markdown: string;            // V3.1 : aligné sur la réponse du contrat Blueprint Partie 7
  rrf_score: number;
  bm25_rank: number | null;            // V3.1
  vec_rank: number | null;             // V3.1 (null en mode fts5-fallback)
  database_filename?: string;          // V3.1 : renseigné par /search/hybrid-multi
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; total_pages: number; };
}

export interface LlmKey {
  id: string;
  provider: LlmProvider;
  masked_key: string; // V3.1 : la clé en clair n'est retournée que par POST /llm/keys/{id}/reveal
  status: 'active' | 'blocked' | 'disabled';
  blocked_until: string | null;
  last_error_code: number | null;
  created_at: string;
}

export type LlmProvider = 'gemini' | 'groq' | 'openai' | 'anthropic' | 'ollama';

export interface LlmSetting {
  provider: LlmProvider;
  active_model: string | null;
  is_enabled: boolean;
  priority: number;
}

export type BatchStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'STOPPED' | 'FAILED'; // V3.1.1

export interface PipelineSSEEvent {
  // V3.1.1 : champ-par-champ aligné sur le contrat SSE Blueprint Partie 7.4
  type: 'page_update' | 'queue_update' | 'job_complete' | 'error';
  batch_id?: string;
  job_id?: string;
  page_number?: number;          // page_update, error
  status?: PipelineStatus;       // page_update
  ram_mb?: number;               // page_update
  latency_ms?: number;           // page_update (alimente la carte ETA & Débit)
  line?: string;                 // page_update (console)
  queue_length?: number;         // queue_update
  pages_indexed?: number;        // job_complete
  artifacts_extracted?: number;  // job_complete
  done?: boolean;                // job_complete
  success?: boolean;             // job_complete
  error?: string;                // error
  details?: string;              // error
}

export interface BatchStatusResponse { // V3.1.1
  batch_id: string;
  status: BatchStatus;
  pages_total: number;
  pages_done: number;
  current_page: { page_number: number; status: PipelineStatus; retry_count: number; error_log: string | null } | null;
  updated_at: string;
}
```

---

## **PARTIE 4 : CONTEXTS & CLIENT API**

### **4.1 DatabaseContext.tsx (Imposé)**

```typescript
import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { api } from '@/lib/api'
import type { DatabaseInfo } from '@/types'

interface DatabaseContextValue {
  databases: DatabaseInfo[];
  activeDb: string | null;
  setActiveDb: (db: string) => void;
  isLoading: boolean;
  refresh: () => void;
}

const DatabaseContext = createContext<DatabaseContextValue | null>(null)

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [databases, setDatabases] = useState<DatabaseInfo[]>([])
  const [activeDb, setActiveDb] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refresh = async () => {
    setIsLoading(true)
    try {
      const res = await api.system.getDatabases()
      setDatabases(res.databases)
      if (!activeDb && res.databases.length > 0) setActiveDb(res.databases[0].filename)
    } catch (e) { console.error('[DatabaseContext] Erreur:', e) }
    finally { setIsLoading(false) }
  }

  useEffect(() => { refresh() }, [])

  return (
    <DatabaseContext.Provider value={{ databases, activeDb, setActiveDb, isLoading, refresh }}>
      {children}
    </DatabaseContext.Provider>
  )
}

export function useDatabase(): DatabaseContextValue {
  const ctx = useContext(DatabaseContext)
  if (!ctx) throw new Error('useDatabase must be used inside DatabaseProvider')
  return ctx
}
```

### **4.2 ThemeContext.tsx (Imposé)**

```typescript
import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

type Theme = 'dark' | 'light'

interface ThemeContextValue { theme: Theme; toggleTheme: () => void; }

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('ragdom_theme') as Theme) || 'dark')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('ragdom_theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
```

### **4.3 LanguageContext.tsx (i18n Trilingue — Arabe Défaut / FR / EN Imposé)**

```typescript
import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

export type Language = 'ar' | 'fr' | 'en'

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  isRtl: boolean;
  t: (key: string) => string;
}

// Dictionnaires de base pour l'UI (locales)
import arLocale from '@/locales/ar.json'
import frLocale from '@/locales/fr.json'
import enLocale from '@/locales/en.json'

const translations: Record<Language, Record<string, any>> = {
  ar: arLocale,
  fr: frLocale,
  en: enLocale,
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    return (localStorage.getItem('ragdom_lang') as Language) || 'ar' // ARABE PAR DÉFAUT ABSOLU
  })

  const isRtl = language === 'ar'

  const setLanguage = (lang: Language) => {
    setLanguageState(lang)
    localStorage.setItem('ragdom_lang', lang)
  }

  useEffect(() => {
    // Bascule dynamique RTL ↔ LTR selon la langue active
    document.documentElement.setAttribute('lang', language)
    document.documentElement.setAttribute('dir', isRtl ? 'rtl' : 'ltr')
  }, [language, isRtl])

  // Helper de traduction imbriqué : t('dashboard.title')
  const t = (key: string): string => {
    const keys = key.split('.')
    let current: any = translations[language] || translations.ar
    for (const k of keys) {
      if (current && typeof current === 'object' && k in current) {
        current = current[k]
      } else {
        // Fallback sur l'Arabe si la clé est manquante
        let fallback: any = translations.ar
        for (const fk of keys) {
          if (fallback && typeof fallback === 'object' && fk in fallback) fallback = fallback[fk]
          else return key
        }
        return typeof fallback === 'string' ? fallback : key
      }
    }
    return typeof current === 'string' ? current : key
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage, isRtl, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used inside LanguageProvider')
  return ctx
}
```

### **4.4 lib/api.ts (Client Centralisé Imposé)**

```typescript
const BASE_URL = '/api'

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(error.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

function withDb(endpoint: string, db: string, params?: Record<string, string>): string {
  const p = new URLSearchParams({ db, ...params })
  return `${endpoint}?${p.toString()}`
}

export const api = {
  system: {
    getDatabases: () => request<{ databases: import('@/types').DatabaseInfo[] }>('/system/databases'),
    getHealth: () => request<import('@/types').SystemHealth>('/system/health'),
    toggleVectorStrict: (forceStrict: boolean) =>
      request<{ success: boolean; force_sqlite_vec: boolean; message: string }>('/system/vector-engine/toggle-strict', {
        method: 'POST', body: JSON.stringify({ force_sqlite_vec: forceStrict })
      }),
    testVectorEngine: () => request<{ success: boolean; engine: string; message: string }>('/system/vector-engine/test', { method: 'POST' }),
  },
  library: {
    getDocuments: (db: string, page = 1, limit = 50) =>
      request(withDb('/library/documents', db, { page: String(page), limit: String(limit) })),
    getToc: (db: string, documentId: string) =>
      request(withDb('/library/toc', db, { document_id: documentId })),
    getFacets: (db: string) =>
      request<import('@/types').Facets>(withDb('/library/facets', db)),
    getCurriculum: (db: string) =>
      request<import('@/types').CurriculumPayload>(withDb('/library/curriculum', db)), // V3.1 — D1-B
    getChunks: (db: string, documentId: string, page = 1) =>
      request(withDb('/library/chunks', db, { document_id: documentId, page: String(page) })),
    getArtifacts: (db: string, chunkId: string) =>
      request(withDb('/library/artifacts', db, { chunk_id: chunkId })),
    getPageScanUrl: (db: string, documentId: string, pageNumber: number, thumb = false) =>
      // V3.5 : servi depuis la table page_scans (base autonome). thumb=true → vignette pour galeries virtualisées.
      `${BASE_URL}${withDb('/library/page-scan', db, { document_id: documentId, page: String(pageNumber), ...(thumb ? { thumb: 'true' } : {}) })}`,
  },
  search: {
    hybrid: (db: string, query: string, topK = 5, filters?: Record<string, string>) =>
      request<{ results: import('@/types').SearchResult[] }>(`/search/hybrid?db=${db}`, {
        method: 'POST', body: JSON.stringify({ query, top_k: topK, ...(filters ? { filters } : {}) }),
      }),
    hybridMulti: (databases: string[], query: string, topK = 5) =>
      request<{ results: import('@/types').SearchResult[] }>('/search/hybrid-multi', {
        method: 'POST', body: JSON.stringify({ query, databases, top_k: topK }),
      }),
  },
  pipeline: {
    getQueue: () => request('/pipeline/queue'),
    start: (payload: { source_path: string; target_db: string; mode: 'document' | 'chapter' | 'page_range' | 'folder'; page_start?: number; page_end?: number; toc_id?: string }) =>
      request<{ batch_id: string; status: import('@/types').BatchStatus; pages_total: number }>('/pipeline/start', {
        method: 'POST', body: JSON.stringify(payload),
      }),
    getStatus: (batchId: string) => request<import('@/types').BatchStatusResponse>(`/pipeline/status?batch_id=${batchId}`),
    stop: () => request<{ stopped: boolean; batch_id: string; last_completed_page: number }>('/pipeline/stop', { method: 'POST' }),
    cancelBatch: (batchId: string) => request(`/pipeline/batch/${batchId}`, { method: 'DELETE' }),
    reset: (db: string, documentId?: string) => // V3.1.1 : document_id optionnel (reset base entière)
      request(withDb('/pipeline/reset', db, documentId ? { document_id: documentId } : undefined), { method: 'POST' }),
    createStream: (): EventSource => new EventSource(`${BASE_URL}/pipeline/stream`),
  },
  llm: {
    getKeys: () => request<{ keys: import('@/types').LlmKey[] }>('/llm/keys'), // V3.1 : clés masquées (masked_key)
    revealKey: (keyId: string) => request<{ api_key: string }>(`/llm/keys/${keyId}/reveal`, { method: 'POST' }), // V3.1
    addKey: (provider: string, apiKey: string) =>
      request('/llm/keys', { method: 'POST', body: JSON.stringify({ provider, api_key: apiKey }) }),
    deleteKey: (keyId: string) => request(`/llm/keys/${keyId}`, { method: 'DELETE' }),
    getSettings: () => request<{ settings: import('@/types').LlmSetting[] }>('/llm/settings'),
    updateSettings: (provider: string, model: string, isEnabled: boolean) =>
      request('/llm/settings', { method: 'PUT', body: JSON.stringify({ provider, active_model: model, is_enabled: isEnabled }) }),
    testKey: (keyId: string) => request(`/llm/keys/${keyId}/test`, { method: 'POST' }),
  },
}
```

### **4.4 App.tsx (Imposé)**

```typescript
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { DatabaseProvider } from '@/contexts/DatabaseContext'
import IndexView from '@/views/IndexView'
import LibraryView from '@/views/LibraryView'
import AutomationView from '@/views/AutomationView'

export default function App() {
  return (
    <ThemeProvider>
      <DatabaseProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<IndexView />} />
            <Route path="/library" element={<LibraryView />} />
            <Route path="/automation" element={<AutomationView />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </DatabaseProvider>
    </ThemeProvider>
  )
}
```

---

## **PARTIE 5 : SPÉCIFICATIONS PIXEL-PERFECT DES 3 VUES**

### **5.1 VUE 1 — IndexView (Dashboard — index.php)**

#### **Header (Topbar)**
- Logo : icône `fa-atom` sur fond `bg-primary` bleu, `border-radius: rounded-3`
- Titre : **"RAGDom Library"** (font-heading Cairo, bold)
- Sous-titre : description courte (text-muted)
- Boutons droite : Lien `/automation` (`btn-outline-success rounded-pill` + `fa-gears`) → `ThemeToggle` → Lien `/library` (`btn-primary rounded-pill` + `fa-book-open`)

#### **Hero Section**
- `.hero-badge` dorée : icône `fa-certificate` + texte bienvenue
- H1 `.hero-title` : gradient blanc→gris en dark, noir en light
- `.hero-desc` : mention SQLite portables + recherche hybride
- `.hero-search-box` : input + `fa-magnifying-glass`, max-width 600px, redirige vers `/library?q=...`
- CTA : `btn-launch-hero` → `/library` + `btn-viewer-hero` → scroll `#dbsSection`

#### **Section 6 KPIs (agrégation depuis GET /api/system/databases)**

| Card | Icône | Couleur | Valeur |
|---|---|---|---|
| Documents totaux | `fa-file-pdf` | `text-primary` | Somme `document_count` |
| Chunks indexés | `fa-layer-group` | `text-info` | Somme `chunk_count` |
| Artefacts | `fa-atom` | `text-warning` | Somme `artifact_count` |
| Pages traitées | `fa-book-open` | `text-success` | Somme `page_count` |
| Pages indexées | `fa-check-circle` | `text-success` | Somme `indexed_page_count` |
| Bases actives | `fa-database` | `text-secondary` | Nombre de bases |

#### **Section Bases Disponibles**
`.portal-card` par base SQLite découverte. Contenu : nom, métriques, taille, badge statut, bouton → `/library?db={filename}`.

#### **Section Télémétrie (id="dbsSection")**
`.portal-card` global → pour chaque base : `.db-badge-row` avec icône `fa-database`, chemin, taille, nb lignes, badges tables.

#### **Footer**
```
RAGDom Library — Bibliothèque Numérique Scientifique Locale
Supervision : ArchiSys3.0 • Architecture : AImi
```

---

### **5.2 VUE 2 — LibraryView (library.php — Spécification Complète & Pixel-Perfect)**

> [!IMPORTANT]
> ### 🔀 MODE REPLI GÉNÉRIQUE (V3.1 — D1-B, Zéro Dogme)
> Au chargement, `LibraryView` appelle `GET /api/library/curriculum?db=...`. Si la réponse porte `curriculum_available: false` (tables curriculum vides), les onglets à structure curriculum (1. Matrice, 2. Programme, 5. Évaluations, et le filtre trimestre) sont **masqués**, et la vue affiche l'exploration générique : `TOCExplorer` + `SideBySideViewer` + `SearchStudio` + galerie de scans générique. Les 6 onglets pixel-perfect ne s'activent que sur une base dont les tables curriculum sont peuplées.
> **TOUS les compteurs** (exercices, modèles, scans) sont des agrégats API — jamais des constantes. Les valeurs « 690 / 27 / 272 » citées dans ce document sont des EXEMPLES du corpus 2G de référence, jamais des valeurs à coder.

La vue Bibliothèque est le cœur didactique et multimodal de RAGDom. Elle reproduit **au pixel près** l'ensemble des 6 onglets, menus, ponts relationnels et comportements dynamiques de `Template_UI-UX/library.php`.

---

#### **5.2.1 Splash Screen Télémétrique & Pipeline de Préchargement en Chunks**

* **Composant :** `SplashScreen.tsx` (ID `#splashScreen`).
* **Visuel :**
  - Fond radial sombre : `radial-gradient(circle at center, #1e293b 0%, #070d1e 100%)`.
  - Icône centrale : `fa-atom fa-spin` (`.splash-icon`, couleur `#f59e0b`, animation `pulseGlow` 2s).
  - Titre : `RAGDom Library (2G)` avec sous-titre dynamique affichant le niveau actif (`nom_ar`) et la matière active (`nom_ar`).
  - **Barre de progression tricolore :** `.splash-progress-bar` (dégradé horizontal `#3b82f6` bleu → `#10b981` vert → `#f59e0b` orange) avec halo lumineux `box-shadow: 0 0 15px rgba(16, 185, 129, 0.8)`.
  - Badges métriques en bas de carte : nombre de مقاطع, دروس, تمارين, اختبارات, صفحة كتاب, وثيقة اختبار.
* **Comportement & Algorithme Asynchrone :**
  - Traitement par tranches (**chunk size = 35 éléments** par cycle via `requestAnimationFrame`) pour éviter tout gel du thread UI.
  - Progression dynamique du texte d'état :
    - `< 25%` : `📋 جاري تهيئة المنهاج والتدرج السنوي الرسمي...`
    - `< 50%` : `📘 جاري تجميع الدروس والمخططات الهندسية...`
    - `< 85%` : `📝 جاري معالجة وفهرسة التمارين والحلول (N / Total)...`
    - `< 100%` : `📑 جاري مطابقة الفروض والامتحانات الرسمية وسلالم التنقيط...`
    - `100%` : `✅ اكتملت التهيئة بنجاح! جاري فتح المستودع...`
  - Fondu de sortie : `opacity: 0` (transition 0.6s) puis démontage du DOM.

---

#### **5.2.2 Sidebar Multifonctions 360° & Raccourcis Clavier**

* **Conteneur :** `.app-sidebar` (largeur fixe 320px, position fixed à droite, z-index 1040, dégradé `var(--sidebar-bg)` → `var(--sidebar-bg-secondary)`).
* **Raccourci Clavier Universel :** `Ctrl + B` ou `Cmd + B` bascule l'ouverture/fermeture de la sidebar.
* **Composants du Sidebar (de haut en bas) :**
  1. **Header Sidebar :** Logo `fa-atom` dans carré bleu `bg-primary`, titre *"RAGDom Hub (2G)"*, sous-titre *"المنظومة البيداغوجية الشاملة"*, bouton de fermeture `fa-xmark`.
  2. **Sélecteur de Niveau Scolaire :** Dropdown Bootstrap stylé avec bouton sombre bordure dorée.
     - Section *Moyen (1AM, 2AM, 3AM, 4AM-BEM)* avec badges d'état (`مكتمل 100%` vert ou `قريباً` gris).
     - Section *Primaire (1AP, 5AP)* et *Secondaire (1AS, 3AS-BAC)*.
  3. **Sélecteur de Matière (8 disciplines) :** Dropdown stylé avec bordure cyan, affichant les 8 matières avec leurs icônes FA et couleurs (Maths, Physique, SVT, Arabe, Français, Anglais, Histoire-Géo, Islamique).
  4. **Sélecteur de Trimestre Global (Filtre 360°) :** 
     - Menu déroulant à bordure verte avec options : `جميع الفصول (360°)`, `الفصل الأول 🍂`, `الفصل الثاني ❄️`, `الفصل الثالث 🌸`.
     - **Fonction `applyGlobalTrimestreFilter(trimNum)` :** Au clic, filtre **instantanément et simultanément l'ensemble des 6 onglets** du workspace (Matrice, Programme, Cours, Exercices, Évaluations, Scans) sans rechargement de page.
  5. **Barre de Recherche Multi-Onglets (Master Search) :** Input sombre avec debounce de 150ms et bouton d'effacement rapide `fa-xmark`. Filtre en temps réel les cartes de tous les onglets.
  6. **Sélecteur Direct de Page (Page Jumper) :** Input numérique avec préfixe `ص` et bouton flèche. Permet de saisir un numéro de page (ex: 18) et d'effectuer un saut automatique vers le cours ou le scan correspondant via la table des correspondances.
  7. **Boutons de Navigation vers les 6 Onglets :** `.sidebar-nav-btn` avec icônes colorées, badge de compteur dynamique pour chaque section, et état `.active` (fond bleu `var(--primary)` + ombre portée).
  8. **Footer Sidebar :** Sélecteur de thème Dark/Light, lien vers `Automation Hub` (`btn-outline-success`), lien vers `Dashboard` (`btn-primary`), et lien vers `Viewer classique`.

---

#### **5.2.3 Topbar du Workspace (Épurée & Sticky)**

* **Conteneur :** `.workspace-topbar` (sticky top: 0, z-index 1020, backdrop-filter blur 12px, border-bottom).
* **Éléments Gauche :** Bouton retour Portail (`btn-outline-primary rounded-pill`), bouton Automation (`btn-outline-success rounded-pill`), bouton toggle Sidebar (`btn-outline-secondary rounded-pill`), et fil d'Ariane breadcrumb (`Niveau / Matière / Nom de l'onglet actif`).
* **Éléments Droite :** Badge doré indiquant le nombre de pages de livre et de documents scannés, badge vert *"قاعدة بيانات معتمدة"* (ou gris *"قاعدة غير مبنية"*).

---

#### **5.2.4 Les 6 Onglets Principaux du Workspace**

##### **1. Onglet 1 : المصفوفة الشاملة 360° (Curriculum Matrix)**
* **Header :** Titre avec icône `fa-sitemap text-warning`, boutons globaux *"فتح الفصول"* (`toggleAllMatrixCards(true)`) et *"طي الكل"*.
* **Structure :** 3 cartes repliables de trimestre `.matrix-trim-card` (Trimestre 1 primary / Trimestre 2 info / Trimestre 3 success) avec icônes de saison (🍂❄️🌸) et compteurs de مقاطع, دروس, تمارين, اختبارات.
* **Contenu des colonnes :**
  - **Colonne 1 (8/12) :** Liste des nœuds relationnels `.relational-node` pour chaque cours avec badge numéro, titre, plage de pages (📄 ص X إلى Y), séquence liée, et **rangée de ponts relationnels (Bridge Buttons) :**
    - `.bridge-cours` : *"قراءة نص الدرس"* → bascule vers l'onglet Cours et illumine le texte.
    - `.bridge-exo` : *"N تمارين مرتبطة"* → bascule vers l'onglet Exercices filtré sur ce cours.
    - `.bridge-prog` : *"المقطع الوزاري"* → bascule vers l'onglet Programme et cible la séquence.
    - `.bridge-scan` : *"مسح الكتاب (ص X)"* → bascule vers l'onglet Scans et cible la page de début.
  - **Colonne 2 (4/12) :** Liste des modèles d'évaluations et examens liés à ce trimestre avec bouton `.bridge-eval` *"معاينة الموضوع والحل"*.

##### **2. Onglet 2 : المنهاج والتدرج السنوي (Programme Officiel MEN 2G)**
* **Header :** Titre `fa-graduation-cap text-success` avec sous-titre descriptif du référentiel officiel 2G.
* **Grille de Cartes :** Cartes `.programme-card` en grille responsive 2 colonnes (`col-12 col-lg-6`).
* **Contenu de chaque carte :**
  - Header : Badge numéro de مقطع (`#1`, `#2`...), badge trimestre, et badge source officielle (ex: *"وزارة التربية الوطنية"*).
  - Titre : Nom du projet ou de la séquence pédagogique.
  - Encadré central (`bg-surface-secondary`) : *"الموارد المعرفية والمفاهيم المستهدفة"* (concepts et compétences).
  - Footer avec ponts directs : Boutons vers les cours rattachés (avec pagination) et boutons vers les exercices du مقطع.

##### **3. Onglet 3 : مستودع الدروس والمفاهيم (Cours & Notions KaTeX)**
* **Header :** Titre `fa-book-open text-primary`, boutons globaux *"فتح كل الدروس"* (`toggleAllCoursBodies(true)`) et *"طي الكل"*.
* **Affichage par Cours (`.cours-item-card`) :**
  - Header du cours : Badge numéro de leçon, titre complet, badge trimestre, badge de pages (`ص X - Y`), et bouton d'action principal :
  - **Bouton Side-by-Side :** *"وثائق صفحات الكتاب (ص X-Y)"* (`toggleCoursScansSideBySide(coursId)`).
* **Comportement Side-by-Side Fluide (`.fluid-pane`) :**
  - **État standard (100%) :** Le texte KaTeX occupe `col-12`.
  - **État parallèle (50/50) :** La colonne texte passe à `col-xl-6` et la colonne latérale `.scans-side-rail` s'ouvre à `col-xl-6` avec animation fluide.
  - **Contenu du rail latéral (`.scans-side-rail`) :** Affiche toutes les pages originales scannées du livre comprises entre `page_debut` et `page_fin`, chacune avec son en-tête, numéro de page, et bouton *"تكبير"* ouvrant la modale HD plein écran.

##### **4. Onglet 4 : بنك التمارين والأنشطة (Banque d'Exercices & Activités)**
* **Header :** Titre `fa-pen-ruler text-danger` avec compteur (ex: *690 تمريناً*), texte d'état dynamique de filtre (`#exoFilterStatus`), groupe de filtres par trimestre (`الكل`, `ف 1`, `ف 2`, `ف 3`), et boutons d'expansion globale *"فتح الحلول"* / *"طي الحلول"*.
* **Grille d'Exercices :** Cartes `.exo-grid-item` en grille 2 colonnes (`col-12 col-xl-6`).
* **Détails de chaque carte exercice :**
  - Header : Badge numéro d'exercice, badge de page du livre (`📄 ص X`), badge trimestre, bouton pont vers le cours (`.bridge-cours`), bouton pont vers le scan (`.bridge-scan`), et bouton œil ouvrant la prévisualisation du scan original de la page.
  - **Collapse du Scan de Page :** Affiche la page originale du livre avec lien d'agrandissement plein écran.
  - **Énoncé de l'Exercice :** Rendu KaTeX formaté dans un encadré stylisé.
  - **Solution / Corrigé Type :** Section repliable avec bouton *"إظهار الحل"* révélant la correction complète rendue KaTeX sur fond vert subtil (`rgba(16, 185, 129, 0.08)`).

##### **5. Onglet 5 : الفروض والاختبارات (Évaluations & Examens Officiels)**
* **Header :** Titre `fa-file-signature text-info` (ex: *27 نموذجاً*).
* **Cartes d'Évaluations (`.eval-item-card`) :**
  - Header : Badge numéro de sujet, intitulé officiel (ex: *"الفرض الأول للفصل الأول"*), badge trimestre.
  - Bouton *"معاينة متوازية (موضوع + تصحيح)"* (`toggleEvalSideBySide(evalId)`).
  - Boutons d'accès direct aux images originales des sujets (`.bridge-eval`) et des corrigés (`.bridge-cours`).
* **Mode Parallèle Sujet / Corrigé (50/50) :**
  - Colonne Gauche : Énoncé complet du sujet d'examen rendu KaTeX.
  - Colonne Droite : Éléments de réponse, barème et corrigé type rendu KaTeX sur fond vert d'évaluation.

##### **6. Onglet 6 : المستودع البصري (Galerie Complète des Scans)**
* **Header :** Titre `fa-images text-warning` avec total des documents (ex: *272 وثيقة : 201 pages livre + 71 scans examens*).
* **Filtres de la Galerie :**
  - Boutons catégories : `الكل`, `📚 صفحات الكتاب`, `📑 وثائق الاختبارات`.
  - Séparateur vertical puis filtres trimestres : `ف 1`, `ف 2`, `ف 3`.
* **Grille des Vignettes (`.scan-grid-card`) :** Grille responsive (`col-6 col-md-4 col-lg-3 col-xl-2`).
* **Vignette de Page de Livre :**
  - Image avec effet zoom au hover (`transform: scale(1.05)`).
  - Badge de numéro de page en haut à gauche (`ص X`), badge de trimestre en bas à droite.
  - Titre du cours associé en bas de vignette avec badge cliquable affichant le nombre d'exercices de cette page (au clic : filtre et bascule vers les exercices de cette page).
  - Bouton de lecture du cours et bouton d'agrandissement modale HD.
* **Vignette de Scan d'Examen :** Bordure cyan/verte distinctive, badge type de document (*موضوع امتحان* ou *حل وسلّم تنقيط*), et pont direct vers le sujet dans l'onglet Évaluations.

---

#### **5.2.5 Moteur Universel d'Animation et de Ponts Relationnels (Le Halo Radiant Flash)**

* **Fonction `highlightAndFocusElement(targetEl, tabKey)` :**
  - Bascule automatiquement vers l'onglet cible `tabKey`.
  - Si l'élément est dans une section repliée, l'ouvre automatiquement (équivalent React contrôlé du `bootstrap.Collapse.show()` du template PHP — cf. Règle 12, §6).
  - Déclenche un défilement doux centré à l'écran : `targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' })`.
  - Applique la classe d'animation `.target-highlight` :
    ```css
    @keyframes targetFlashGlow {
      0%   { background-color: #fef08a !important; border-color: #f59e0b !important; box-shadow: 0 0 35px rgba(245,158,11,0.6) !important; transform: scale(1.02); }
      60%  { background-color: rgba(254,240,138,0.45); border-color: #f59e0b; box-shadow: 0 0 20px rgba(245,158,11,0.3); transform: scale(1.005); }
      100% { background-color: var(--bg-surface); border-color: var(--border-color); transform: scale(1); }
    }
    ```
  - Le halo doré persiste 2.3 secondes avant de revenir à l'état normal.
* **Fonctions de Ponts Dédiées :** `jumpToProgramme(id)`, `jumpToCours(id)`, `jumpToExo(id)`, `jumpToEval(id)`, `jumpToScanPage(pageNum)`.

---

#### **5.2.6 Moteur KaTeX Monopasse Déterministe & Rubriques Didactiques 2G**

Le parseur Markdown/KaTeX côté frontend (`renderMarkdownWithKaTeX`) applique une séquence stricte d'auto-guérison et de transformation :

1. **Auto-guérison des Tokens LaTeX :**
   - Réparation des préfixes : `rac{` → `\frac{`, `ext{` → `\text{`, `ight)` → `\right)`, `eft(` → `\left(`.
   - Correction des fractions altérées : `\frac 1{2}` → `\frac{1}{2}`, `\$frac` → `\frac`.
   - Normalisation des environnements matriciels : `\begin{aligned}...` encapsulé en `$$...$$`.
2. **Nettoyage des Formules :**
   - Remplacement des virgules arabes `،` par des virgules mathématiques `,` et `؛` par `;`.
   - Encapsulation des mots arabes isolés dans `\text{}` pour éviter le bris de rendu KaTeX.
3. **Protection des Blocs Mathématiques :** Extraction des blocs `$$...$$` (display) et `$..$` (inline) remplacés par des jetons `%%%MATHBLOCK_N%%%` avant le parsing Markdown (marked.js), puis réinjection via `katex.renderToString({ throwOnError: false, strict: "ignore", output: "html" })`.
4. **Transformation des Rubriques Didactiques Officielles 2G :**
   - `🧭 أكتشف` → `.didactic-rubric-discover` (bordure bleue `#2563eb`, activités et construction).
   - `📖 أتعلم / معارف` → `.didactic-rubric-learn` (cadre doré `#eab308`, savoirs et propriétés).
   - `💡 أكتسب طرائق` → `.didactic-rubric-methods` (bordure violette `#9333ea`, méthodes et modèles).
   - `✍️ دوري الآن` → `.didactic-rubric-now` (cadre vert pointillé `#16a34a`, application immédiate).
   - `🎯 أقوم تعلماتي` → `.didactic-rubric-assess` (bordure sarcelle `#0d9488`, auto-évaluation).
   - `أعود إلى الصفحة N` → Badge cliquable `.didactic-remediation-badge` ouvrant le scan de la page N.
5. **Composants Visuels Spéciaux :**
   - Bannières de pages : `### 📄 الصفحة N من الكتاب` → Bannière dégradée bleue avec bouton direct de scan.
   - Encadrés de géométrie : `#### 📐 الرسم والشكل الهندسي` → Carte `.visual-math-card` avec icône compas.
   - Figures et assets : `asset://figures/...` → Conteneur centré avec légende et cadre de mise en valeur.

---

#### **5.2.7 Modale HD Universelle des Scans (`#masterImageModal`)**

* Modale plein écran centrée (`modal-xl modal-dialog-centered`).
* Header sombre avec titre dynamique de la page ou du sujet affiché.
* Image HD avec gestion automatique des erreurs (`onerror`) et fallbacks successifs (`page_00X.jpg`, `page_X.png`, `page_00X.png`).
* Bouton d'action pour zoomer et naviguer entre les pages adjacentes.

---

### **5.3 VUE 3 — AutomationView (automation.php)**

#### **Header**
Logo `fa-gears` sur fond `bg-success` vert. Titre "RAGDom Automation Hub". Boutons : ThemeToggle + `/` Dashboard + `/library` Bibliothèque.

#### **Sélecteur de Base**
Dropdown depuis `DatabaseContext.databases`. Change la base → recharge les métriques.

#### **Status Live (`.auto-card`)**
Badge base active + titre : 🟢 "Base {nom} opérationnelle (N chunks · N Ko)" ou 🔴 "Non indexée". Bouton "Réinitialiser" (`btn-outline-danger`).

#### **Carte ETA & Débit (`.auto-card`) — V3.1 (D4-A)**
Affichée pendant un batch : débit courant (pages/h, moyenne mobile des 10 dernières pages depuis `processing_benchmarks.execution_time_ms`), pages restantes, heure de fin estimée (temps de chargement moteur inclus), badge du moteur ML actuellement résident (Cycle de Vie des Moteurs D2-B). Mise à jour via SSE `page_update`.

#### **Bandeau d'Alerte Moteur Vectoriel & Contrôles R&D (`.auto-card`)**
Composant `VectorEngineAlert.tsx` connecté en temps réel à `api.system.getHealth()` :
- **État Hybride Actif (`vector_engine === 'sqlite-vec'`) :**
  - Badge vert `🟢 Moteur Hybride Actif (FTS5 BM25 + sqlite-vec 384d)`
  - Message informatif : "Recherche sémantique vectorielle opérationnelle."
- **État Dégradé Fallback (`vector_engine === 'fts5-fallback'`) :**
  - **Bandeau d'alerte orange/ambre persistant :** `⚠️ Attention : Mode dégradé FTS5 BM25 actif (sqlite-vec non chargé). La recherche sémantique vectorielle est désactivée ; seule la recherche plein-texte FTS5 est active.`
  - Bouton *"Tester le chargement sqlite-vec"* (`btn-sm btn-outline-warning`) → appelle `api.system.testVectorEngine()` et affiche le diagnostic direct dans une modale ou un toast.
- **Contrôle Mode Strict Forcé (Option A / Option B) :**
  - **Switch Toggle interactif :** *"Forcer le mode strict sqlite-vec"*
  - Label explicatif : `Si activé, l'échec de sqlite-vec bloque l'ingestion au lieu d'autoriser le fallback FTS5.`
  - Action onChange : appelle `api.system.toggleVectorStrict(checked)` avec notification de succès.

#### **4 Cards Pipeline**
1. **Ingestion Complète** (`btn-primary`) → scope=full
2. **Documents Textuels** (`btn-primary`) → scope=text
3. **Réindexer Artefacts** (`btn-info`) → scope=artifacts
4. **Pages Spécifiques** (`btn-outline-warning`) → nécessite input pages

#### **LLM Model Selector**
Header `fa-brain text-warning`. 4 radio-pills : ⚡ Flash → 🧠 Pro → 🛡️ Hybride → 🚀 Gemini 2.0. Data : `GET /api/llm/settings`. Changement : `PUT /api/llm/settings`.

#### **2 colonnes : Steps (5/12) + Console (7/12)**

**Steps** : 8 `.step-pill` (Couches 0→7). Badges : `bg-secondary` "Attente" → `bg-warning` "En cours" → `bg-success` "✅ Terminé". Mise à jour via SSE.

**Console** : `.console-terminal` fond `#050811`, texte `#10b981`. Logs SSE. Auto-scroll. Boutons : "Copier" + "Stop" (rouge, visible pendant exécution — appelle `api.pipeline.stop()` → `POST /api/pipeline/stop`).

#### **Source Documents Table**
Table depuis `GET /api/library/documents?db=...`. Colonnes : Document, Pages, Indexées, Statut, Taille, Actions.

#### **Key Manager**
`.auto-card`. Tableau providers (gemini/groq/openai/anthropic/ollama) : clé masquée + "Révéler", modèle actif (select), statut badge, "Tester" + "Supprimer". Formulaire ajout : select provider + input key + "Ajouter" → `POST /api/llm/keys`.

---

## **PARTIE 6 : RÈGLES DE CONFORMITÉ STRICTES & MULTILINGUISME**

1. **i18n Trilingue & Priorité Arabe :**
   - **Langue par défaut absolue :** Arabe (`'ar'`). Au premier lancement, l'application démarre obligatoirement en Arabe (`<html lang="ar" dir="rtl">`).
   - **Support multilingue complet de l'UI :** Arabe (`ar`), Français (`fr`), Anglais (`en`).
   - **Bascule RTL ↔ LTR dynamique :** Quand la langue active est `'ar'`, `dir="rtl"` et polices `Cairo`/`Tajawal`. Quand la langue active est `'fr'` ou `'en'`, `dir="ltr"` et polices `Outfit`/`Inter`.
   - **Composant `LanguageSelector.tsx` :** Dropdown/pill `🌐 العربية | Français | English` présent dans la Topbar des 3 vues.
   - **Périmètre i18n :** Traduit 100% des menus, boutons, titres, infobulles, statuts, KPIs, filtres et messages d'erreur. Les textes des manuels scolaires extraits de SQLite restent dans leur langue d'origine.

2. **Traitement des Documents et Contenus Mixtes (Arabe + Formules/Actifs FR & EN) :**
   - **Isolation BiDi Stricte :** Dans les documents en langue arabe contenant des portions en français/anglais (ex: formules mathématiques `$f(x) = ax^2 + bx + c$`, constantes physiques `$g = 9.8 \text{ m/s}^2$`, formules chimiques `$\text{H}_2\text{SO}_4$`, termes informatiques, diagrammes SVG ou scripts), **chaque actif ou terme latin est strictement isolé** avec `direction: ltr !important; unicode-bidi: isolate !important; text-align: left;`.
   - **KaTeX LTR Monopasse :** Tous les conteneurs `.katex` et `.katex-display` sont forcés en LTR pour empêcher l'inversion des parenthèses, fractions et exposants dans un paragraphe arabe RTL.
   - **Conteneurs de Texte :** Les conteneurs de Markdown rendu utilisent `unicode-bidi: plaintext;` pour respecter la direction naturelle des phrases sans briser la ponctuation.

3. **Thème Dual :** toggle sur les 3 vues. Persisté `localStorage['ragdom_theme']`. Appliqué via `data-theme`.
4. **Zéro Hardcoding :** aucun nom de base, domaine, matière, filtre écrit en dur. Tout vient des APIs.
5. **Fonts CDN :** Cairo, Tajawal, Outfit, FontAwesome 6, KaTeX — chargés dans `index.html`.
6. **Animations :** tabFadeSlide (0.35s), targetFlashGlow (2.2s), pulseGlow (2s), hover cards translateY(-4px), hover sidebar translateX(-4px).
7. **Sidebar :** desktop fixe à droite en RTL (à gauche en LTR) + workspace margin. Mobile cachée + floating toggle.
8. **SSE :** une seule connexion `EventSource` par vue. Fermée au démontage. `close()` avant nouvelle.
9. **Pagination :** `?page=1&limit=50` + composant `Pagination.tsx` réutilisable.
10. **Erreurs :** bandeau rouge `ErrorBanner.tsx` en haut de section, pas de crash.
11. **Loading :** skeleton loader ou spinner `fa-spinner fa-spin text-primary`. Jamais de flash vide.
12. **Classes utilitaires custom (V3.1) :** les classes `col-*`, `btn-*`, `modal-*`, `rounded-pill` présentes dans ce document sont des classes CUSTOM recréées dans `index.css` (grille CSS/Tailwind) — le framework Bootstrap (JS + CSS) reste interdit. Les comportements `bootstrap.Collapse` sont réimplémentés en état React contrôlé.
12bis. **Scans & vignettes (V3.5) :** toute GRILLE de scans (galerie, previews d'exercices, rail latéral) consomme la vignette (`getPageScanUrl(..., thumb=true)`) ; la pleine résolution est réservée au SideBySideViewer, à l'Overlay Diff et à la modale HD. La conversion BBox → CSS % utilise `X-Scan-Width`/`X-Scan-Height` (jamais de dimensions devinées).
13. **Mode Repli Générique (V3.1 — D1-B) :** voir le préambule de §5.2. Aucun compteur ni structure curriculum n'est codé en dur ; tout provient de `GET /api/library/curriculum` et des agrégats API.


---

## **PARTIE 7 : ADMINISTRATION & COUVERTURE TOTALE (V3.2)**

Composants complémentaires couvrant les parcours d'administration, de correction et de conversation. Ils suivent intégralement le Design System (Partie 2), les règles de conformité (Partie 6) et le contrat API Blueprint §7.6. Nouveaux fichiers sous `src/components/admin/` et `src/components/library/`.

### **7.1 AskStudio.tsx (Chat RAG — Vue 2)**

* Onglet supplémentaire du workspace Library : **محادثة المكتبة (Chat RAG)**, icône `fa-comments text-info`.
* Zone de conversation (bulles user/assistant, rendu Markdown+KaTeX via le moteur monopasse §5.2.6, BiDi respecté) + input avec sélecteur de bases multi-cases (défaut : base active).
* Chaque réponse : bloc **Sources** — chips cliquables `[Doc · p.34]` naviguant vers le chunk dans le SideBySideViewer (réutilise `highlightAndFocusElement`), badge provider (`gemini-1.5-flash`…), badge orange si `fallback_triggered`.
* Cas `no_context: true` : bulle neutre grise avec le message imposé, icône `fa-circle-info`, AUCUNE invention, pas de bloc Sources.
* États : spinner pendant la génération (annulable), ErrorBanner en échec. Historique de session en mémoire locale (non persisté en v1).
* API : `api.search.ask(databases, query, topK, filters)`.

### **7.2 SearchStudio — extension Multi-Bases (Vue 2)**

* Rangée de cases à cocher des bases détectées (depuis `DatabaseContext.databases`) au-dessus du champ de recherche ; 1 base cochée → `api.search.hybrid`, plusieurs → `api.search.hybridMulti`.
* Chaque résultat multi-bases porte un badge `database_filename` (pill `badge-bg-subtle`).

### **7.3 ChunkEditor.tsx (Correction Humaine — Vue 2)**

* Bouton **✏️ تصحيح** sur chaque chunk et artefact du SideBySideViewer (visible au survol, coin supérieur droit du bloc).
* Modale d'édition : textarea Markdown/LaTeX (police mono, `direction` auto) + **aperçu KaTeX live** côte à côte + le scan original de la page en rappel (colonne repliable).
* À l'enregistrement : appel `PUT /chunks/{id}` (ou `/artifacts/{id}`) → affichage du résultat de lint retourné (vert = OK ; ambre = warnings ; rouge = erreurs, avec détail — l'enregistrement reste effectif, l'humain a le dernier mot).
* Badge permanent **« مصحّح يدويًا »** (`is_human_edited`) sur les blocs corrigés, tooltip « protégé des purges et ré-ingestions ».
* API : `api.library.updateChunk`, `api.library.updateArtifact`.

### **7.4 PurgeStudio.tsx (Purge Scopée — Vue 3)**

* `.auto-card` « 🧹 Purge Scopée » : sélecteur de portée en pills — `صفحة (page)` / `نطاق (plage)` / `فصل (chapitre via arbre TOC)` / `مستند (document)` / `قاعدة كاملة (base)` / `الأصول فقط (artefacts)` / `المنهاج فقط (curriculum)` — avec les champs contextuels (document, pages, nœud TOC).
* Toggle « préserver les corrections manuelles » (défaut ON, désactivé et forcé OFF si scope=base).
* Bouton « Prévisualiser l'impact » → `purge(dry_run: true)` → **modale d'impact** : tableau des comptes (chunks, artefacts, TOC, jobs, liaisons curriculum, lignes vec) + lignes protégées `is_human_edited`.
* Confirmation : bouton rouge « Exécuter la purge » dans la modale ; si scope=base → champ de **double saisie du nom exact** de la base avant activation du bouton.
* Après exécution : toast de résultat + rafraîchissement DatabaseContext.
* API : `api.pipeline.purge(payload)`.

### **7.5 QuarantineManager.tsx (Vue 3)**

* `.auto-card` « ⚠️ Quarantaine » : table (page, document, statut badge rouge/gris, retry_count, date) avec `error_log` dépliable par ligne (bloc mono).
* Sélection multiple + bouton « 🔄 Réessayer » (`api.pipeline.retry`) ; les `INVALID_SOURCE` non-retryables (fichier inchangé) sont grisés avec tooltip explicatif (HTTP 409).
* Compteur de quarantaine remonté en badge dans le Status Live.

### **7.6 SourcesManager.tsx (Vue 3)**

* `.auto-card` « 📁 Sources » : arborescence de `/sources/` (dossiers dépliables, fichiers avec taille + badge `مُدمَج` si ingéré + base cible déduite).
* **Zone de glisser-déposer** d'upload PDF (multipart, max 1 Go, barre de progression) vers le dossier sélectionné ; bouton « nouveau dossier » ; suppression de fichier avec confirmation (grisée si le PDF est déjà référencé — HTTP 409 relayé).
* API : `api.system.getSources`, `uploadSource`, `createSourceFolder`, `deleteSource`.

### **7.7 DatabaseLifecycle.tsx (Vue 3)**

* Rangée d'actions par base dans la section Télémétrie : **⬇️ Exporter** (télécharge le .sqlite autonome — lien direct `GET /databases/{name}/export`), **📋 Dupliquer** (prompt nouveau nom), **🗑️ Supprimer** (modale à double saisie du nom, refus si batch RUNNING).
* Affiche `schema_version` et la taille à côté de chaque base.

### **7.8 SettingsPanel.tsx (Vue 3)**

* `.auto-card` « ⚙️ Seuils & Réglages » sous le Bandeau Moteur Vectoriel : deux sliders — `vec_distance_threshold` (0.1 → 1.0, pas 0.05, défaut 0.45) et `bm25_score_threshold` (-10 → 0, pas 0.1, défaut -0.3 — calibré Phase 2) — avec valeur courante, description d'effet, bouton « Rétablir les défauts ».
* Persistance immédiate par `PUT /api/system/settings` + toast. Ces seuils pilotent le filtrage anti-hallucination (tech_specs §3.3).

### **7.9 TelemetryExplorer.tsx (Vue 3)**

* `.auto-card` « 📊 Télémétrie Historique » : 4 KPIs agrégés (latence moyenne, confiance moyenne, taux VLM, taux fallback) + table paginée de `processing_benchmarks` (page, moteur, latence, RAM pic, confiance, provider VLM, date) filtrable par document.
* Mini-graphe Plotly : latence par page (ligne) + confiance (aire), thème adapté dark/light.
* API : `api.library.getBenchmarks(db, documentId?, page, limit)`.

### **7.10 CurriculumStudio.tsx (Vue 3)**

* `.auto-card` « 🎓 Curriculum Studio » — **la clé de sortie du Mode Repli de la Vue 2** : 4 sous-onglets CRUD (Trimestres, Programmes/مقاطع, Évaluations, Liaisons) avec tables éditables (ajout inline, édition, suppression avec confirmation).
* Liaisons : formulaire type (`link_type`) + sélecteurs source/cible peuplés dynamiquement (chunks/TOC/programmes/évaluations de la base active).
* **Import structuré** : upload JSON complet (`POST /api/curriculum/import`, mode replace/merge) avec validation de forme avant envoi et rapport d'import.
* Bandeau d'état : « Curriculum actif — la Vue 2 affiche les 6 onglets » ou « Tables vides — la Vue 2 est en Mode Repli Générique ».

### **7.11 ArtifactImportModal.tsx (Import Tier 3 — Vue 3)**

* Bouton « ➕ Importer un actif » (SourceDocumentsTable) → modale : upload fichier + sélecteurs document/page/chunk optionnel + `domain` + `artifact_type` (liste des types Tier 3 : pdb_protein, cif_crystal, cad_3d_model, bim_ifc_slice, geojson_map, dicom_slice…) + légende.
* Le `render_config_json` est appliqué automatiquement (dictionnaire tech_specs §12) ; aperçu du renderer cible après import ; extensions whitelistées par type, max 50 Mo.

### **7.12 OnboardingEmptyState.tsx & ConnectionGuard.tsx (transverses)**

* **ConnectionGuard** (englobe l'App) : si le premier `GET /api/system/health` échoue → écran plein `.portal-card` centré « ⚡ Backend RAGDom non démarré » + commande de lancement affichée en bloc mono + bouton « Réessayer » + polling auto 5 s. Aucune vue ne rend tant que le backend est injoignable.
* **OnboardingEmptyState** : si `databases.length === 0` → remplace le contenu des 3 vues par un guide en 3 étapes (1. Déposer des PDFs → SourcesManager · 2. Lancer l'ingestion → Pipeline · 3. Explorer → Library), avec CTA direct vers l'Automation Hub. Chaque vue conserve par ailleurs un état vide propre (jamais de zone blanche).

### **7.13 Accessibilité (normative, transverse)**

1. **Clavier :** tout élément interactif focusable au clavier ; tab-order logique RTL/LTR ; `Escape` ferme modales/sidebar ; `Enter`/`Space` activent pills et toggles ; le Page Jumper et la recherche gardent leurs raccourcis.
2. **Focus :** focus-trap dans toutes les modales (`#masterImageModal`, impact de purge, ChunkEditor…) ; retour du focus à l'élément déclencheur à la fermeture ; anneau de focus visible (`outline` 2px `var(--primary)`), jamais supprimé sans remplacement.
3. **ARIA :** onglets `role="tablist"/"tab"/"tabpanel"` ; arbre TOC `role="tree"/"treeitem"` ; console SSE et zone de chat `aria-live="polite"` ; badges d'état avec `aria-label` explicite.
4. **Mouvement :** respect global de `prefers-reduced-motion: reduce` (animations/transitions à 0.01ms — voir bloc CSS du skill motion-design) ; le halo targetFlashGlow devient un simple contour statique 2 s.
5. **Contraste :** ratios AA (4.5:1 texte normal) vérifiés sur les DEUX thèmes pour texte, badges et états désactivés.

### **7.14 Extensions TypeScript & api.ts (V3.2)**

```typescript
// ── src/types/index.ts — AJOUTS V3.2 ──
export interface AskSource { chunk_id: string; document_id: string; document_title: string; page_number: number; database_filename: string; rrf_score: number; }
export interface AskResponse { answer: string; no_context: boolean; sources: AskSource[]; provider_used: string | null; fallback_triggered: boolean; }
export type PurgeScope = 'page' | 'page_range' | 'chapter' | 'document' | 'database' | 'artifacts_only' | 'curriculum_only';
export interface PurgePayload { db: string; scope: PurgeScope; document_id?: string; page_start?: number; page_end?: number; toc_id?: string; dry_run: boolean; preserve_human_edits?: boolean; confirm?: string; }
export interface PurgeResult { dry_run: boolean; deleted: { chunks: number; artifacts: number; toc_entries: number; jobs: number; curriculum_links: number; vec_rows: number; page_scans: number }; preserved_human_edited: number; message: string; }
export interface QuarantineJob { id: string; document_id: string; page_number: number; status: 'QUARANTINE' | 'INVALID_SOURCE'; retry_count: number; error_log: string | null; updated_at: string; }
export interface SourceFile { name: string; size_bytes: number; ingested: boolean; target_db: string | null; }
export interface SourceNode { rel_path: string; folders: SourceNode[]; files: SourceFile[]; }
export interface BenchmarkRow { id: string; page_number: number; engine_used: string; vlm_provider_used: string | null; fallback_triggered: 0 | 1; execution_time_ms: number; ram_peak_mb: number | null; confidence_score: number | null; created_at: string; }
export interface BenchmarkAggregates { avg_latency_ms: number; avg_confidence: number; avg_ram_peak_mb: number; vlm_usage_rate: number; fallback_rate: number; }
export interface AppSettings { vec_distance_threshold: number; bm25_score_threshold: number; force_sqlite_vec: boolean; }
export interface EngineManifest { id: string; label: string; version: string; accent: string; families_tier1: string[]; status: 'active' | 'inactive'; } // V3.4
```

```typescript
// ── src/lib/api.ts — AJOUTS V3.2 (dans les namespaces existants + nouveaux) ──
search: {
  // …hybrid, hybridMulti (V3.1)…
  ask: (databases: string[], query: string, topK = 5, filters?: Record<string, string>) =>
    request<import('@/types').AskResponse>('/search/ask', { method: 'POST', body: JSON.stringify({ query, databases, top_k: topK, ...(filters ? { filters } : {}) }) }),
},
pipeline: {
  // …start, getStatus, stop, cancelBatch, reset (déprécié), createStream (V3.1)…
  purge: (payload: import('@/types').PurgePayload) =>
    request<import('@/types').PurgeResult>('/pipeline/purge', { method: 'POST', body: JSON.stringify(payload) }),
  getQuarantine: (db: string) => request<{ jobs: import('@/types').QuarantineJob[] }>(withDb('/pipeline/quarantine', db)),
  retry: (db: string, jobIds: string[]) => request('/pipeline/retry', { method: 'POST', body: JSON.stringify({ db, job_ids: jobIds }) }),
},
library: {
  // …getDocuments, getToc, getFacets, getCurriculum, getChunks, getArtifacts, getPageScanUrl (V3.1)…
  updateChunk: (db: string, id: string, patch: { content_markdown?: string; section_title?: string; pedagogical_type?: string }) =>
    request(withDb(`/library/chunks/${id}`, db), { method: 'PUT', body: JSON.stringify(patch) }),
  updateArtifact: (db: string, id: string, patch: { raw_data?: string; caption?: string; render_config_json?: string }) =>
    request(withDb(`/library/artifacts/${id}`, db), { method: 'PUT', body: JSON.stringify(patch) }),
  getBenchmarks: (db: string, documentId?: string, page = 1, limit = 50) =>
    request<{ data: import('@/types').BenchmarkRow[]; aggregates: import('@/types').BenchmarkAggregates; pagination: unknown }>(
      withDb('/library/benchmarks', db, { ...(documentId ? { document_id: documentId } : {}), page: String(page), limit: String(limit) })),
  importArtifact: (db: string, formData: FormData) =>
    fetch(`${BASE_URL}${withDb('/library/artifacts/import', db)}`, { method: 'POST', body: formData }).then(r => r.json()),
},
system: {
  // …getDatabases, getHealth, toggleVectorStrict, testVectorEngine (V3.1)…
  getSources: () => request<{ tree: import('@/types').SourceNode[] }>('/system/sources'),
  uploadSource: (formData: FormData) => fetch(`${BASE_URL}/system/sources/upload`, { method: 'POST', body: formData }).then(r => r.json()),
  createSourceFolder: (relPath: string) => request('/system/sources/folder', { method: 'POST', body: JSON.stringify({ rel_path: relPath }) }),
  deleteSource: (relPath: string) => request(`/system/sources?rel_path=${encodeURIComponent(relPath)}`, { method: 'DELETE' }),
  getDatabaseExportUrl: (filename: string) => `${BASE_URL}/system/databases/${encodeURIComponent(filename)}/export`,
  duplicateDatabase: (filename: string, newName: string) => request(`/system/databases/${encodeURIComponent(filename)}/duplicate`, { method: 'POST', body: JSON.stringify({ new_name: newName }) }),
  deleteDatabase: (filename: string) => request(`/system/databases/${encodeURIComponent(filename)}`, { method: 'DELETE', body: JSON.stringify({ confirm: filename }) }),
  getSettings: () => request<{ settings: import('@/types').AppSettings }>('/system/settings'),
  getEngines: () => request<{ engines: import('@/types').EngineManifest[]; active_engine: string }>('/system/engines'), // V3.4
  updateSetting: (key: string, value: string) => request('/system/settings', { method: 'PUT', body: JSON.stringify({ key, value }) }),
},
curriculum: {
  list: (db: string, kind: 'terms' | 'programs' | 'assessments' | 'links') => request(withDb(`/curriculum/${kind}`, db)),
  create: (db: string, kind: string, payload: object) => request(withDb(`/curriculum/${kind}`, db), { method: 'POST', body: JSON.stringify(payload) }),
  update: (db: string, kind: string, id: string, payload: object) => request(withDb(`/curriculum/${kind}/${id}`, db), { method: 'PUT', body: JSON.stringify(payload) }),
  remove: (db: string, kind: string, id: string) => request(withDb(`/curriculum/${kind}/${id}`, db), { method: 'DELETE' }),
  importJson: (db: string, payload: object, mode: 'replace' | 'merge') => request(withDb('/curriculum/import', db), { method: 'POST', body: JSON.stringify({ ...payload, mode }) }),
},
```


---

## **PARTIE 8 : DESIGN SYSTEM ÉTENDU — CONFORT, ERGONOMIE DE MASSE & IDENTITÉ MULTI-MOTEURS (V3.3)**

La bibliothèque manipule des **masses de données hétérogènes** (centaines d'exercices, de scans, de benchmarks, multi-domaines/niveaux/catégories) à chaque micro-étape du cycle de vie. Cette partie rend l'interface non seulement fonctionnelle mais **confortable, fluide et agréable** — sans toucher au rendu pixel-perfect existant (les animations héritées des templates PHP sont conservées telles quelles ; les règles ci-dessous s'appliquent à tout NOUVEAU composant).

### **8.1 Motion Design System Normatif (tokens)**

Ajouter au `:root` de `index.css` (source : skill motion-design pré-installé dans `.agents/skills/`) :

```css
:root {
  /* Durées */
  --dur-1: 120ms;  /* micro-feedback, press */
  --dur-2: 180ms;  /* dropdowns, popovers, toasts */
  --dur-3: 240ms;  /* modales, sheets */
  --dur-4: 300ms;  /* grandes surfaces (plafond UI produit) */
  /* Easing */
  --ease-out-quad:  cubic-bezier(.25,.46,.45,.94);
  --ease-out-cubic: cubic-bezier(.215,.61,.355,1);
  --ease-out-quart: cubic-bezier(.165,.84,.44,1);
  --ease-in-out-cubic: cubic-bezier(.645,.045,.355,1);
  /* Transformations */
  --scale-press: 0.98;
  --scale-entrance: 0.96;
}
```

**Table d'application (nouveaux composants V3.2/V3.3) :**

| Interaction | Easing | Durée | Règles |
|---|---|---|---|
| Dropdown sélecteur de base, menus | `--ease-out-quart` | `--dur-2` | `scale(0.96)` + translateY(-8px), transform-origin côté déclencheur — jamais `scale(0)` |
| Modales (impact purge, ChunkEditor, import) | `--ease-out-quart` | `--dur-3` entrée / `--dur-2` sortie | sorties toujours plus rapides que les entrées |
| Toasts (résultats purge, corrections, uploads) | `--ease-out-cubic` | `--dur-2` entrée / `--dur-1` sortie | pile en bas, max 3 visibles |
| Press boutons/pills | `--ease-out-quad` | `--dur-1` | `scale(var(--scale-press))` |
| Hover cards/lignes | `ease` natif | `150ms` | couleur/ombre uniquement — jamais déplacer l'élément survolé |
| Step-pills (changement d'état SSE) | `ease` | `150ms` | transition de couleur du badge, pas de mouvement |
| Console SSE, navigation clavier, lignes virtualisées | **aucune animation** | `0ms` | haute fréquence = zéro délai (feeling de manipulation directe) |
| Barres de progression, ETA | `linear` | durée réelle | le temps doit paraître linéaire |
| Accordéons/expansions (solutions, error_log) | `--ease-in-out-cubic` | `--dur-3` | morph on-screen |
| Legacy pixel-perfect (tabFadeSlide 0.35s, targetFlashGlow 2.2s, pulseGlow 2s, hover translateY(-4px)) | **conservés tels quels** | — | fidélité aux templates PHP, non renormés |

`prefers-reduced-motion: reduce` (déjà normatif §7.13) s'applique à TOUT, tokens inclus.

### **8.2 Ergonomie des Masses de Données**

1. **Virtualisation obligatoire** (`@tanstack/react-virtual`, ajouté à la whitelist npm) pour toute liste/grille susceptible de dépasser **100 éléments** : galerie de scans, banque d'exercices, tables benchmarks/quarantaine/chunks. Objectif : 60 fps au scroll quel que soit le volume.
2. **Densité d'affichage** : toggle `مريح (confortable)` / `مضغوط (compact)` dans la Topbar du workspace (padding et tailles réduits ~30% en compact), persisté `localStorage['ragdom_density']` — essentiel pour le travail de masse sur les tables.
3. **Sélection en masse** : pattern unifié — checkbox par ligne + « tout sélectionner (page) » + plage par Maj+clic ; barre d'actions contextuelle flottante en bas (`N éléments — Réessayer / Purger / Exporter`) sur QuarantineManager, benchmarks et sources.
4. **Command Palette (Ctrl+K / Cmd+K)** : omnibox flottante — changer de base, sauter à un onglet/vue, page N, lancer une action (purge, ingestion, ask), recherche rapide. Navigation 100% clavier, fuzzy match, sections par catégorie. C'est l'accélérateur central du travail fin répétitif.
5. **Sticky partout** : en-têtes de tables collants, Topbar déjà sticky, barre de filtres de la galerie collante sous la Topbar.
6. **Opérations longues jamais bloquantes** : uploads et purges affichent progression + restent annulables ; l'UI reste navigable (les opérations vivent dans un state global, pas dans la page).

### **8.3 Confort de Feedback (micro-UX)**

1. **Toasts unifiés** : succès (vert, auto-dismiss 4s), erreur (rouge, persistant + bouton détail), info (bleu). Toute action destructive **réversible** propose `تراجع (Annuler)` dans le toast pendant 5s quand c'est possible (ex: suppression de source → corbeille temporaire dans /pipeline-set/trash, purgée à la fermeture).
2. **Optimistic UI** mesuré : bascules instantanées pour les toggles/paramètres (rollback + toast si échec) ; JAMAIS d'optimisme sur les opérations destructives (purge, delete) qui attendent la confirmation serveur.
3. **Skeletons systématiques** (déjà règle 11) : chaque composant de la PARTIE 7 définit son skeleton à sa forme réelle (table → lignes fantômes ; galerie → cartes fantômes) — jamais de spinner plein écran après le premier chargement.
4. **Inspecteur de Cycle de Vie par page** : clic sur une step-pill ou une ligne de benchmark → drawer latéral « 🔬 Page N » : chronologie des couches 0→7 avec timings réels, moteur utilisé, RAM pic, score de confiance, blur/deskew, provider VLM éventuel, lint errors — et boutons directs `Voir dans la Library` / `Corriger` / `Purger cette page`. C'est la loupe fine sur chaque micro-étape du pipeline demandée par le pilotage granulaire.
5. **Compteurs vivants** : les KPIs (Vue 1) et badges de compteurs s'animent en incrément (`--dur-3`, ease-out) lors des mises à jour SSE — jamais de saut sec.

### **8.4 Couleurs & Identité Multi-Moteurs**

1. **Token moteur** : le projet héberge `sci-engine` dans `/engines/` et en accueillera d'autres (legal-engine, medical-engine…). Chaque moteur déclare son manifeste `engine.json` (`{ id, label, version, accent, families_tier1, status }` — tech_specs §4.6), servi par `GET /api/system/engines` (V3.4) ; l'UI expose :
```css
:root { --engine-accent: #2563eb; /* sci-engine = Bleu Cobalt (défaut actuel) */ }
```
   Un **badge moteur actif** apparaît dans la Topbar des 3 vues (icône + label, teinté `--engine-accent`). Les éléments « identité » (logo carré, bouton primaire hero, step-pills actives) consomment `--engine-accent` au lieu de `--primary` en dur — un futur moteur rethème l'interface en changeant UNE variable. Conventions réservées : legal-engine = ambre profond `#b45309`, medical-engine = sarcelle `#0d9488` (à confirmer à leur création).
2. **Couleurs de domaine algorithmiques (Zéro Dogme préservé)** : les badges de domaines/matières/facettes ne portent JAMAIS de couleur codée en dur par domaine. La teinte est dérivée du nom :
```typescript
const domainHue = (name: string) => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;
// light : hsl(hue, 55%, 42%) sur fond hsl(hue, 60%, 94%) — dark : hsl(hue, 65%, 70%) sur fond hsl(hue, 45%, 16%)
```
   → cohérence visuelle automatique inter-vues (le même domaine a toujours la même couleur), extensible à l'infini sans hardcoding.
3. **Sémantique d'état inchangée** : succès `#10b981`, avertissement `#f59e0b`, danger `#ef4444`, info `#06b6d4` restent réservés aux ÉTATS — jamais utilisés comme couleurs décoratives ou de domaine (lisibilité des alertes préservée).
4. **Échelle d'élévation normalisée** : 3 niveaux uniquement — `--card-shadow` (repos), `--card-shadow-hover` (survol/focus), modales (overlay + ombre forte). Aucun nouveau composant n'invente d'ombre.

### **8.5 Ajustements de whitelist & D.O.D.**

* `package.json` : + `"@tanstack/react-virtual": "^3.10.8"` (tech_specs §9, whitelist gelée amendée).
* D.O.D frontend +2 tests (tech_specs §5.2) : Virtualisation (1000+ éléments à 60 fps, DOM borné) et Command Palette (pilotage 100% clavier).
