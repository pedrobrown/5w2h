import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'
import type {
  YnabAccount,
  YnabCategory,
  YnabCategoryGroup,
  YnabMonth,
  YnabMonthDetail,
  YnabMoneyMovement,
  YnabMoneyMovementGroup,
  YnabPayee,
  YnabPayeeLocation,
  YnabPlanDetail,
  YnabPlanSummary,
  YnabScheduledTransaction,
  YnabTransaction,
} from '../src/ynab/types'

type JsonObject = Record<string, unknown>

const asInt = (value: boolean | undefined | null): number => Number(Boolean(value))
const json = (value: unknown): string => JSON.stringify(value ?? null)

async function writeBatch(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50))
  }
}

export async function upsertPlan(db: D1Database, plan: YnabPlanSummary | YnabPlanDetail): Promise<void> {
  await db.prepare(`
    INSERT INTO plans (id, name, first_month, last_month, last_modified_on, currency_format_json, date_format_json, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, first_month=excluded.first_month, last_month=excluded.last_month,
      last_modified_on=excluded.last_modified_on, currency_format_json=excluded.currency_format_json,
      date_format_json=excluded.date_format_json, raw_json=excluded.raw_json
  `).bind(
    plan.id,
    plan.name,
    plan.first_month ?? null,
    plan.last_month ?? null,
    plan.last_modified_on ?? null,
    plan.currency_format ? json(plan.currency_format) : null,
    plan.date_format ? json(plan.date_format) : null,
    json(plan),
  ).run()
}

async function upsertAccounts(db: D1Database, planId: string, records: YnabAccount[]): Promise<number> {
  const statements = records.map((row) => db.prepare(`
    INSERT INTO accounts (id, plan_id, name, type, on_budget, closed, balance, cleared_balance, uncleared_balance, deleted, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET plan_id=excluded.plan_id, name=excluded.name, type=excluded.type,
      on_budget=excluded.on_budget, closed=excluded.closed, balance=excluded.balance,
      cleared_balance=excluded.cleared_balance, uncleared_balance=excluded.uncleared_balance,
      deleted=excluded.deleted, raw_json=excluded.raw_json
  `).bind(row.id, planId, row.name, row.type, asInt(row.on_budget), asInt(row.closed), row.balance,
    row.cleared_balance, row.uncleared_balance, asInt(row.deleted), json(row)))
  await writeBatch(db, statements)
  return records.length
}

async function upsertCategoryGroups(db: D1Database, planId: string, records: YnabCategoryGroup[]): Promise<number> {
  const statements = records.map((row) => db.prepare(`
    INSERT INTO category_groups (id, plan_id, name, hidden, deleted, raw_json) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET plan_id=excluded.plan_id, name=excluded.name, hidden=excluded.hidden,
      deleted=excluded.deleted, raw_json=excluded.raw_json
  `).bind(row.id, planId, row.name, asInt(row.hidden), asInt(row.deleted), json(row)))
  await writeBatch(db, statements)
  return records.length
}

async function upsertCategories(db: D1Database, planId: string, records: YnabCategory[]): Promise<number> {
  const statements = records.map((row) => db.prepare(`
    INSERT INTO categories (id, plan_id, category_group_id, name, hidden, deleted, balance, goal_type, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET plan_id=excluded.plan_id, category_group_id=excluded.category_group_id,
      name=excluded.name, hidden=excluded.hidden, deleted=excluded.deleted, balance=excluded.balance,
      goal_type=excluded.goal_type, raw_json=excluded.raw_json
  `).bind(row.id, planId, row.category_group_id, row.name, asInt(row.hidden), asInt(row.deleted),
    row.balance, row.goal_type ?? null, json(row)))
  await writeBatch(db, statements)
  return records.length
}

async function upsertMonths(db: D1Database, planId: string, records: YnabMonth[]): Promise<number> {
  const statements = records.map((row) => db.prepare(`
    INSERT INTO months (plan_id, month, income, budgeted, activity, to_be_budgeted, age_of_money, deleted, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(plan_id, month) DO UPDATE SET income=excluded.income, budgeted=excluded.budgeted,
      activity=excluded.activity, to_be_budgeted=excluded.to_be_budgeted, age_of_money=excluded.age_of_money,
      deleted=excluded.deleted, raw_json=excluded.raw_json
  `).bind(planId, row.month, row.income, row.budgeted, row.activity, row.to_be_budgeted,
    row.age_of_money ?? null, asInt(row.deleted), json(row)))
  await writeBatch(db, statements)
  return records.length
}

