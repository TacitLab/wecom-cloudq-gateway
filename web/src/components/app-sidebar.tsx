import { ArrowLeftRight, BellRing, Bot, CloudCog, KeyRound } from 'lucide-react'

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import type { ViewKey } from '@/lib/views'

const NAV_GROUPS: Array<{
  label: string
  items: Array<{ key: ViewKey; label: string; icon: typeof Bot }>
}> = [
  {
    label: '应用能力',
    items: [{ key: 'alerts', label: '告警 RCA', icon: BellRing }],
  },
  {
    label: 'Agent配置',
    items: [
      { key: 'agents', label: 'Cloud Agent', icon: Bot },
      { key: 'pairings', label: '企业微信 Bot 配对', icon: ArrowLeftRight },
    ],
  },
  {
    label: '凭证管理',
    items: [
      { key: 'keys', label: 'WorkBuddy API Key', icon: KeyRound },
      { key: 'tencent-credentials', label: '腾讯云凭证', icon: CloudCog },
    ],
  },
]

export function AppSidebar({
  view,
  onSwitch,
}: {
  view: ViewKey
  onSwitch: (view: ViewKey) => void
}) {
  return (
    <Sidebar variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" onClick={() => onSwitch('pairings')}>
              <img
                src={`${import.meta.env.BASE_URL}favicon.svg?v=ca-monogram-1`}
                alt=""
                aria-hidden="true"
                width={32}
                height={32}
                className="size-8 shrink-0"
              />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">消息网关</span>
                <span className="truncate text-xs text-muted-foreground">CloudAgent Gateway</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton
                      isActive={view === item.key}
                      onClick={() => onSwitch(item.key)}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  )
}
