import { Hono } from 'hono'
import { requireAccess } from './access'
import { ynabGet, YnabApiError } from '../src/ynab/client'
import {
  getCursor,
  getPlanExists,
  persistResource,
  setCursor,
  upsertPlan,
} from './storage'
import type { SyncStep, YnabPlanDetail, YnabPlanSummary } from '../src/ynab/types'

type ApiEnvelope<T extends Record<string, unknown>> = {
  data: T
  server_knowledge?: number
}

type JobRow = {
  id: string
  plan_id: string
  plan_name: string
  mode: 'initial' | 'delta'
  status: 'queued' | 'running' | 'failed' | 'complete'
  stage: string
  step_index: number
  steps_json: string
  starting_knowledge: number
  server_knowledge: number
  counts_json: string
  error_message: string | null
  updated_at: string
}

type ApiStep = SyncStep & { resource: string }
type JsonObject = Record<string, unknown>

const app = new Hono<{ Bindings: Env }>()

app.use('/api/*', requireAccess)

app.onError((_error, context) => {
  console.error(JSON.stringify({ event: 'api_error', route: context.req.routePath ?? 'unknown' }))
  return context.json({ error: 'Ocorreu um erro ao processar a solicitação.' }, 500)
})

function apiPath(planId: string, suffix = ''): string {
  return `/plans/${encodeURIComponent(planId)}${suffix}`
}

function responseData(envelope: ApiEnvelope<JsonObject>): JsonObject {
  return envelope.data
}

function arrayFrom<T>(data: JsonObject, key: string): T[] {
  const value = data[key]
  return Array.isArray(value) ? value as T[] : []
}

function step(resource: string, path: string, key = resource): ApiStep {
  return { key, kind: 'endpoint', path, resource }
}

function baseSteps(planId: string, mode: 'initial' | 'delta'): ApiStep[] {
  const steps = [
    step('settings', apiPath(planId, '/settings')),
    step('accounts', apiPath(planId, '/accounts')),
    step('categories', apiPath(planId, '/categories')),
    step('payees', apiPath(planId, '/payees')),
    step('payee_locations', apiPath(planId, '/payee_locations')),
    step('scheduled_transactions', apiPath(planId, '/scheduled_transactions')),
    step('money_movements', apiPath(planId, '/money_movements')),
    step('money_movement_groups', apiPath(planId, '/money_movement_groups')),
    step('months', apiPath(planId, '/months')),
  ]
  if (mode === 'delta') steps.push(step('transactions', apiPath(planId, '/transactions')))
  return steps
}

function monthSteps(planId: string, months: Array<{ month?: string }>, mode: 'initial' | 'delta'): ApiStep[] {
  const result: ApiStep[] = []
  for (const item of months) {
    const month = item.month
    if (!month) continue
    result.push({
      key: `month:${month}`,
      kind: 'month_detail',
      path: apiPath(planId, `/months/${encodeURIComponent(month)}`),
      month,
      resource: 'month_detail',
    })
    if (mode === 'initial') {
      result.push({
        key: `transactions:${month}`,
        kind: 'month_transactions',
        path: apiPath(planId, `/months/${encodeURIComponent(month)}/transactions`),
        month,
        resource: 'transactions',
      })
    }
  }
  return result
}

function jobDto(row: JobRow) {
  const steps = JSON.parse(row.steps_json) as ApiStep[]
  return {
    id: row.id,
    planId: row.plan_id,
    planName: row.plan_name,
    mode: row.mode,
    status: row.status,
    stage: row.stage,
    stepIndex: row.step_index,
    totalSteps: steps.length,
    counts: JSON.parse(row.counts_json) as Record<string, number>,
    errorMessage: row.error_message,
    updatedAt: row.updated_at,
  }
}

async function loadJob(db: D1Database, jobId: string): Promise<JobRow | null> {
  return db.prepare('SELECT * FROM sync_jobs WHERE id = ?').bind(jobId).first<JobRow>()
}

async function getKnowledge(db: D1Database, planId: string, resourceKey: string, fallback: number): Promise<number> {
  return (await getCursor(db, planId, resourceKey)) ?? fallback
}

