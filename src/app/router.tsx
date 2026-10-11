import { lazy } from 'react'
import { createBrowserRouter } from 'react-router'
import { Lazy, NotFound, RouteError } from './RouteElements'
import { AppShell } from './AppShell'
import { HomePage } from '../features/home/HomePage'
import { NotebooksPage } from '../features/library/NotebooksPage'
import { TrashPage } from '../features/library/TrashPage'
import { SearchPage } from '../features/search/SearchPage'
import { SettingsPage } from '../features/settings/SettingsPage'

// Heavy screens are code-split so the shell loads fast on low-end phones.
const NotebookEditorPage = lazy(() => import('../features/notebook/NotebookEditorPage').then((m) => ({ default: m.NotebookEditorPage })))
const LibraryPage = lazy(() => import('../features/pdf/LibraryPage').then((m) => ({ default: m.LibraryPage })))
const StudyCenterPage = lazy(() => import('../features/study/StudyCenterPage').then((m) => ({ default: m.StudyCenterPage })))
const StudySetPage = lazy(() => import('../features/study/StudySetPage').then((m) => ({ default: m.StudySetPage })))
const FlashcardReviewPage = lazy(() => import('../features/study/FlashcardReviewPage').then((m) => ({ default: m.FlashcardReviewPage })))
const QuizPage = lazy(() => import('../features/study/QuizPage').then((m) => ({ default: m.QuizPage })))
const AiGeneratorPage = lazy(() => import('../features/study/AiGeneratorPage').then((m) => ({ default: m.AiGeneratorPage })))
const ProgressPage = lazy(() => import('../features/progress/ProgressPage').then((m) => ({ default: m.ProgressPage })))
const PdfWorkspacePage = lazy(() => import('../features/pdf/PdfWorkspacePage').then((m) => ({ default: m.PdfWorkspacePage })))

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'notebooks', element: <NotebooksPage /> },
      {
        path: 'library',
        element: (
          <Lazy>
            <LibraryPage />
          </Lazy>
        ),
      },
      { path: 'study', element: <Lazy><StudyCenterPage /></Lazy> },
      { path: 'study/generate', element: <Lazy><AiGeneratorPage /></Lazy> },
      { path: 'study/sets/:setId', element: <Lazy><StudySetPage /></Lazy> },
      { path: 'study/sets/:setId/flashcards', element: <Lazy><FlashcardReviewPage /></Lazy> },
      { path: 'study/sets/:setId/quiz', element: <Lazy><QuizPage /></Lazy> },
      { path: 'progress', element: <Lazy><ProgressPage /></Lazy> },
      { path: 'search', element: <SearchPage /> },
      { path: 'trash', element: <TrashPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
  // Full-screen workspaces (no app chrome) for maximum writing space on phones.
  {
    path: '/library/:documentId',
    errorElement: <RouteError />,
    element: (
      <Lazy>
        <PdfWorkspacePage />
      </Lazy>
    ),
  },
  {
    path: '/notebooks/:notebookId',
    errorElement: <RouteError />,
    element: (
      <Lazy>
        <NotebookEditorPage />
      </Lazy>
    ),
  },
])