async function upsertMonthDetail(db: D1Database, planId: string, month: YnabMonthDetail): Promise<number> {
  const statements = month.categories.map((row) => db.prepare(`
    INSERT INTO month_categories (plan_id, month, category_id, category_group_id, name, budgeted, activity, balance, goal_type, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(plan_id, month, category_id) DO UPDATE SET category_group_id=excluded.category_group_id,
      name=excluded.name, budgeted=excluded.budgeted, activity=excluded.activity, balance=excluded.balance,
      goal_type=excluded.goal_type, raw_json=excluded.raw_json
  `).bind(planId, month.month, row.id, row.category_group_id, row.name, row.budgeted, row.activity,
    row.balance, row.goal_type ?? null, json(row)))
  await writeBatch(db, statements)
  return statements.length
}

async function upsertPayees(db: D1Database, planId: string, records: YnabPayee[]): Promise<number> {
  const statements = records.map((row) => db.prepare(`
    INSERT INTO payees (id, plan_id, name, deleted, raw_json) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET plan_id=excluded.plan_id, name=excluded.name,
      deleted=excluded.deleted, raw_json=excluded.raw_json
  `).bind(row.id, planId, row.name, asInt(row.deleted), json(row)))
  await writeBatch(db, statements)
  return records.length
}

async function upsertPayeeLocations(db: D1Database, planId: string, records: YnabPayeeLocation[]): Promise<number> {
  const statements = records.map((row) => db.prepare(`
    INSERT INTO payee_locations (id, plan_id, payee_id, raw_json) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET plan_id=excluded.plan_id, payee_id=excluded.payee_id, raw_json=excluded.raw_json
  `).bind(row.id, planId, row.payee_id, json(row)))
  await writeBatch(db, statements)
  return records.length
}

async function upsertTransactions(db: D1Database, planId: string, records: YnabTransaction[]): Promise<number> {
  const statements: D1PreparedStatement[] = []
  for (const row of records) {
    statements.push(db.prepare(`
      INSERT INTO transactions (id, plan_id, account_id, date, amount, memo, cleared, approved, flag_color, flag_name,
        payee_id, category_id, transfer_account_id, deleted, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET plan_id=excluded.plan_id, account_id=excluded.account_id, date=excluded.date,
        amount=excluded.amount, memo=excluded.memo, cleared=excluded.cleared, approved=excluded.approved,
        flag_color=excluded.flag_color, flag_name=excluded.flag_name, payee_id=excluded.payee_id,
        category_id=excluded.category_id, transfer_account_id=excluded.transfer_account_id,
        deleted=excluded.deleted, raw_json=excluded.raw_json
    `).bind(row.id, planId, row.account_id, row.date, row.amount, row.memo ?? null, row.cleared,
      asInt(row.approved), row.flag_color ?? null, row.flag_name ?? null, row.payee_id ?? null,
      row.category_id ?? null, row.transfer_account_id ?? null, asInt(row.deleted), json(row)))
    for (const split of row.subtransactions ?? []) {
      statements.push(db.prepare(`
        INSERT INTO subtransactions (id, plan_id, transaction_id, amount, memo, payee_id, category_id, transfer_account_id, deleted, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET plan_id=excluded.plan_id, transaction_id=excluded.transaction_id,
          amount=excluded.amount, memo=excluded.memo, payee_id=excluded.payee_id, category_id=excluded.category_id,
          transfer_account_id=excluded.transfer_account_id, deleted=excluded.deleted, raw_json=excluded.raw_json
      `).bind(split.id, planId, row.id, split.amount, split.memo ?? null, split.payee_id ?? null,
        split.category_id ?? null, split.transfer_account_id ?? null, asInt(split.deleted), json(split)))
    }
  }
  await writeBatch(db, statements)
  return records.length
}

async function upsertScheduled(db: D1Database, planId: string, records: YnabScheduledTransaction[]): Promise<number> {
  const statements: D1PreparedStatement[] = []
  for (const row of records) {
    statements.push(db.prepare(`
      INSERT INTO scheduled_transactions (id, plan_id, account_id, date_first, date_next, frequency, amount, memo,
        payee_id, category_id, flag_color, flag_name, deleted, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET plan_id=excluded.plan_id, account_id=excluded.account_id,
        date_first=excluded.date_first, date_next=excluded.date_next, frequency=excluded.frequency,
        amount=excluded.amount, memo=excluded.memo, payee_id=excluded.payee_id, category_id=excluded.category_id,
        flag_color=excluded.flag_color, flag_name=excluded.flag_name, deleted=excluded.deleted, raw_json=excluded.raw_json
    `).bind(row.id, planId, row.account_id, row.date_first, row.date_next ?? null, row.frequency, row.amount,
      row.memo ?? null, row.payee_id ?? null, row.category_id ?? null, row.flag_color ?? null,
      row.flag_name ?? null, asInt(row.deleted), json(row)))
    for (const split of row.subtransactions ?? []) {
      statements.push(db.prepare(`
        INSERT INTO scheduled_subtransactions (id, plan_id, scheduled_transaction_id, amount, memo, payee_id, category_id, deleted, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET plan_id=excluded.plan_id, scheduled_transaction_id=excluded.scheduled_transaction_id,
          amount=excluded.amount, memo=excluded.memo, payee_id=excluded.payee_id, category_id=excluded.category_id,
          deleted=excluded.deleted, raw_json=excluded.raw_json
      `).bind(split.id, planId, row.id, split.amount, split.memo ?? null, split.payee_id ?? null,
        split.category_id ?? null, asInt(split.deleted), json(split)))
    }
  }
  await writeBatch(db, statements)
  return records.length
}

