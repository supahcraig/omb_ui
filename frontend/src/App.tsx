import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import NewRunPage from './pages/NewRun'
import ResultsPage from './pages/Results'
import RunDetailPage from './pages/RunDetail'
import SweepsPage from './pages/Sweeps'
import NewSweepPage from './pages/Sweeps/NewSweep'
import SweepDetailPage from './pages/Sweeps/SweepDetail'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/runs/new" replace />} />
        <Route path="/runs/new" element={<NewRunPage />} />
        <Route path="/runs" element={<ResultsPage />} />
        <Route path="/runs/:id" element={<RunDetailPage />} />
        <Route path="/sweeps" element={<SweepsPage />} />
        <Route path="/sweeps/new" element={<NewSweepPage />} />
        <Route path="/sweeps/:id" element={<SweepDetailPage />} />
      </Routes>
    </Layout>
  )
}
