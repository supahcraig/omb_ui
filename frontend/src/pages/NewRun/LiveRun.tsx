import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api } from '@/api/client'
import LiveMetrics, { LivePoint, parseOmbLine } from './LiveMetrics'

interface Props {
  runId: number
  warmupMinutes: number
  testMinutes: number
  initialElapsed?: number
  onComplete: () => void
  onStop: () => void
}

export default function LiveRun({ runId, warmupMinutes, testMinutes, initialElapsed = 0, onComplete, onStop }: Props) {
  const [lines, setLines] = useState<string[]>([])
  const [done, setDone] = useState(false)
  const [elapsed, setElapsed] = useState(initialElapsed)
  const [points, setPoints] = useState<LivePoint[]>([])
  const elapsedRef = useRef(initialElapsed)
  const logRef = useRef<HTMLDivElement>(null)
  const totalSeconds = (warmupMinutes + testMinutes) * 60

  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.host}/ws/runs/${runId}`)
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'done') { setDone(true); onComplete() }
      } catch (_e) {
        setLines(prev => [...prev.slice(-499), e.data])
        const parsed = parseOmbLine(e.data)
        if (parsed) {
          setPoints(prev => [...prev, { t: elapsedRef.current, ...parsed }])
        }
      }
    }
    ws.onerror = () => setDone(true)
    return () => ws.close()
  }, [runId, onComplete])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [lines])

  useEffect(() => {
    if (done) return
    const t = setInterval(() => {
      setElapsed(s => {
        const next = s + 1
        elapsedRef.current = next
        return next
      })
    }, 1000)
    return () => clearInterval(t)
  }, [done])

  const progress = Math.min((elapsed / totalSeconds) * 100, 100)
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  const handleStop = async () => {
    await api.stopRun(runId)
    onStop()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-400">
          {done ? '✅ Complete' : `⏱ ${fmt(elapsed)} / ${fmt(totalSeconds)}`}
        </div>
        {!done && (
          <Button variant="destructive" size="sm" onClick={handleStop}>Stop</Button>
        )}
      </div>

      <div className="bg-slate-800 rounded-full h-2">
        <div
          className="bg-indigo-500 h-2 rounded-full transition-all duration-1000"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="text-xs text-slate-500">{progress.toFixed(0)}% complete</div>

      <LiveMetrics points={points} />

      <div
        ref={logRef}
        className="bg-slate-950 border border-slate-700 rounded p-3 h-48 overflow-y-auto font-mono text-xs text-slate-300 space-y-0.5"
      >
        {lines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
        ))}
        {!done && <div className="text-slate-600 animate-pulse">▌</div>}
      </div>
    </div>
  )
}
