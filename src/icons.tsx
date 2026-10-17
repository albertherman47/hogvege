import type { ReactNode, SVGProps } from 'react'

export type IconName = 'Chart' | 'ArrowLeft' | 'ArrowRight' | 'Bell' | 'CalendarDays' | 'Check' | 'ChevronRight' | 'CircleHelp' | 'Clock3' | 'FileText' | 'Home' | 'Lightbulb' | 'Moon' | 'Plus' | 'Search' | 'Settings2' | 'ShieldCheck' | 'Sparkles' | 'Wallet' | 'X'

const paths: Record<IconName, ReactNode> = {
  Chart: <><path d="M4 3v17h17M8 15v-4m5 4V7m5 8V4"/></>,
  ArrowLeft: <><path d="M19 12H5"/><path d="m11 18-6-6 6-6"/></>,
  ArrowRight: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
  Bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/><path d="M10 4.2a2 2 0 0 1 4 0"/></>,
  CalendarDays: <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/></>,
  Check: <path d="m5 12 4.5 4.5L19 7"/>,
  ChevronRight: <path d="m9 5 7 7-7 7"/>,
  CircleHelp: <><circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.4 2.4 0 1 1 4.4 1.3c-.7 1-2.1 1.2-2.1 2.7M12 16.5v.1"/></>,
  Clock3: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></>,
  FileText: <><path d="M6 3h8l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5M8 12h8m-8 4h8"/></>,
  Home: <><path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9M9 20v-7h6v7"/></>,
  Lightbulb: <><path d="M9 18h6m-5 3h4"/><path d="M8.3 14.8a6 6 0 1 1 7.4 0c-.9.7-1.2 1.5-1.2 3.2h-5c0-1.7-.3-2.5-1.2-3.2Z"/><path d="M12 2v1"/></>,
  Moon: <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.8 8.8 0 1 0 20.5 14.2Z"/>,
  Plus: <><path d="M12 5v14M5 12h14"/></>,
  Search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></>,
  Settings2: <><path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></>,
  ShieldCheck: <><path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z"/><path d="m8.5 12 2.3 2.3 4.8-5"/></>,
  Sparkles: <><path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15ZM5 3l.6 1.4L7 5l-1.4.6L5 7l-.6-1.4L3 5l1.4-.6L5 3Z"/></>,
  Wallet: <><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 9h18m-6 5h.1M6 5V3h12v2"/></>,
  X: <><path d="m6 6 12 12M18 6 6 18"/></>,
}

export function Icon({ name, size = 18, ...props }: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>{paths[name]}</svg>
}
