import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import RunTable from './RunTable'

export default function ResultsPage() {
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['runs'],
    queryFn: api.listRuns,
    refetchInterval: 5000,
  })

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Results</h1>
      {isLoading
        ? <div className="text-slate-400">Loading…</div>
        : <RunTable runs={runs} />
      }
    </div>
  )
}
