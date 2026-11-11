import type { components } from './generated/api'

export type YnabPlanSummary = components['schemas']['PlanSummary']
export type YnabPlanDetail = components['schemas']['PlanDetail']
export type YnabAccount = components['schemas']['Account']
export type YnabCategory = components['schemas']['Category']
export type YnabCategoryGroup = components['schemas']['CategoryGroup']
export type YnabMonth = components['schemas']['MonthSummary']
export type YnabMonthDetail = components['schemas']['MonthDetail']
export type YnabPayee = components['schemas']['Payee']
export type YnabPayeeLocation = components['schemas']['PayeeLocation']
export type YnabTransaction = components['schemas']['TransactionDetail']
export type YnabSubtransaction = components['schemas']['SubTransaction']
export type YnabScheduledTransaction = components['schemas']['ScheduledTransactionDetail']
export type YnabScheduledSubtransaction = components['schemas']['ScheduledSubTransaction']
export type YnabMoneyMovement = components['schemas']['MoneyMovement']
export type YnabMoneyMovementGroup = components['schemas']['MoneyMovementGroup']

/** Fields added to plan responses after the checked-in OpenAPI document was generated. */
export type CurrentYnabAccount = YnabAccount & {
  cleared_balance_formatted?: string
  cleared_balance_currency?: number
  uncleared_balance_formatted?: string
  uncleared_balance_currency?: number
}

export type CurrentYnabScheduledTransaction = YnabScheduledTransaction & {
  account_name?: string
  payee_name?: string | null
  category_name?: string | null
}

export type YnabRecord = Record<string, unknown> & { id: string }

export type YnabEnvelope<T> = {
  data: T
}

export type YnabListEnvelope<T> = {
  data: T
  server_knowledge?: number
}

export type SyncStep = {
  key: string
  kind: 'endpoint' | 'month_detail' | 'month_transactions'
  path: string
  month?: string
}

export type SyncJob = {
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
  updatedAt: string
}
