import { NAV_GROUPS } from '@/lib/navigation'
import { Search, ArrowUpRight, Radio } from 'lucide-react'
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar'
import { VIEW_META, type ViewKey } from '@/lib/views'
import type { AdminState } from '@/lib/types'


export function AppSidebar({ view, onSwitch, onSearch, state }: {
  view: ViewKey; onSwitch: (view: ViewKey) => void; onSearch: () => void; state: AdminState | null
}) {
  const { isMobile, setOpenMobile } = useSidebar()
  const counts: Partial<Record<ViewKey, number>> = state ? {
    pairings: state.bots.length, agents: state.agents.length,
    alerts: state.alertIntegrations.length, 'architecture-watches': state.architectureWatches?.length ?? 0,
  } : {}
  function navigate(next: ViewKey) { onSwitch(next); if (isMobile) setOpenMobile(false) }
  return <Sidebar className="app-sidebar" variant="sidebar">
    <SidebarHeader className="px-5 pb-5 pt-7">
      <button type="button" className="brand-home" aria-label="CloudQ Gateway 运维消息网关" onClick={() => navigate('overview')}>
        <img src={`${import.meta.env.BASE_URL}brand/logo-lockup-inverse.svg`} alt="CloudQ Gateway" className="w-full max-w-52" />
        {/* The lockup includes bottom whitespace; tuck the subtitle beneath its wordmark. */}
        <span className="-mt-2 block pl-[43px] text-[11px] leading-4 tracking-wider text-slate-400">运维消息网关</span>
      </button>
      <button type="button" className="sidebar-search" onClick={() => { onSearch(); if (isMobile) setOpenMobile(false) }}>
        <Search className="size-4" /><span>快速跳转</span><kbd>⌘ / Ctrl K</kbd>
      </button>
    </SidebarHeader>
    <SidebarContent className="gap-5 px-3">
      {NAV_GROUPS.map(group => <SidebarGroup key={group.label} className="p-0">
        <SidebarGroupLabel className="mb-1 px-3 text-[11px] tracking-wider text-slate-400">{group.label}</SidebarGroupLabel>
        <SidebarGroupContent><SidebarMenu className="gap-1">
          {group.items.map(item => <SidebarMenuItem key={item.key}>
            <SidebarMenuButton className="nav-item" isActive={view === item.key} aria-current={view === item.key ? 'page' : undefined} title={VIEW_META[item.key].title} onClick={() => navigate(item.key)}>
              <item.icon /><span>{item.label}</span>
              {counts[item.key] !== undefined && <span className="nav-count">{counts[item.key]}</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>)}
        </SidebarMenu></SidebarGroupContent>
      </SidebarGroup>)}
    </SidebarContent>
    <SidebarFooter className="gap-4 p-5">
      <div className="sidebar-note"><Radio className="mb-3 size-5 text-[#6de2cf]" /><p className="text-sm font-medium text-slate-100">让运维，时刻在线</p><p className="mt-2 text-xs leading-5 text-slate-400">连接云端能力与团队协作，<br />从发现问题到解决问题。</p></div>
      <a className="flex items-center justify-between text-xs text-slate-400 hover:text-white" href="https://console.cloud.tencent.com/advisor" target="_blank" rel="noopener noreferrer">腾讯云智能顾问<ArrowUpRight className="size-3.5" /></a>
    </SidebarFooter>
  </Sidebar>
}
