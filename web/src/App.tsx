import { useEffect, useRef, useState } from 'react'
import { Toaster, toast } from 'sonner'
import { AlertCircle } from 'lucide-react'

import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { OverviewView } from '@/components/views/overview-view'
import { QuickNavigation } from '@/components/quick-navigation'
import { Button } from '@/components/ui/button'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AgentsView } from '@/components/views/agents-view'
import { AlertsView } from '@/components/views/alerts-view'
import { ArchitectureWatchesView } from '@/components/views/architecture-watches-view'
import { ArchitectureDetailView } from '@/components/views/architecture-detail-view'
import { WmaCredentialsView } from '@/components/views/wma-credentials-view'
import { TencentCredentialsView } from '@/components/views/tencent-credentials-view'
import { PairingsView } from '@/components/views/pairings-view'
import { AgentDialog } from '@/components/dialogs/agent-dialog'
import { AlertDialogForm } from '@/components/dialogs/alert-dialog'
import { BotDialog } from '@/components/dialogs/bot-dialog'
import { WmaCredentialDialog } from '@/components/dialogs/wma-credential-dialog'
import { TencentCredentialDialog } from '@/components/dialogs/tencent-credential-dialog'
import { useAdminState } from '@/lib/use-admin-state'
import { VIEW_META, isEmptyState, parseView, parseWatchId, type ViewKey } from '@/lib/views'
import { OnboardingPage } from '@/components/views/onboarding-view'

type DialogKind = 'agent' | 'wma-credential' | 'tencent' | 'bot' | 'alert'

export default function App() {
  const [view, setView] = useState<ViewKey>(() => parseView(location.hash) ?? 'overview')
  const [watchId, setWatchId] = useState<string | null>(() => parseWatchId(location.hash))
  const [dialog, setDialog] = useState<{ kind: DialogKind; id?: string } | null>(null)
  const { state, error, reload, refreshing, updatedAt } = useAdminState()
  const [searchOpen, setSearchOpen] = useState(false)
  // 首次加载到空配置时进入独立向导页；一旦进入则保持到全部完成
  const [wizard, setWizard] = useState(false)
  const wizardDecided = useRef(false)

  useEffect(() => {
    const onHash = () => { setView(parseView(location.hash) ?? 'overview'); setWatchId(parseWatchId(location.hash)) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); setSearchOpen(open => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    document.title = `${VIEW_META[view].title} · CloudQ Gateway`
    window.scrollTo({ top: 0 })
  }, [view, watchId])

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
    setWatchId(null)
    if (location.hash !== `#${next}`) location.hash = next
  }

  function openDialog(kind: DialogKind, id?: string) {
    if (kind === 'bot' && state && state.agents.length === 0)
      return toast.error('请先新增 Agent')
    if (kind === 'alert' && state && state.bots.length === 0)
      return toast.error('请先创建 Bot–Agent 配对')
    if (kind === 'alert' && !id && state && state.tencentCredentials.length === 0)
      return toast.error('请先在凭证管理新增腾讯云凭证')
    setDialog({ kind, id })
  }

  const meta = VIEW_META[view]

  return (
    <SidebarProvider>
      <a href="#main-content" onClick={e => { e.preventDefault(); document.getElementById('main-content')?.focus() }} className="skip-link">跳到主要内容</a>
      <AppSidebar view={view} onSwitch={switchView} onSearch={() => setSearchOpen(true)} state={state} />
      <SidebarInset className="workspace-inset">
        <SiteHeader view={view} refreshing={refreshing} updatedAt={updatedAt} error={error} onRefresh={() => void reload()} onSearch={() => setSearchOpen(true)} detail={!!watchId} />
        <div id="main-content" tabIndex={-1} className="workspace-content outline-none">
          {!watchId && <div className="page-heading">
            <p className="page-eyebrow">{meta.eyebrow}</p>
            <h1>{meta.title}</h1><p className="page-description">{meta.description}</p>
          </div>}
          {error && state && <div role="alert" className="sync-warning"><AlertCircle className="size-4 shrink-0" /><span>暂时无法同步，当前显示上次成功获取的数据。{error}</span><Button variant="outline" size="sm" disabled={refreshing} onClick={() => void reload()}>重试</Button></div>}
          <div className="min-w-0">
            {error && !state ? (
              <div role="alert" className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
                <AlertCircle className="mx-auto mb-4 size-7 text-destructive" /><p className="mb-2 text-base font-semibold text-foreground">暂时无法加载工作区</p><p className="mb-5">{error}</p>
                <Button variant="outline" size="sm" disabled={refreshing} onClick={() => reload()}>
                  重试
                </Button>
              </div>
            ) : (
              <>
                {view === 'overview' && <OverviewView state={state} onSwitch={switchView} />}
                {view === 'pairings' && (
                  <PairingsView state={state} reload={reload} onEdit={(id) => openDialog('bot', id)} onSetupAgent={() => switchView('agents')} />
                )}
                {view === 'agents' && (
                  <AgentsView state={state} reload={reload} onEdit={(id) => openDialog('agent', id)} onSetupCredential={() => switchView('wma-credentials')} />
                )}
                {view === 'wma-credentials' && (
                  <WmaCredentialsView state={state} reload={reload} onEdit={(id) => openDialog('wma-credential', id)} />
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
                {view === 'architecture-watches' && (
                  watchId ? <ArchitectureDetailView key={watchId} id={watchId} state={state} reloadState={reload}
                    onBack={() => { location.hash = 'architecture-watches' }} />
                    : <ArchitectureWatchesView state={state} reload={reload}
                      onOpen={id => { location.hash = `architecture-watches/${id}` }}
                      onSetupCredential={() => switchView('tencent-credentials')} />
                )}
              </>
            )}
          </div>
          <footer className="workspace-footer"><span>CloudQ Gateway</span><span>连接 · 洞察 · 行动</span></footer>
        </div>
      </SidebarInset>
      <QuickNavigation open={searchOpen} onOpenChange={setSearchOpen} onSwitch={switchView} />

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
      <WmaCredentialDialog
        open={dialog?.kind === 'wma-credential'}
        record={state?.wmaCredentials.find((k) => k.id === dialog?.id)}
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
