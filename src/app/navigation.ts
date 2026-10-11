import { BookOpen, FileText, GraduationCap, Home, Search, Settings, Trash2, Trophy, type LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Shown in the phone bottom bar (max 4 + "More"). */
  primary?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Home', icon: Home, primary: true },
  { to: '/notebooks', label: 'Notebooks', icon: BookOpen, primary: true },
  { to: '/library', label: 'PDF Library', icon: FileText, primary: true },
  { to: '/study', label: 'Study', icon: GraduationCap, primary: true },
  { to: '/progress', label: 'Progress', icon: Trophy },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/trash', label: 'Trash', icon: Trash2 },
  { to: '/settings', label: 'Settings', icon: Settings },
]
