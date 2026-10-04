import type { LicenseWindow, RightsComment, Territory, WindowStatus } from './types'
import { parentOf, territoriesOverlap } from './territory'
import { findConflicts } from './rules'

/** 旧稿没有修订号，统一迁移到首批 */
export const MIGRATION_BATCH_ID = 'B-001'
const INITIAL_REVISION = 1

export type BatchStatus = '生效' | '独占驳回' | '后到差异' | '写入失败'
export type DiffKind = '修订落后' | '同独占先到先得' | '独占拦截普通' | '普通被独占覆盖' | '条款随批次留存'

export interface BatchWindowPayload {
  id?: string
  workId: string
  work: string
  channel: string
  rights: LicenseWindow['rights']
  territory: Territory
  start: string
  end: string
  exclusive: boolean
  sublicense: boolean
  priority: number
}

export interface BatchCommentPayload {
  channel: string
  anchor: string
  author: string
  role: string
  content: string
}

export interface BatchDiff {
  kind: DiffKind
  windowLabel: string
  message: string
}

export interface ChangeBatch {
  id: string
  seq: number
  submittedAt: string
  /** 提交时绑定的母地区最新修订号（乐观锁） */
  baseRevision: number
  /** 生效后母地区的新修订号 */
  committedRevision?: number
  /** 迁移首批可跨多个母地区，其余批次单一 */
  parentTerritory?: Territory
  summary: string
  windows: BatchWindowPayload[]
  comments: BatchCommentPayload[]
  status: BatchStatus
  appliedWindowIds: string[]
  coveredWindowIds: string[]
  diffs: BatchDiff[]
  failReason?: string
  attempts: number
}

export interface BatchState {
  /** 每个母地区组的最新修订号 */
  revisions: Record<Territory, number>
  windows: LicenseWindow[]
  comments: RightsComment[]
  batches: ChangeBatch[]
  seq: number
}

export interface CommitBatchInput {
  parentTerritory: Territory
  windows?: BatchWindowPayload[]
  comments?: BatchCommentPayload[]
  summary?: string
  /** 两地区组同时提交时各自预绑定的修订号；缺省取当前最新 */
  baseRevision?: number
  simulateWriteFailure?: boolean
  failReason?: string
  submittedAt?: string
}

export interface CommitResult {
  state: BatchState
  batch: ChangeBatch
}

const emptyRevisions = (): Record<Territory, number> => ({
  中国大陆: 0,
  中国香港: 0,
  中国台湾: 0,
  新加坡: 0,
  马来西亚: 0,
  东南亚区域: 0,
  北美: 0,
})

const labelOf = (payload: { channel: string; territory: Territory }) =>
  `${payload.channel}@${payload.territory}`

const overlapsInTime = (a: { start: string; end: string }, b: { start: string; end: string }) =>
  new Date(a.start) <= new Date(b.end) && new Date(b.start) <= new Date(a.end)

const activeWindows = (windows: LicenseWindow[]) => windows.filter((item) => item.status !== '已覆盖')

function nextWindowId(windows: { id: string }[]): string {
  const max = windows.reduce((acc, item) => {
    const matched = /^RW-(\d+)$/.exec(item.id)
    return matched ? Math.max(acc, Number(matched[1])) : acc
  }, 100)
  return `RW-${max + 1}`
}

function nextCommentId(comments: { id: string }[]): string {
  const max = comments.reduce((acc, item) => {
    const matched = /^CM-(\d+)$/.exec(item.id)
    return matched ? Math.max(acc, Number(matched[1])) : acc
  }, 30)
  return `CM-${max + 1}`
}

function anchorWindowId(anchor: string): string | undefined {
  const matched = /(RW-\d+)/.exec(anchor)
  return matched?.[1]
}

/**
 * 旧稿迁移：没有修订号的窗口与条款意见归入首批 B-001，
 * 涉及到的母地区组修订号初始化为 1。
 */
