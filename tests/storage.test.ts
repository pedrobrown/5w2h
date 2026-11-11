import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { persistResource, upsertPlan } from '../worker/storage'

describe('YNAB D1 persistence', () => {
  it('preserves API fields and milliunit precision on account upserts', async () => {
    const plan = {
      id: 'plan-test-1',
      name: 'Plano de teste',
      currency_format: { iso_code: 'BRL', currency_symbol: 'R$', decimal_digits: 2 },
      date_format: { format: 'DD/MM/YYYY' },
    }
    const account = {
      id: 'account-test-1',
      name: 'Conta corrente',
      type: 'checking',
      on_budget: true,
      closed: false,
      balance: -20235,
      cleared_balance: -19875,
      uncleared_balance: -360,
      transfer_payee_id: null,
      note: null,
      deleted: false,
      balance_currency: -20.235,
      balance_formatted: 'R$ -20,24',
      added_by_new_api_version: 'preserved-verbatim',
    }
    await upsertPlan(env.DB, plan)
    await persistResource(env.DB, plan.id, 'accounts', { accounts: [account] })
    await persistResource(env.DB, plan.id, 'accounts', { accounts: [account] })

    const stored = await env.DB.prepare('SELECT balance, raw_json FROM accounts WHERE id=?')
      .bind(account.id).first<{ balance: number; raw_json: string }>()
    expect(stored?.balance).toBe(-20235)
    expect(JSON.parse(stored?.raw_json ?? '{}')).toEqual(account)
    const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM accounts WHERE id=?')
      .bind(account.id).first<{ count: number }>()
    expect(count?.count).toBe(1)
  })

  it('stores split transactions and keeps nullable API fields intact', async () => {
    const plan = { id: 'plan-test-2', name: 'Plano dividido' }
    await upsertPlan(env.DB, plan)
    const transaction = {
      id: 'transaction-test-1',
      account_id: 'account-test-1',
      date: '2017-01-02',
      amount: -12500,
      memo: null,
      cleared: 'cleared',
      approved: true,
      flag_color: null,
      flag_name: null,
      payee_id: null,
      category_id: null,
      transfer_account_id: null,
      deleted: false,
      account_name: 'Conta corrente',
      payee_name: null,
      category_name: 'Split',
      subtransactions: [{
        id: 'split-test-1',
        transaction_id: 'transaction-test-1',
        amount: -12500,
        memo: null,
        payee_id: null,
        category_id: 'category-test-1',
        transfer_account_id: null,
        deleted: false,
        subtransaction_extension: { imported: true },
      }],
      response_extension: null,
    }
    await persistResource(env.DB, plan.id, 'transactions', { transactions: [transaction] })

    const split = await env.DB.prepare('SELECT amount, raw_json FROM subtransactions WHERE id=?')
      .bind('split-test-1').first<{ amount: number; raw_json: string }>()
    expect(split?.amount).toBe(-12500)
    expect(JSON.parse(split?.raw_json ?? '{}')).toEqual(transaction.subtransactions[0])
    const stored = await env.DB.prepare('SELECT raw_json FROM transactions WHERE id=?')
      .bind('transaction-test-1').first<{ raw_json: string }>()
    expect(JSON.parse(stored?.raw_json ?? '{}')).toEqual(transaction)
  })

  it('stores month category records with original goal fields', async () => {
    const plan = { id: 'plan-test-3', name: 'Plano mensal' }
    await upsertPlan(env.DB, plan)
    const month = {
      month: '2016-06-01',
      income: 100000,
      budgeted: 100000,
      activity: -10000,
      to_be_budgeted: 0,
      age_of_money: null,
      deleted: false,
      categories: [{
        id: 'category-test-2', category_group_id: 'group-test-1', name: 'Mercado', hidden: false,
        internal: false, deleted: false, budgeted: 30000, activity: -10000, balance: 20000,
        goal_type: 'NEED', goal_target: 30000, goal_snoozed_at: null,
      }],
    }
    await persistResource(env.DB, plan.id, 'months', { months: [month] })
    await persistResource(env.DB, plan.id, 'month_detail', { month })
    const stored = await env.DB.prepare('SELECT budgeted, balance, raw_json FROM month_categories WHERE plan_id=? AND month=? AND category_id=?')
      .bind(plan.id, month.month, 'category-test-2').first<{ budgeted: number; balance: number; raw_json: string }>()
    expect(stored?.budgeted).toBe(30000)
    expect(stored?.balance).toBe(20000)
    expect(JSON.parse(stored?.raw_json ?? '{}')).toEqual(month.categories[0])
  })
})
