import type { ConfigPayload, Run, RunListItem } from './types'

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
}