export function migrateLegacy(
  windows: LicenseWindow[],
  comments: RightsComment[],
  submittedAt = new Date().toISOString(),
): { state: Pick<BatchState, 'revisions' | 'windows' | 'comments' | 'batches' | 'seq'> } {
  const revisions = emptyRevisions()
  const legacyWindowIds = new Set(
    windows.filter((item) => item.revision === undefined).map((item) => item.id),
  )
  const stampedWindows = windows.map((item) => {
    if (item.revision !== undefined) {
      revisions[parentOf(item.territory)] = Math.max(revisions[parentOf(item.territory)]!, item.revision)
      return item
    }
    revisions[parentOf(item.territory)] = INITIAL_REVISION
    return { ...item, revision: INITIAL_REVISION, batchId: MIGRATION_BATCH_ID }
  })
  const legacyCommentList: BatchCommentPayload[] = []
  const stampedComments = comments.map((item) => {
    if (item.revision !== undefined) return item
    const anchored = anchorWindowId(item.anchor)
    const win = stampedWindows.find((window) => window.id === anchored)
    const revision = win ? revisions[parentOf(win.territory)] || INITIAL_REVISION : INITIAL_REVISION
    legacyCommentList.push({ channel: item.channel, anchor: item.anchor, author: item.author, role: item.role, content: item.content })
    return { ...item, revision, batchId: MIGRATION_BATCH_ID }
  })
  const hasLegacy = legacyWindowIds.size > 0 || legacyCommentList.length > 0
  const migrationBatch: ChangeBatch = {
    id: MIGRATION_BATCH_ID,
    seq: 1,
    submittedAt,
    baseRevision: 0,
    committedRevision: INITIAL_REVISION,
    summary: '旧稿迁移：历史授权窗口与条款意见归入首批，补齐母地区修订号',
    windows: stampedWindows
      .filter((item) => legacyWindowIds.has(item.id))
      .map(({ id, workId, work, channel, rights, territory, start, end, exclusive, sublicense, priority }) => ({
        id, workId, work, channel, rights, territory, start, end, exclusive, sublicense, priority,
      })),
    comments: legacyCommentList,
    status: '生效',
    appliedWindowIds: stampedWindows.filter((item) => legacyWindowIds.has(item.id)).map((item) => item.id),
    coveredWindowIds: [],
    diffs: [],
    attempts: 1,
  }
  return {
    state: {
      revisions,
      windows: stampedWindows,
      comments: stampedComments,
      batches: hasLegacy ? [migrationBatch] : [],
      seq: hasLegacy ? 1 : 0,
    },
  }
}

/** 针对已生效数据评估单个窗口能否写入，返回首个阻挡原因 */
function evaluateAgainstCommitted(
  payload: BatchWindowPayload,
  windows: LicenseWindow[],
  selfId?: string,
): { blocked?: BatchDiff; winner?: LicenseWindow } {
  const blockers = activeWindows(windows).filter(
    (item) => item.id !== selfId
      && item.workId === payload.workId
      && territoriesOverlap(item.territory, payload.territory)
      && overlapsInTime(item, payload),
  )
  const winnerExclusive = blockers.find((item) => item.exclusive)
  if (payload.exclusive && winnerExclusive) {
    return {
      blocked: {
        kind: '同独占先到先得',
        windowLabel: labelOf(payload),
        message: `同一独占按先到批次生效：先到批次 ${winnerExclusive.batchId ?? '—'} 的「${winnerExclusive.channel}@${winnerExclusive.territory}」独占窗口已占用母地区 ${parentOf(payload.territory)} 授权范围。`,
      },
      winner: winnerExclusive,
    }
  }
  if (!payload.exclusive && winnerExclusive) {
    return {
      blocked: {
        kind: '独占拦截普通',
        windowLabel: labelOf(payload),
        message: `独占高于普通授权：先到批次 ${winnerExclusive.batchId ?? '—'} 的「${winnerExclusive.channel}@${winnerExclusive.territory}」独占仍在有效期，普通授权不能写入。`,
      },
      winner: winnerExclusive,
    }
  }
  return {}
}

interface RunResult {
  batch: ChangeBatch
  state: BatchState
}

function withBatch(prev: BatchState, seq: number, batch: ChangeBatch, next: Omit<BatchState, 'batches' | 'seq'>): RunResult {
  const batches = prev.batches.some((item) => item.id === batch.id)
    ? prev.batches.map((item) => item.id === batch.id ? batch : item)
    : [...prev.batches, batch]
  return { batch, state: { ...next, seq, batches } }
}