async function upsertMoneyMovements(db: D1Database, planId: string, records: YnabMoneyMovement[]): Promise<number> {
  const statements = records.map((row) => db.prepare(`
    INSERT INTO money_movements (id, plan_id, month, moved_at, money_movement_group_id, from_category_id, to_category_id, amount, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET plan_id=excluded.plan_id, month=excluded.month, moved_at=excluded.moved_at,
      money_movement_group_id=excluded.money_movement_group_id, from_category_id=excluded.from_category_id,
      to_category_id=excluded.to_category_id, amount=excluded.amount, raw_json=excluded.raw_json
  `).bind(row.id, planId, row.month ?? null, row.moved_at ?? null, row.money_movement_group_id ?? null,
    row.from_category_id ?? null, row.to_category_id ?? null, row.amount, json(row)))
  await writeBatch(db, statements)
  return records.length
}

async function upsertMoneyMovementGroups(db: D1Database, planId: string, records: YnabMoneyMovementGroup[]): Promise<number> {
  const statements = records.map((row) => db.prepare(`
    INSERT INTO money_movement_groups (id, plan_id, month, group_created_at, raw_json) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET plan_id=excluded.plan_id, month=excluded.month,
      group_created_at=excluded.group_created_at, raw_json=excluded.raw_json
  `).bind(row.id, planId, row.month, row.group_created_at, json(row)))
  await writeBatch(db, statements)
  return records.length
}

export async function persistResource(
  db: D1Database,
  planId: string,
  resource: string,
  data: JsonObject,
): Promise<number> {
  switch (resource) {
    case 'plan': {
      await upsertPlan(db, data.plan as unknown as YnabPlanDetail)
      return 1
    }
    case 'settings': {
      await db.prepare(`INSERT INTO plan_settings (plan_id, raw_json) VALUES (?, ?)
        ON CONFLICT(plan_id) DO UPDATE SET raw_json=excluded.raw_json`).bind(planId, json(data.settings)).run()
      return 1
    }
    case 'accounts': return upsertAccounts(db, planId, (data.accounts as YnabAccount[]) ?? [])
    case 'categories': {
      const groups = (data.category_groups as Array<YnabCategoryGroup & { categories?: YnabCategory[] }>) ?? []
      const groupCount = await upsertCategoryGroups(db, planId, groups)
      const categories = groups.flatMap((group) => group.categories ?? [])
      return groupCount + await upsertCategories(db, planId, categories)
    }
    case 'payees': return upsertPayees(db, planId, (data.payees as YnabPayee[]) ?? [])
    case 'payee_locations': return upsertPayeeLocations(db, planId, (data.payee_locations as YnabPayeeLocation[]) ?? [])
    case 'scheduled_transactions': return upsertScheduled(db, planId, (data.scheduled_transactions as YnabScheduledTransaction[]) ?? [])
    case 'money_movements': return upsertMoneyMovements(db, planId, (data.money_movements as YnabMoneyMovement[]) ?? [])
    case 'money_movement_groups': return upsertMoneyMovementGroups(db, planId, (data.money_movement_groups as YnabMoneyMovementGroup[]) ?? [])
    case 'months': return upsertMonths(db, planId, (data.months as YnabMonth[]) ?? [])
    case 'month_detail': return upsertMonthDetail(db, planId, data.month as unknown as YnabMonthDetail)
    case 'transactions': return upsertTransactions(db, planId, (data.transactions as YnabTransaction[]) ?? [])
    default: return 0
  }
}

export async function getPlanExists(db: D1Database, planId: string): Promise<boolean> {
  const row = await db.prepare('SELECT id FROM plans WHERE id = ?').bind(planId).first<{ id: string }>()
  return Boolean(row)
}

export async function getCursor(db: D1Database, planId: string, resourceKey: string): Promise<number | undefined> {
  const row = await db.prepare('SELECT server_knowledge FROM sync_cursors WHERE plan_id = ? AND resource_key = ?')
    .bind(planId, resourceKey).first<{ server_knowledge: number }>()
  return row?.server_knowledge
}

export async function setCursor(db: D1Database, planId: string, resourceKey: string, knowledge: number): Promise<void> {
  await db.prepare(`INSERT INTO sync_cursors (plan_id, resource_key, server_knowledge, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(plan_id, resource_key) DO UPDATE SET server_knowledge=excluded.server_knowledge, updated_at=CURRENT_TIMESTAMP`)
    .bind(planId, resourceKey, knowledge).run()
}