function currentMonthDate(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
}

app.get('/api/health', (context) => context.json({ ok: true }))

app.get('/api/ynab/plans', async (context) => {
  const envelope = await ynabGet<ApiEnvelope<{ plans: YnabPlanSummary[] }>>(context.env.YNAB_PAT, '/plans')
  return context.json({ plans: envelope.data.plans })
})

app.get('/api/plans', async (context) => {
  const result = await context.env.DB.prepare(`
    SELECT id, name, first_month, last_month, last_modified_on, currency_format_json, date_format_json, raw_json
    FROM plans ORDER BY name COLLATE NOCASE
  `).all<{ id: string; name: string; first_month: string | null; last_month: string | null; last_modified_on: string | null; currency_format_json: string | null; date_format_json: string | null; raw_json: string }>()
  return context.json({ plans: result.results.map((row) => ({
    id: row.id,
    name: row.name,
    firstMonth: row.first_month,
    lastMonth: row.last_month,
    lastModifiedOn: row.last_modified_on,
    currencyFormat: row.currency_format_json ? JSON.parse(row.currency_format_json) : null,
    dateFormat: row.date_format_json ? JSON.parse(row.date_format_json) : null,
  })) })
})

app.get('/api/sync', async (context) => {
  const result = await context.env.DB.prepare('SELECT * FROM sync_jobs ORDER BY created_at DESC LIMIT 20')
    .all<JobRow>()
  return context.json({ jobs: result.results.map(jobDto) })
})

app.post('/api/sync', async (context) => {
  let body: { planIds?: unknown }
  try {
    body = await context.req.json()
  } catch {
    return context.json({ error: 'Envie uma lista válida de planos.' }, 400)
  }
  const planIds = Array.isArray(body.planIds)
    ? [...new Set(body.planIds.filter((value): value is string => typeof value === 'string' && value.length <= 80))]
    : []
  if (planIds.length === 0 || planIds.length > 10) {
    return context.json({ error: 'Selecione entre 1 e 10 planos.' }, 400)
  }

  const available = await ynabGet<ApiEnvelope<{ plans: YnabPlanSummary[] }>>(context.env.YNAB_PAT, '/plans')
  const availableById = new Map(available.data.plans.map((plan) => [plan.id, plan]))
  const jobs: ReturnType<typeof jobDto>[] = []

  for (const planId of planIds) {
    const summary = availableById.get(planId)
    if (!summary) return context.json({ error: 'Um dos planos selecionados não está disponível no YNAB.' }, 404)

    const exists = await getPlanExists(context.env.DB, planId)
    const mode = exists ? 'delta' : 'initial'
    const fallbackKnowledge = 0
    const cursor = await getKnowledge(context.env.DB, planId, 'plan', fallbackKnowledge)
    const detail = await ynabGet<ApiEnvelope<{ plan: YnabPlanDetail }>>(context.env.YNAB_PAT, apiPath(planId),
      mode === 'delta' ? { last_knowledge_of_server: cursor } : {})
    const plan = detail.data.plan
    await upsertPlan(context.env.DB, plan)

    const startingKnowledge = detail.server_knowledge ?? cursor
    const steps = baseSteps(planId, mode)
    const id = crypto.randomUUID()
    await context.env.DB.prepare(`
      INSERT INTO sync_jobs (id, plan_id, plan_name, mode, status, stage, step_index, steps_json, starting_knowledge, server_knowledge, counts_json)
      VALUES (?, ?, ?, ?, 'queued', 'preparando', 0, ?, ?, ?, '{}')
    `).bind(id, planId, plan.name, mode, JSON.stringify(steps), startingKnowledge, startingKnowledge).run()
    const job = await loadJob(context.env.DB, id)
    if (job) jobs.push(jobDto(job))
  }

  return context.json({ jobs }, 202)
})

app.get('/api/sync/:jobId', async (context) => {
  const job = await loadJob(context.env.DB, context.req.param('jobId'))
  if (!job) return context.json({ error: 'Importação não encontrada.' }, 404)
  return context.json({ job: jobDto(job) })
})