/** 核心提交流程；恢复 / 重提复用同一逻辑（保持批次号不变） */
function runCommit(
  prev: BatchState,
  input: CommitBatchInput,
  reuse?: { id: string; seq: number; submittedAt: string; attempts: number },
): RunResult {
  const seq = reuse?.seq ?? prev.seq + 1
  const id = reuse?.id ?? `B-${String(seq).padStart(3, '0')}`
  const submittedAt = reuse?.submittedAt ?? input.submittedAt ?? new Date().toISOString()
  const parent = input.parentTerritory
  const baseRevision = input.baseRevision ?? prev.revisions[parent] ?? 0
  const latestRevision = prev.revisions[parent] ?? 0
  const payloadWindows = input.windows ?? []
  const payloadComments = input.comments ?? []
  const attempts = (reuse?.attempts ?? 0) + 1

  const baseBatch: ChangeBatch = {
    id,
    seq,
    submittedAt,
    baseRevision,
    parentTerritory: parent,
    summary: input.summary ?? `${parent} 变更批次（${payloadWindows.length} 个窗口 / ${payloadComments.length} 条条款意见）`,
    windows: payloadWindows,
    comments: payloadComments,
    status: '生效',
    appliedWindowIds: [],
    coveredWindowIds: [],
    diffs: [],
    attempts,
  }

  // 写入失败：批次原样保留，不产生任何窗口/修订变更，之后按批次号恢复
  if (input.simulateWriteFailure) {
    const failed: ChangeBatch = { ...baseBatch, status: '写入失败', failReason: input.failReason ?? '存储写入失败，批次已留存待恢复。' }
    const batches = prev.batches.some((item) => item.id === id)
      ? prev.batches.map((item) => item.id === id ? failed : item)
      : [...prev.batches, failed]
    return { batch: failed, state: { ...prev, seq, batches } }
  }

  // 后到批次：绑定的修订号已落后，整体不写入，逐项留下差异
  if (baseRevision !== latestRevision) {
    const diffs: BatchDiff[] = payloadWindows.map((payload) => {
      const { blocked } = evaluateAgainstCommitted(payload, prev.windows, payload.id)
      if (blocked) return blocked
      return {
        kind: '修订落后',
        windowLabel: labelOf(payload),
        message: `绑定的母地区 ${parent} 修订号 R${baseRevision} 已过期，当前为 R${latestRevision}；窗口未写入，可按最新修订号重新提交。`,
      }
    })
    payloadComments.forEach((comment) => diffs.push({
      kind: '条款随批次留存',
      windowLabel: comment.anchor,
      message: `条款意见「${comment.content.slice(0, 24)}…」未随窗口落库，随批次差异保留。`,
    }))
    return withBatch(prev, seq, { ...baseBatch, status: '后到差异', diffs }, {
      revisions: prev.revisions,
      windows: prev.windows,
      comments: prev.comments,
    })
  }

  // 修订号一致：逐窗口按到达顺序处理，独占高于普通授权
  let workingWindows = [...prev.windows]
  const generatedIds = new Map<number, string>()
  const diffs: BatchDiff[] = []
  const appliedWindowIds: string[] = []
  const coveredWindowIds: string[] = []

  payloadWindows.forEach((payload, index) => {
    const windowId = payload.id ?? generatedIds.get(index) ?? nextWindowId(workingWindows)
    if (!payload.id && !generatedIds.has(index)) generatedIds.set(index, windowId)
    const { blocked } = evaluateAgainstCommitted(payload, workingWindows, payload.id)
    if (blocked) {
      diffs.push(blocked)
      return
    }
    // 独占生效：覆盖母地区授权范围内重叠的普通授权
    const covered = payload.exclusive
      ? activeWindows(workingWindows).filter((item) => item.id !== windowId
        && item.workId === payload.workId
        && !item.exclusive
        && territoriesOverlap(item.territory, payload.territory)
        && overlapsInTime(item, payload))
      : []
    covered.forEach((item) => {
      coveredWindowIds.push(item.id)
      diffs.push({
        kind: '普通被独占覆盖',
        windowLabel: `${item.channel}@${item.territory}`,
        message: `独占高于普通授权：「${item.channel}@${item.territory}」普通授权被批次 ${id} 的独占窗口覆盖（窗口 ${windowId}）。`,
      })
    })
    const nextWindow: LicenseWindow = {
      id: windowId,
      workId: payload.workId,
      work: payload.work,
      channel: payload.channel,
      rights: payload.rights,
      territory: payload.territory,
      start: payload.start,
      end: payload.end,
      exclusive: payload.exclusive,
      sublicense: payload.sublicense,
      priority: payload.priority,
      status: '已确认',
      batchId: id,
      revision: latestRevision + 1,
    }
    workingWindows = workingWindows.some((item) => item.id === windowId)
      ? workingWindows.map((item) => item.id === windowId ? nextWindow : item)
      : [...workingWindows, nextWindow]
    if (covered.length) {
      workingWindows = workingWindows.map((item) => coveredWindowIds.includes(item.id)
        ? { ...item, status: '已覆盖' as WindowStatus }
        : item)
    }
    appliedWindowIds.push(windowId)
  })

  const wroteSomething = appliedWindowIds.length > 0 || payloadWindows.length === 0
  if (!wroteSomething) {
    payloadComments.forEach((comment) => diffs.push({
      kind: '条款随批次留存',
      windowLabel: comment.anchor,
      message: `批次被独占规则整体驳回，条款意见「${comment.content.slice(0, 24)}…」未写入，随批次保留。`,
    }))
    return withBatch(prev, seq, { ...baseBatch, status: '独占驳回', diffs }, {
      revisions: prev.revisions,
      windows: prev.windows,
      comments: prev.comments,
    })
  }

  // 重算本次写入窗口的冲突状态
  const conflictIds = new Set(findConflicts(workingWindows).flatMap((issue) => issue.windowIds))
  workingWindows = workingWindows.map((item) => appliedWindowIds.includes(item.id)
    ? { ...item, status: conflictIds.has(item.id) ? '冲突' : '已确认' }
    : item)

  const newRevision = latestRevision + 1
  let workingComments = [...prev.comments]
  payloadComments.forEach((payload) => {
    workingComments = [...workingComments, {
      id: nextCommentId(workingComments),
      channel: payload.channel,
      anchor: payload.anchor,
      author: payload.author,
      role: payload.role,
      content: payload.content,
      resolved: false,
      withheld: false,
      batchId: id,
      revision: newRevision,
    }]
  })

  const revisions = { ...prev.revisions, [parent]: newRevision }
  const committed: ChangeBatch = { ...baseBatch, status: '生效', appliedWindowIds, coveredWindowIds, diffs, committedRevision: newRevision }
  return withBatch(prev, seq, committed, { revisions, windows: workingWindows, comments: workingComments })
}

