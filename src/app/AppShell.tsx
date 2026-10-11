import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { Ellipsis, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react'
import { cn } from '../lib/cn'
import { IconButton } from '../components/ui/Button'
import { Menu } from '../components/ui/Menu'
import { NAV_ITEMS } from './navigation'
import { StatusPill } from './StatusPill'
import { Logo } from './Logo'

const COLLAPSE_KEY = 'notivra.sidebarCollapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const navigate = useNavigate()

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1')
      } catch {
        // ignore
      }
      return !c
    })
  }

  return (
    <div className="flex h-full">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-primary px-3 py-2 text-primary-fg focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      {/* Tablet / desktop sidebar */}
      <aside
        className={cn(
          'hidden shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 md:flex',
          collapsed ? 'w-[72px]' : 'w-60',
        )}
        aria-label="Main navigation"
      >
        <div className={cn('flex h-16 items-center gap-2 px-4', collapsed && 'justify-center px-0')}>
          <Logo showText={!collapsed} />
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-2 hover:text-fg',
                  collapsed && 'justify-center px-0',
                )
              }
            >
              <item.icon className="size-5 shrink-0" aria-hidden />
              <span className={cn(collapsed && 'sr-only')}>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className={cn('flex flex-col gap-1 border-t border-border p-3', collapsed && 'items-center')}>
          <StatusPill compact={collapsed} />
          <IconButton label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} size="sm" onClick={toggle}>
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </IconButton>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone top bar */}
        <header className="pt-safe flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 md:hidden">
          <Logo showText />
          <div className="ml-auto flex min-w-0 items-center gap-1">
            <StatusPill compact />
            <IconButton label="Search" onClick={() => navigate('/search')}>
              <Search className="size-5" />
            </IconButton>
          </div>
        </header>

        <main id="main" className="flex-1 overflow-y-auto" tabIndex={-1}>
          <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
            <Outlet />
          </div>
        </main>

        {/* Phone bottom navigation */}
        <nav className="pb-safe flex shrink-0 border-t border-border bg-surface md:hidden" aria-label="Main navigation">
          {NAV_ITEMS.filter((i) => i.primary).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium',
                  isActive ? 'text-primary' : 'text-muted',
                )
              }
            >
              <item.icon className="size-5" aria-hidden />
              {item.label === 'PDF Library' ? 'Library' : item.label}
            </NavLink>
          ))}
          <div className="flex flex-1 items-center justify-center">
            <Menu
              align="end"
              side="top"
              items={NAV_ITEMS.filter((i) => !i.primary).map((item) => ({
                label: item.label,
                icon: <item.icon />,
                onSelect: () => navigate(item.to),
              }))}
              trigger={(props) => (
                <button
                  type="button"
                  {...props}
                  className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted"
                >
                  <Ellipsis className="size-5" aria-hidden />
                  More
                </button>
              )}
            />
          </div>
        </nav>
      </div>
    </div>
  )
}
