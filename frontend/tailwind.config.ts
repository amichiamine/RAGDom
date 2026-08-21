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