export function commitBatch(prev: BatchState, input: CommitBatchInput): CommitResult {
  return runCommit(prev, input)
}

/** 写入失败后按批次号恢复；恢复时若修订号已被其他批次推进，则作为后到批次留下差异 */
export function recoverBatch(prev: BatchState, batchId: string, simulateWriteFailure = false): CommitResult | undefined {
  const failed = prev.batches.find((item) => item.id === batchId && item.status === '写入失败')
  if (!failed) return undefined
  return runCommit(
    prev,
    {
      parentTerritory: failed.parentTerritory ?? '东南亚区域',
      windows: failed.windows,
      comments: failed.comments,
      summary: failed.summary,
      baseRevision: failed.baseRevision,
      simulateWriteFailure,
      failReason: simulateWriteFailure ? '存储写入失败（重试仍未成功），批次继续留存待恢复。' : undefined,
    },
    { id: failed.id, seq: failed.seq, submittedAt: failed.submittedAt, attempts: failed.attempts },
  )
}

/** 后到批次按母地区最新修订号重新提交（保持原批次号，差异随重试结果刷新） */
export function rebaseBatch(prev: BatchState, batchId: string, simulateWriteFailure = false): CommitResult | undefined {
  const stale = prev.batches.find((item) => item.id === batchId && (item.status === '后到差异' || item.status === '独占驳回'))
  if (!stale) return undefined
  const parent = stale.parentTerritory ?? '东南亚区域'
  return runCommit(
    prev,
    {
      parentTerritory: parent,
      windows: stale.windows,
      comments: stale.comments,
      summary: stale.summary,
      baseRevision: prev.revisions[parent] ?? 0,
      simulateWriteFailure,
      failReason: simulateWriteFailure ? '存储写入失败，批次转为留存待恢复。' : undefined,
    },
    { id: stale.id, seq: stale.seq, submittedAt: stale.submittedAt, attempts: stale.attempts },
  )
}
