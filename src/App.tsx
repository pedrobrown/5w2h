import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDownLeft, ArrowUpRight, CalendarDays, Check, ChevronDown, CircleHelp, CreditCard,
  Download, LayoutDashboard, LoaderCircle, Moon, RefreshCw, Search, ShieldCheck, Sun, Wallet, X,
} from 'lucide-react'

type Plan = {
  id: string
  name: string
  firstMonth?: string | null
  lastMonth?: string | null
  currencyFormat?: { iso_code?: string } | null
}
type Category = {
  id: string
  categoryGroupId: string
  name: string
  groupName: string | null
  groupHidden: number | null
  budgeted: number
  activity: number
  balance: number
  raw?: { hidden?: boolean }
}
type Account = { id: string; name: string; type: string; balance: number; closed: number; on_budget: number }
type Dashboard = {
  plan: { name?: string; currency_format?: { iso_code?: string } }
  accounts: Account[]
  month: { income: number; budgeted: number; activity: number; to_be_budgeted: number } | null
  categories: Category[]
  settings: { currency_format?: { iso_code?: string } } | null
}
type Transaction = {
  id: string
  accountName: string | null
  date: string
  amount: number
  memo: string | null
  payeeName: string | null
  categoryName: string | null
}
type Job = {
  id: string
  planId: string
  planName: string
  mode: 'initial' | 'delta'
  status: 'queued' | 'running' | 'failed' | 'complete'
  stage: string
  stepIndex: number
  totalSteps: number
  counts: Record<string, number>
  errorMessage?: string | null
}
type Section = 'overview' | 'transactions' | 'accounts'

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  const body = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(body.error || 'Não foi possível carregar os dados.')
  return body
}
function monthValue(value?: string | null): string {
  return value && /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : new Date().toISOString().slice(0, 7)
}
function monthLabel(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}-01T12:00:00Z`))
}
function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`))
}
function money(milliunits: number, currency?: string): string {
  const code = currency && /^[A-Z]{3}$/.test(currency) ? currency : 'BRL'
  try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: code }).format(milliunits / 1000) }
  catch { return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(milliunits / 1000) }
}
function sectionTitle(section: Section): string {
  return section === 'transactions' ? 'Transações' : section === 'accounts' ? 'Contas' : 'Visão geral'
}

