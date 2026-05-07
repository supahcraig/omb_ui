import { NavLink } from 'react-router-dom'
import { Play, List, RotateCcw, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'

const links = [
  { to: '/runs/new', icon: Play, label: 'New Run' },
  { to: '/runs', icon: List, label: 'Results' },
  { to: '/sweeps', icon: RotateCcw, label: 'Sweeps', disabled: true },
  { to: '/chat', icon: MessageSquare, label: 'AI Chat', disabled: true },
]

export default function Sidebar() {
  return (
    <aside className="w-52 bg-slate-900 border-r border-slate-700 flex flex-col h-screen">
      <div className="px-4 py-5 border-b border-slate-700">
        <span className="text-indigo-400 font-bold text-lg">⚡ OMB UI</span>
      </div>
      <nav className="flex-1 px-2 py-4 space-y-1">
        {links.map(({ to, icon: Icon, label, disabled }) =>
          disabled ? (
            <div key={to} className="flex items-center gap-3 px-3 py-2 rounded text-slate-500 cursor-not-allowed text-sm">
              <Icon size={16} />{label}
            </div>
          ) : (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn('flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors',
                  isActive ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800')
              }
            >
              <Icon size={16} />{label}
            </NavLink>
          )
        )}
      </nav>
      <div className="px-4 py-3 border-t border-slate-700 text-xs text-slate-500 space-y-1">
        <div>🟢 Cluster: —</div>
        <div>📡 Prometheus: —</div>
      </div>
    </aside>
  )
}
