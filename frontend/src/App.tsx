import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { DatabaseProvider } from '@/contexts/DatabaseContext'
import { LanguageProvider } from '@/contexts/LanguageContext'
import { EngineProvider } from '@/contexts/EngineContext'
import { ToastProvider } from '@/components/common/Toast'
import ConnectionGuard from '@/components/common/ConnectionGuard'
import CommandPalette from '@/components/common/CommandPalette'
import IndexView from '@/views/IndexView'
import LibraryView from '@/views/LibraryView'
import AutomationView from '@/views/AutomationView'

/**
 * App.tsx — base imposée §4.4, étendue avec les providers requis par le sprint
 * (LanguageProvider trilingue §6.1, EngineProvider §8.4, ToastProvider §8.3) et
 * ConnectionGuard global §7.12 englobant le routeur. Voir rapport « écarts ».
 */
export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <ToastProvider>
          <ConnectionGuard>
            <EngineProvider>
              <DatabaseProvider>
                <BrowserRouter>
                  <CommandPalette />
                  <Routes>
                    <Route path="/" element={<IndexView />} />
                    <Route path="/library" element={<LibraryView />} />
                    <Route path="/automation" element={<AutomationView />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </BrowserRouter>
              </DatabaseProvider>
            </EngineProvider>
          </ConnectionGuard>
        </ToastProvider>
      </LanguageProvider>
    </ThemeProvider>
  )
}