app.post('/api/sync/:jobId/step', async (context) => {
  const { DB, YNAB_PAT } = context.env
  const jobId = context.req.param('jobId')
  const job = await loadJob(DB, jobId)
  if (!job) return context.json({ error: 'Importação não encontrada.' }, 404)
  if (job.status === 'complete') return context.json({ job: jobDto(job) })

  const steps = JSON.parse(job.steps_json) as ApiStep[]
  if (job.step_index >= steps.length) {
    const deltaResources = ['accounts', 'categories', 'payees', 'scheduled_transactions', 'money_movements', 'money_movement_groups', 'months', 'transactions', 'plan']
    await Promise.all(deltaResources.map((resource) => setCursor(DB, job.plan_id, resource, job.starting_knowledge)))
    await DB.prepare(`UPDATE sync_jobs SET status='complete', stage='concluída', updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(jobId).run()
    const complete = await loadJob(DB, jobId)
    return context.json({ job: complete ? jobDto(complete) : null })
  }

  const current = steps[job.step_index]
  await DB.prepare(`UPDATE sync_jobs SET status='running', stage=?, error_message=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(current.key, jobId).run()

  try {
    const knowledge = job.mode === 'delta' && current.kind === 'endpoint' && current.resource !== 'payee_locations'
      ? await getKnowledge(DB, job.plan_id, current.resource, job.starting_knowledge)
      : undefined
    const envelope = await ynabGet<ApiEnvelope<JsonObject>>(YNAB_PAT, current.path,
      knowledge === undefined ? {} : { last_knowledge_of_server: knowledge })
    const data = responseData(envelope)
    const count = current.kind === 'month_detail'
      ? await persistResource(DB, job.plan_id, current.resource, { month: data.month })
      : await persistResource(DB, job.plan_id, current.resource, data)

    if (job.mode === 'delta' && envelope.server_knowledge !== undefined && current.kind === 'endpoint') {
      await setCursor(DB, job.plan_id, current.resource, envelope.server_knowledge)
    }

    if (current.resource === 'months') {
      const monthRows = arrayFrom<{ month?: string }>(data, 'months')
      const dynamic = monthSteps(job.plan_id, monthRows, job.mode)
      steps.splice(job.step_index + 1, 0, ...dynamic)
    }

    const counts = JSON.parse(job.counts_json) as Record<string, number>
    counts[current.resource] = (counts[current.resource] ?? 0) + count
    await DB.prepare(`UPDATE sync_jobs SET status='running', step_index=step_index+1, steps_json=?, counts_json=?,
      server_knowledge=MAX(server_knowledge, ?), error_message=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(JSON.stringify(steps), JSON.stringify(counts), envelope.server_knowledge ?? 0, jobId).run()
  } catch (error) {
    const message = error instanceof YnabApiError
      ? error.message
      : 'Não foi possível concluir esta etapa. Você pode tentar novamente.'
    await DB.prepare(`UPDATE sync_jobs SET status='failed', error_message=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(message, jobId).run()
    const failed = await loadJob(DB, jobId)
    return context.json({ job: failed ? jobDto(failed) : null }, 502)
  }

  const updated = await loadJob(DB, jobId)
  return context.json({ job: updated ? jobDto(updated) : null })
})

app.get('/api/plans/:planId/overview', async (context) => {
  const planId = context.req.param('planId')
  const month = context.req.query('month') || currentMonthDate()
  const plan = await context.env.DB.prepare('SELECT raw_json FROM plans WHERE id=?').bind(planId).first<{ raw_json: string }>()
  if (!plan) return context.json({ error: 'Plano ainda não foi importado.' }, 404)

  const [accounts, monthSummary, categories, settings] = await Promise.all([
    context.env.DB.prepare(`SELECT id, name, type, on_budget, closed, balance, cleared_balance, uncleared_balance, raw_json
      FROM accounts WHERE plan_id=? AND deleted=0 ORDER BY closed, on_budget DESC, name COLLATE NOCASE`)
      .bind(planId).all<JsonObject>(),
    context.env.DB.prepare('SELECT raw_json FROM months WHERE plan_id=? AND month=?').bind(planId, month)
      .first<{ raw_json: string }>(),
    context.env.DB.prepare(`SELECT mc.category_id AS id, mc.category_group_id AS categoryGroupId, mc.name,
      mc.budgeted, mc.activity, mc.balance, mc.goal_type AS goalType, mc.raw_json,
      cg.name AS groupName, cg.hidden AS groupHidden
      FROM month_categories mc LEFT JOIN category_groups cg ON cg.id=mc.category_group_id
      WHERE mc.plan_id=? AND mc.month=? ORDER BY cg.name COLLATE NOCASE, mc.name COLLATE NOCASE`)
      .bind(planId, month).all<JsonObject>(),
    context.env.DB.prepare('SELECT raw_json FROM plan_settings WHERE plan_id=?').bind(planId)
      .first<{ raw_json: string }>(),
  ])

  return context.json({
    plan: JSON.parse(plan.raw_json),
    accounts: accounts.results.map((row) => ({ ...row, raw: JSON.parse(String(row.raw_json)) })),
    month: monthSummary ? JSON.parse(monthSummary.raw_json) : null,
    categories: categories.results.map((row) => ({ ...row, raw: JSON.parse(String(row.raw_json)) })),
    settings: settings ? JSON.parse(settings.raw_json) : null,
  })
})

app.get('/api/plans/:planId/months/:month', async (context) => {
  const planId = context.req.param('planId')
  const month = context.req.param('month')
  const [summary, categories] = await Promise.all([
    context.env.DB.prepare('SELECT raw_json FROM months WHERE plan_id=? AND month=?').bind(planId, month)
      .first<{ raw_json: string }>(),
    context.env.DB.prepare(`SELECT mc.category_id AS id, mc.category_group_id AS categoryGroupId, mc.name,
      mc.budgeted, mc.activity, mc.balance, mc.goal_type AS goalType, mc.raw_json,
      cg.name AS groupName, cg.hidden AS groupHidden
      FROM month_categories mc LEFT JOIN category_groups cg ON cg.id=mc.category_group_id
      WHERE mc.plan_id=? AND mc.month=? ORDER BY cg.name COLLATE NOCASE, mc.name COLLATE NOCASE`)
      .bind(planId, month).all<JsonObject>(),
  ])
  if (!summary) return context.json({ error: 'Mês não encontrado.' }, 404)
  return context.json({
    month: JSON.parse(summary.raw_json),
    categories: categories.results.map((row) => ({ ...row, raw: JSON.parse(String(row.raw_json)) })),
  })
})

app.get('/api/plans/:planId/transactions', async (context) => {
  const planId = context.req.param('planId')
  const limit = Math.max(1, Math.min(200, Number(context.req.query('limit') || 100)))
  const before = context.req.query('before')
  const rows = before
    ? await context.env.DB.prepare(`SELECT t.id, t.account_id AS accountId, a.name AS accountName, t.date, t.amount,
        t.memo, t.cleared, t.approved, t.flag_color AS flagColor, t.payee_id AS payeeId, p.name AS payeeName,
        t.category_id AS categoryId, c.name AS categoryName, t.raw_json
        FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN payees p ON p.id=t.payee_id
        LEFT JOIN categories c ON c.id=t.category_id WHERE t.plan_id=? AND t.deleted=0 AND t.date<?
        ORDER BY t.date DESC, t.id LIMIT ?`).bind(planId, before, limit).all<JsonObject>()
    : await context.env.DB.prepare(`SELECT t.id, t.account_id AS accountId, a.name AS accountName, t.date, t.amount,
        t.memo, t.cleared, t.approved, t.flag_color AS flagColor, t.payee_id AS payeeId, p.name AS payeeName,
        t.category_id AS categoryId, c.name AS categoryName, t.raw_json
        FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN payees p ON p.id=t.payee_id
        LEFT JOIN categories c ON c.id=t.category_id WHERE t.plan_id=? AND t.deleted=0
        ORDER BY t.date DESC, t.id LIMIT ?`).bind(planId, limit).all<JsonObject>()
  return context.json({ transactions: rows.results.map((row) => ({ ...row, raw: JSON.parse(String(row.raw_json)) })) })
})

app.all('*', (context) => context.env.ASSETS.fetch(context.req.raw))

export default app
