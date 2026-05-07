import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import NewRunPage from './pages/NewRun'
import ResultsPage from './pages/Results'
import RunDetailPage from './pages/RunDetail'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/runs/new" replace />} />
        <Route path="/runs/new" element={<NewRunPage />} />
        <Route path="/runs" element={<ResultsPage />} />
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </Layout>
  )
}
