import { ArrowLeftRight, BellRing, Bot, CloudCog, KeyRound, LayoutDashboard, Network } from 'lucide-react'

export const NAV_GROUPS = [
  { label: '运维工作台', items: [
    { key: 'overview' as const, label: '概览', icon: LayoutDashboard },
    { key: 'architecture-watches' as const, label: '架构值守', icon: Network },
    { key: 'alerts' as const, label: '告警 RCA', icon: BellRing },
  ] },
  { label: '连接与智能体', items: [
    { key: 'pairings' as const, label: 'Bot 配对', icon: ArrowLeftRight },
    { key: 'agents' as const, label: 'WMA Agent', icon: Bot },
  ] },
  { label: '凭证与访问', items: [
    { key: 'wma-credentials' as const, label: 'WMA 凭证', icon: KeyRound },
    { key: 'tencent-credentials' as const, label: '腾讯云凭证', icon: CloudCog },
  ] },
]