export default function App() {
  const [importedPlans, setImportedPlans] = useState<Plan[]>([])
  const [remotePlans, setRemotePlans] = useState<Plan[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [activePlanId, setActivePlanId] = useState('')
  const [month, setMonth] = useState(monthValue())
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [section, setSection] = useState<Section>('overview')
  const [showImporter, setShowImporter] = useState(false)
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const reloadPlans = useCallback(async () => {
    const data = await api<{ plans: Plan[] }>('/api/plans')
    setImportedPlans(data.plans)
    setActivePlanId((current) => current && data.plans.some((plan) => plan.id === current) ? current : data.plans[0]?.id ?? '')
  }, [])
  const reloadJobs = useCallback(async () => {
    const data = await api<{ jobs: Job[] }>('/api/sync')
    setJobs(data.jobs)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])
  useEffect(() => {
    let alive = true
    async function boot() {
      setLoading(true)
      try {
        await Promise.all([reloadPlans(), reloadJobs()])
        const data = await api<{ plans: Plan[] }>('/api/ynab/plans')
        if (alive) setRemotePlans(data.plans)
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : 'Falha ao conectar ao app.')
      } finally { if (alive) setLoading(false) }
    }
    void boot()
    return () => { alive = false }
  }, [reloadJobs, reloadPlans])
  useEffect(() => {
    if (!activePlanId) return
    let alive = true
    async function load() {
      try {
        const [overview, recent] = await Promise.all([
          api<Dashboard>(`/api/plans/${encodeURIComponent(activePlanId)}/overview?month=${month}-01`),
          api<{ transactions: Transaction[] }>(`/api/plans/${encodeURIComponent(activePlanId)}/transactions?limit=100`),
        ])
        if (alive) { setDashboard(overview); setTransactions(recent.transactions); setError('') }
      } catch (cause) { if (alive) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o plano.') }
    }
    void load()
    return () => { alive = false }
  }, [activePlanId, month])

  const currency = dashboard?.settings?.currency_format?.iso_code ?? dashboard?.plan?.currency_format?.iso_code ?? 'BRL'
  const visibleCategories = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR')
    return (dashboard?.categories ?? []).filter((category) => !category.groupHidden && !category.raw?.hidden &&
      (!query || `${category.name} ${category.groupName ?? ''}`.toLocaleLowerCase('pt-BR').includes(query)))
  }, [dashboard, search])
  const groupedCategories = useMemo(() => {
    const groups = new Map<string, Category[]>()
    for (const item of visibleCategories) {
      const key = item.groupName || 'Outras categorias'
      groups.set(key, [...(groups.get(key) ?? []), item])
    }
    return [...groups.entries()]
  }, [visibleCategories])

  const runJob = useCallback(async (jobId: string) => {
    setSyncing(true); setError('')
    try {
      for (let index = 0; index < 5_000; index += 1) {
        const result = await api<{ job: Job }>(`/api/sync/${encodeURIComponent(jobId)}/step`, { method: 'POST' })
        const nextJob = result.job
        setJobs((current) => [nextJob, ...current.filter((job) => job.id !== nextJob.id)])
        if (nextJob.status === 'complete') break
        if (nextJob.status === 'failed') throw new Error(nextJob.errorMessage || 'Etapa interrompida. Tente novamente.')
      }
      await Promise.all([reloadPlans(), reloadJobs()])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível sincronizar os dados.')
      await reloadJobs()
    } finally { setSyncing(false) }
  }, [reloadJobs, reloadPlans])

  async function startSync() {
    if (selectedIds.length === 0) return
    setSyncing(true); setError('')
    try {
      const result = await api<{ jobs: Job[] }>('/api/sync', { method: 'POST', body: JSON.stringify({ planIds: selectedIds }) })
      setJobs((current) => [...result.jobs, ...current])
      setShowImporter(false)
      for (const job of result.jobs) await runJob(job.id)
      await reloadPlans()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível iniciar a importação.')
      setSyncing(false)
    }
  }

  const activePlan = importedPlans.find((plan) => plan.id === activePlanId)
  const summary = dashboard?.month
  const recentTransactions = transactions.slice(0, 5)

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#inicio" aria-label="5W2H Finanças"><span className="brand-mark">5W2H</span><span className="brand-name">5W2H<span>FINANÇAS</span></span></a>
      <div className="sidebar-label">ESPAÇO PESSOAL</div>
      <div className="workspace-picker"><div className="avatar">{activePlan?.name.slice(0, 1).toUpperCase() ?? '5'}</div><div className="workspace-copy"><strong>{activePlan?.name ?? 'Meu orçamento'}</strong><span>Privado · protegido</span></div><ChevronDown size={16} /></div>
      <nav className="main-nav" aria-label="Navegação principal">
        <NavButton active={section === 'overview'} onClick={() => setSection('overview')} icon={<LayoutDashboard size={18} />}>Visão geral</NavButton>
        <NavButton active={section === 'transactions'} onClick={() => setSection('transactions')} icon={<ArrowDownLeft size={18} />}>Transações</NavButton>
        <NavButton active={section === 'accounts'} onClick={() => setSection('accounts')} icon={<Wallet size={18} />}>Contas</NavButton>
      </nav>
      <div className="sidebar-spacer" />
      <button className="nav-item import-nav" onClick={() => setShowImporter(true)}><RefreshCw size={18} /> Importar e sincronizar</button>
      <div className="privacy-note"><ShieldCheck size={16} /><span>Seus dados ficam protegidos<br />na sua conta Cloudflare.</span></div>
      <div className="sidebar-footer"><span className="status-dot" /> Conexão protegida pelo Access</div>
    </aside>

    <main className="main-content">
      <header className="topbar"><div className="breadcrumbs"><span>Finanças pessoais</span><span className="crumb-slash">/</span><strong>{sectionTitle(section)}</strong></div><div className="topbar-actions"><button className="icon-button" aria-label={dark ? 'Ativar modo claro' : 'Ativar modo escuro'} onClick={() => setDark((value) => !value)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button><button className="help-button" title="Ajuda"><CircleHelp size={17} /></button><div className="user-avatar" title="Conta protegida pelo Cloudflare Access">P</div></div></header>
      <div className="content-wrap">
        {error && <div className="alert" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Fechar aviso"><X size={16} /></button></div>}
        {loading ? <div className="loading-state"><LoaderCircle className="spin" size={28} /><span>Carregando seus dados…</span></div> : importedPlans.length === 0 ? <WelcomeState onImport={() => setShowImporter(true)} /> : <>
          <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> SEU ORÇAMENTO</div><h1>{sectionTitle(section)}</h1><p className="page-subtitle">Acompanhe o seu dinheiro com clareza e tranquilidade.</p></div><div className="heading-actions">{importedPlans.length > 1 && <select className="plan-select" value={activePlanId} onChange={(event) => setActivePlanId(event.target.value)} aria-label="Plano ativo">{importedPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select>}<button className="button button-primary" onClick={() => setShowImporter(true)} disabled={syncing}>{syncing ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}{syncing ? 'Sincronizando…' : 'Sincronizar'}</button></div></div>

          {section === 'overview' && <>
            <div className="month-toolbar"><CalendarDays size={15} /><span>{monthLabel(month)}</span><input aria-label="Mês do orçamento" type="month" value={month} onChange={(event) => setMonth(event.target.value)} /><span className="read-only-pill"><ShieldCheck size={13} /> Somente leitura</span></div>
            <div className="summary-grid">
              <SummaryCard label="PARA ORÇAR" value={money(summary?.to_be_budgeted ?? 0, currency)} hint="Disponível para distribuir" tone="sage" icon={<Wallet size={17} />} />
              <SummaryCard label="RENDA DO MÊS" value={money(summary?.income ?? 0, currency)} hint="Entradas registradas" tone="blue" icon={<ArrowDownLeft size={17} />} />
              <SummaryCard label="ORÇADO" value={money(summary?.budgeted ?? 0, currency)} hint="Distribuído nas categorias" tone="violet" icon={<LayoutDashboard size={17} />} />
              <SummaryCard label="ATIVIDADE" value={money(summary?.activity ?? 0, currency)} hint="Gastos e entradas categorizados" tone="amber" icon={<ArrowUpRight size={17} />} />
            </div>
            <div className="dashboard-grid">
              <section className="panel categories-panel"><div className="panel-heading"><div><h2>Envelope por categoria</h2><p>Saldo disponível neste mês</p></div><div className="search-wrap"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar categoria" aria-label="Buscar categoria" /></div></div>
                {groupedCategories.length === 0 ? <EmptyPanel message="Ainda não há categorias para este mês." /> : <div className="category-list">{groupedCategories.map(([name, rows]) => <div className="category-group" key={name}><div className="category-group-title"><span className="group-mark" />{name}<span className="group-count">{rows.length}</span></div>{rows.map((category) => <div className="category-row" key={category.id}><div className="category-name"><span className="category-icon"><Wallet size={13} /></span><span>{category.name}</span></div><div className="category-values"><span>{money(category.budgeted, currency)} <small>orçado</small></span><strong className={category.balance < 0 ? 'negative' : ''}>{money(category.balance, currency)}</strong></div></div>)}</div>)}</div>}
                <div className="panel-footer">Valores mantidos em milliunits conforme a API do YNAB.</div>
              </section>
              <div className="right-column">
                <section className="panel"><div className="panel-heading"><div><h2>Contas</h2><p>Saldo atual</p></div><button className="text-button" onClick={() => setSection('accounts')}>Ver todas →</button></div>{(dashboard?.accounts ?? []).filter((account) => !account.closed).slice(0, 4).map((account) => <AccountRow account={account} currency={currency} key={account.id} />)}{!dashboard?.accounts.length && <EmptyPanel message="As contas aparecerão após a importação." />}</section>
                <section className="panel"><div className="panel-heading"><div><h2>Atividade recente</h2><p>Últimos lançamentos</p></div><button className="text-button" onClick={() => setSection('transactions')}>Ver todas →</button></div>{recentTransactions.length ? recentTransactions.map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} currency={currency} />) : <EmptyPanel message="Nenhuma transação importada ainda." />}</section>
              </div>
            </div>
          </>}

          {section === 'transactions' && <section className="panel full-panel"><div className="panel-heading"><div><h2>Transações</h2><p>Movimentos mais recentes do seu plano</p></div><span className="read-only-pill"><ShieldCheck size={13} /> Somente leitura</span></div>{transactions.length ? transactions.map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} currency={currency} detailed />) : <EmptyPanel message="Ainda não há transações importadas." />}</section>}
          {section === 'accounts' && <section className="panel full-panel"><div className="panel-heading"><div><h2>Contas</h2><p>Contas e saldos informados pelo YNAB</p></div><span className="read-only-pill"><ShieldCheck size={13} /> Somente leitura</span></div>{(dashboard?.accounts ?? []).map((account) => <AccountRow account={account} currency={currency} key={account.id} large />)}</section>}

          {jobs.filter((job) => job.status === 'failed' || job.status === 'running' || job.status === 'queued').slice(0, 2).map((job) => <div className="job-card" key={job.id}><span className={job.status === 'failed' ? 'job-icon failed' : 'job-icon'}>{job.status === 'failed' ? <X size={14} /> : <LoaderCircle className="spin" size={14} />}</span><span className="job-copy"><strong>{job.planName}</strong><small>{job.status === 'failed' ? job.errorMessage : `${job.stage} · ${job.stepIndex} de ${job.totalSteps}`}</small></span>{job.status === 'failed' && <button className="button button-small" onClick={() => void runJob(job.id)} disabled={syncing}>Retomar</button>}</div>)}
        </>}
      </div>
    </main>
    <footer className="mobile-footer"><span className="status-dot" /> Protegido pelo Cloudflare Access</footer>

    {showImporter && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowImporter(false) }}><section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title"><div className="modal-header"><div className="modal-mark"><Download size={18} /></div><button className="icon-button" onClick={() => setShowImporter(false)} aria-label="Fechar"><X size={18} /></button></div><h2 id="import-title">Importar seus planos</h2><p className="modal-subtitle">Escolha os planos do YNAB para importar. A importação inclui o histórico completo e pode levar alguns minutos.</p><div className="plan-list">{remotePlans.length === 0 ? <div className="empty-plans">Não foi possível carregar seus planos do YNAB.</div> : remotePlans.map((plan) => { const checked = selectedIds.includes(plan.id); const already = importedPlans.some((current) => current.id === plan.id); return <button className={checked ? 'plan-option selected' : 'plan-option'} key={plan.id} onClick={() => setSelectedIds((ids) => checked ? ids.filter((id) => id !== plan.id) : [...ids, plan.id])}><span className={checked ? 'checkbox checked' : 'checkbox'}>{checked && <Check size={13} />}</span><span className="plan-option-copy"><strong>{plan.name}</strong><small>{plan.firstMonth ? `Desde ${monthLabel(monthValue(plan.firstMonth))}` : 'Plano financeiro'}</small></span>{already && <span className="imported-label">Importado</span>}</button> })}</div><div className="import-security"><ShieldCheck size={15} /> O token é um secret do Worker e nunca é enviado ao navegador.</div><div className="modal-actions"><button className="button button-secondary" onClick={() => setShowImporter(false)}>Cancelar</button><button className="button button-primary" onClick={() => void startSync()} disabled={selectedIds.length === 0 || syncing}>{syncing ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}{syncing ? 'Importando…' : `Importar ${selectedIds.length || ''} plano${selectedIds.length === 1 ? '' : 's'}`}</button></div></section></div>}
  </div>
}

function NavButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) { return <button className={active ? 'nav-item active' : 'nav-item'} onClick={onClick}>{icon}{children}</button> }
function SummaryCard({ label, value, hint, icon, tone }: { label: string; value: string; hint: string; icon: React.ReactNode; tone: string }) { return <div className="summary-card"><div className="summary-top"><span>{label}</span><span className={`summary-icon ${tone}`}>{icon}</span></div><strong className="summary-value">{value}</strong><span className="summary-hint">{hint}</span></div> }
function AccountRow({ account, currency, large = false }: { account: Account; currency: string; large?: boolean }) { return <div className={large ? 'account-row account-row-large' : 'account-row'}><span className="account-icon"><CreditCard size={16} /></span><span className="account-copy"><strong>{account.name}</strong><small>{account.type}{account.closed ? ' · encerrada' : ''}{!account.on_budget ? ' · fora do orçamento' : ''}</small></span><b>{money(account.balance, currency)}</b></div> }
function TransactionRow({ transaction, currency, detailed = false }: { transaction: Transaction; currency: string; detailed?: boolean }) { const income = transaction.amount >= 0; return <div className={detailed ? 'transaction-row detailed' : 'transaction-row'}><span className={income ? 'transaction-icon income' : 'transaction-icon expense'}>{income ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}</span><span className="transaction-copy"><strong>{transaction.payeeName || transaction.memo || 'Transação'}</strong><small>{detailed ? `${transaction.accountName ?? 'Conta'} · ${transaction.categoryName ?? 'Sem categoria'}` : transaction.categoryName || transaction.accountName || 'Sem categoria'}</small></span><span className="transaction-date">{dateLabel(transaction.date)}</span><b className={income ? 'amount-positive' : ''}>{money(transaction.amount, currency)}</b></div> }
function EmptyPanel({ message }: { message: string }) { return <div className="empty-panel"><span className="empty-icon"><Wallet size={18} /></span><p>{message}</p></div> }
function WelcomeState({ onImport }: { onImport: () => void }) { return <section className="welcome-card"><div className="welcome-art"><div className="art-card art-back"><span /><span /><span /></div><div className="art-card art-front"><div className="art-mark">5W</div><div className="art-bar wide" /><div className="art-bar" /><div className="art-bar short" /><div className="art-circle" /></div><div className="art-sparkle">✳</div></div><div className="eyebrow"><span className="eyebrow-dot" /> SEU ESPAÇO FINANCEIRO</div><h1>Seu dinheiro,<br /><em>no seu ritmo.</em></h1><p className="welcome-copy">Importe seu plano para ter uma visão clara das contas, categorias e transações em um só lugar.</p><button className="button button-primary button-large" onClick={onImport}><Download size={16} /> Importar do YNAB</button><div className="welcome-trust"><ShieldCheck size={15} /> Acesso privado e protegido</div></section> }
