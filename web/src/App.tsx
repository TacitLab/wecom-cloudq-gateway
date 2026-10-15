import { useEffect, useRef, useState } from 'react'
import { Toaster, toast } from 'sonner'

import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { StatCards } from '@/components/stat-cards'
import { Button } from '@/components/ui/button'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AgentsView } from '@/components/views/agents-view'
import { AlertsView } from '@/components/views/alerts-view'
import { KeysView } from '@/components/views/keys-view'
import { TencentCredentialsView } from '@/components/views/tencent-credentials-view'
import { PairingsView } from '@/components/views/pairings-view'
import { AgentDialog } from '@/components/dialogs/agent-dialog'
import { AlertDialogForm } from '@/components/dialogs/alert-dialog'
import { BotDialog } from '@/components/dialogs/bot-dialog'
import { KeyDialog } from '@/components/dialogs/key-dialog'
import { TencentCredentialDialog } from '@/components/dialogs/tencent-credential-dialog'
import { useAdminState } from '@/lib/use-admin-state'
import { isEmptyState, parseView, type ViewKey } from '@/lib/views'
import { OnboardingPage } from '@/components/views/onboarding-view'

type DialogKind = 'agent' | 'key' | 'tencent' | 'bot' | 'alert'

export default function App() {
  const [view, setView] = useState<ViewKey>(() => parseView(location.hash) ?? 'pairings')
  const [dialog, setDialog] = useState<{ kind: DialogKind; id?: string } | null>(null)
  const { state, error, reload } = useAdminState()
  // 首次加载到空配置时进入独立向导页；一旦进入则保持到全部完成
  const [wizard, setWizard] = useState(false)
  const wizardDecided = useRef(false)

  useEffect(() => {
    const onHash = () => setView(parseView(location.hash) ?? 'pairings')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (state && !wizardDecided.current) {
      wizardDecided.current = true
      if (isEmptyState(state)) setWizard(true)
    }
  }, [state])

  if (wizard && state) {
    return (
      <>
        <OnboardingPage state={state} onSaved={reload} onExit={() => setWizard(false)} />
        <Toaster position="bottom-right" richColors />
      </>
    )
  }

  function switchView(next: ViewKey) {
    setView(next)
    if (location.hash !== `#${next}`) history.replaceState(null, '', `#${next}`)
  }

  function openDialog(kind: DialogKind, id?: string) {
    if (kind === 'bot' && state && state.agents.length === 0)
      return toast.error('请先新增 CloudAgent')
    if (kind === 'alert' && state && state.bots.length === 0)
      return toast.error('请先创建 Bot–Agent 配对')
    if (kind === 'alert' && !id && state && state.tencentCredentials.length === 0)
      return toast.error('请先在凭证管理新增腾讯云凭证')
    setDialog({ kind, id })
  }

  const onlineCount = state
    ? Object.values(state.connections).filter((c) => c.status === 'authenticated').length
    : 0

  return (
    <SidebarProvider>
      <AppSidebar view={view} onSwitch={switchView} />
      <SidebarInset>
        <SiteHeader view={view} onlineCount={onlineCount} />
        <div className="flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
          {view === 'pairings' && <StatCards state={state} />}
          <div className="px-4 lg:px-6">
            {error && !state ? (
              <div className="rounded-lg border bg-card py-10 text-center text-sm text-muted-foreground">
                数据加载失败：{error}
                <Button variant="outline" size="sm" className="ml-3" onClick={() => reload()}>
                  重试
                </Button>
              </div>
            ) : (
              <>
                {view === 'pairings' && (
                  <PairingsView state={state} reload={reload} onEdit={(id) => openDialog('bot', id)} />
                )}
                {view === 'agents' && (
                  <AgentsView state={state} reload={reload} onEdit={(id) => openDialog('agent', id)} />
                )}
                {view === 'keys' && (
                  <KeysView state={state} reload={reload} onEdit={(id) => openDialog('key', id)} />
                )}
                {view === 'tencent-credentials' && (
                  <TencentCredentialsView
                    state={state}
                    reload={reload}
                    onEdit={(id) => openDialog('tencent', id)}
                  />
                )}
                {view === 'alerts' && (
                  <AlertsView
                    state={state}
                    reload={reload}
                    onEdit={(id) => openDialog('alert', id)}
                    onSetupCredential={() => switchView('tencent-credentials')}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </SidebarInset>

      <BotDialog
        open={dialog?.kind === 'bot'}
        record={state?.bots.find((b) => b.id === dialog?.id)}
        state={state}
        onOpenChange={(open) => !open && setDialog(null)}
        onSaved={reload}
      />
      <AgentDialog
        open={dialog?.kind === 'agent'}
        record={state?.agents.find((a) => a.id === dialog?.id)}
        state={state}
        onOpenChange={(open) => !open && setDialog(null)}
        onSaved={reload}
      />
      <KeyDialog
        open={dialog?.kind === 'key'}
        record={state?.apiKeys.find((k) => k.id === dialog?.id)}
        onOpenChange={(open) => !open && setDialog(null)}
        onSaved={reload}
      />
      <TencentCredentialDialog
        open={dialog?.kind === 'tencent'}
        record={state?.tencentCredentials.find((c) => c.id === dialog?.id)}
        onOpenChange={(open) => !open && setDialog(null)}
        onSaved={reload}
      />
      <AlertDialogForm
        open={dialog?.kind === 'alert'}
        record={state?.alertIntegrations.find((a) => a.id === dialog?.id)}
        state={state}
        onOpenChange={(open) => !open && setDialog(null)}
        onSaved={reload}
      />

      <Toaster position="bottom-right" richColors />
    </SidebarProvider>
  )
}
