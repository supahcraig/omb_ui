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
  onLines?: (lines: string[]) => void
}

export default function LiveRun({ runId, warmupMinutes, testMinutes, initialElapsed = 0, onComplete, onStop, onLines }: Props) {
  const [done, setDone] = useState(false)
  const [elapsed, setElapsed] = useState(initialElapsed)
  const [points, setPoints] = useState<LivePoint[]>([])
  const elapsedRef = useRef(initialElapsed)
  const linesRef = useRef<string[]>([])
  const totalSeconds = (warmupMinutes + testMinutes) * 60

  // Keep callback refs current so the WebSocket effect never needs to re-run
  // when parent re-renders (which would close/reopen the socket).
  const onCompleteRef = useRef(onComplete)
  const onLinesRef    = useRef(onLines)
  onCompleteRef.current = onComplete
  onLinesRef.current    = onLines

  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.host}/ws/runs/${runId}`)
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'done') { setDone(true); onCompleteRef.current() }
      } catch (_e) {
        linesRef.current = [...linesRef.current.slice(-499), e.data]
        onLinesRef.current?.(linesRef.current)
        const parsed = parseOmbLine(e.data)
        if (parsed) {
          if (parsed.kind === 'pub') {
            const { kind: _, ...fields } = parsed
            setPoints(prev => [...prev, { t: elapsedRef.current, ...fields }])
          } else {
            // E2E line: merge into the most recent point
            setPoints(prev => {
              if (!prev.length) return prev
              const last = prev[prev.length - 1]
              return [...prev.slice(0, -1), { ...last, e2eP50: parsed.e2eP50, e2eP99: parsed.e2eP99, e2eP999: parsed.e2eP999 }]
            })
          }
        }
      }
    }
    ws.onerror = () => setDone(true)
    return () => ws.close()
  }, [runId]) // runId only — callbacks accessed via refs

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

      <LiveMetrics points={points} warmupSecs={warmupMinutes * 60} />
    </div>
  )
}
