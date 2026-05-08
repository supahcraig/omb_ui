import type { ConfigPayload, Run, RunListItem, PrometheusSample, Sweep, SweepDetail, SweepCreatePayload } from './types'

const base = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  getConfig: () => request<ConfigPayload>('/config'),
  putConfig: (payload: ConfigPayload) =>
    request<{ status: string }>('/config', { method: 'PUT', body: JSON.stringify(payload) }),

  listRuns: () => request<RunListItem[]>('/runs'),
  getRun: (id: number) => request<Run>(`/runs/${id}`),
  createRun: (name?: string) =>
    request<Run>('/runs', { method: 'POST', body: JSON.stringify({ name }) }),
  stopRun: (id: number) =>
    request<void>(`/runs/${id}`, { method: 'DELETE' }),

  getRunPrometheus: (id: number) =>
    request<PrometheusSample[]>(`/runs/${id}/prometheus`),

  listSweeps: () => request<Sweep[]>('/sweeps'),
  getSweep: (id: number) => request<SweepDetail>(`/sweeps/${id}`),
  createSweep: (body: SweepCreatePayload) =>
    request<Sweep>('/sweeps', { method: 'POST', body: JSON.stringify(body) }),
  cancelSweep: (id: number) =>
    request<void>(`/sweeps/${id}`, { method: 'DELETE' }),
}
