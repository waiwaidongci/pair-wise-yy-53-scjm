import type { BatchDiff, BatchStatus, ChangeBatch, DiffReason, LicenseWindow, RightsComment, Territory, Work } from './types'
import { regionsOverlap } from './types'

/** 判断窗口是否属于某个已生效批次且未被后到独占覆盖。 */
export function isWindowEffective(win: LicenseWindow, batches: ChangeBatch[]): boolean {
  if (!win.batchId) return false
  const batch = batches.find((b) => b.id === win.batchId)
  if (!batch || !batch.effective) return false
  if (win.supersededBy) return false
  return true
}

/** 取某作品当前已生效的窗口（未被覆盖）。 */
export function effectiveWindowsOf(workId: string, windows: LicenseWindow[], batches: ChangeBatch[]): LicenseWindow[] {
  return windows.filter((w) => w.workId === workId && isWindowEffective(w, batches))
}

function nextBatchId(batches: ChangeBatch[]): string {
  let max = 0
  for (const b of batches) {
    const match = /^B-(\d+)$/.exec(b.id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `B-${String(max + 1).padStart(3, '0')}`
}

function timeOverlap(a: LicenseWindow, b: LicenseWindow): boolean {
  return new Date(a.start) <= new Date(b.end) && new Date(b.start) <= new Date(a.end)
}

/**
 * 解析一个待写入窗口与「已生效窗口 + 同批次先到窗口」的独占关系。
 * 返回是否被覆盖（不生效）、覆盖原因，以及本窗口生效时可覆盖的普通授权窗口 id。
 */
function resolveOne(
  w: LicenseWindow,
  effective: LicenseWindow[],
  earlierInBatch: LicenseWindow[],
): { superseded: boolean; reason?: DiffReason; supersededIds: string[] } {
  const candidates = [...effective, ...earlierInBatch]
  // 第一轮：判断本窗口是否被任一已生效 / 先到独占窗口覆盖。
  for (const c of candidates) {
    if (c.workId !== w.workId) continue
    if (!regionsOverlap(c.territory, w.territory)) continue
    if (!timeOverlap(c, w)) continue
    if (c.exclusive) {
      // 候选为独占：同一独占按先到批次生效；独占高于普通授权。
      return {
        superseded: true,
        reason: w.exclusive ? '独占被先到批次覆盖' : '独占高于普通授权',
        supersededIds: [],
      }
    }
  }
  // 第二轮：本窗口生效；若本窗口为独占，覆盖重叠的普通授权窗口。
  const supersededIds: string[] = []
  if (w.exclusive) {
    for (const c of candidates) {
      if (c.workId !== w.workId) continue
      if (!regionsOverlap(c.territory, w.territory)) continue
      if (!timeOverlap(c, w)) continue
      if (!c.exclusive) supersededIds.push(c.id)
    }
  }
  return { superseded: false, supersededIds }
}

export interface BatchInput {
  workId: string
  payloadWindows: LicenseWindow[]
  payloadComments: RightsComment[]
  now: string
  /** 模拟写入失败：绑定修订号后提交中断，可按批次号恢复。 */
  simulateFailure?: boolean
}

export interface BatchResult {
  works: Work[]
  windows: LicenseWindow[]
  comments: RightsComment[]
  batches: ChangeBatch[]
  batch: ChangeBatch
}

/**
 * 旧稿没有修订号，迁移到首批：每个作品的历史窗口与条款意见并入该作品的首个批次，
 * 绑定母地区当前最新修订号，状态置为已生效。
 */
export function migrateLegacy(
  works: Work[],
  windows: LicenseWindow[],
  comments: RightsComment[],
  now: string,
): BatchResult {
  const batches: ChangeBatch[] = []
  let nextWindows = windows
  let nextComments = comments

  for (const work of works) {
    const legacyWindows = windows.filter((w) => w.workId === work.id && !w.batchId)
    const legacyComments = comments.filter((c) => legacyWindows.some((w) => w.id === c.anchor.split(' · ')[0]) || !c.batchId)
    if (legacyWindows.length === 0 && legacyComments.length === 0) continue
    const batchId = nextBatchId(batches)
    batches.push({
      id: batchId,
      createdAt: now,
      workId: work.id,
      parentRegion: work.parentRegion,
      baseRevision: work.latestRevision,
      windowIds: legacyWindows.map((w) => w.id),
      commentIds: legacyComments.map((c) => c.id),
      status: '已生效',
      diffs: [],
      effective: true,
    })
    nextWindows = nextWindows.map((w) => (legacyWindows.some((lw) => lw.id === w.id) ? { ...w, batchId, revision: work.latestRevision } : w))
    nextComments = nextComments.map((c) => (legacyComments.some((lc) => lc.id === c.id) ? { ...c, batchId, revision: work.latestRevision } : c))
  }

  return { works, windows: nextWindows, comments: nextComments, batches, batch: batches[0]! }
}

/** 提交一个变更批次：绑定母地区最新修订号，独占高于普通授权，同一独占按先到批次生效。 */
export function submitBatch(
  works: Work[],
  windows: LicenseWindow[],
  comments: RightsComment[],
  batches: ChangeBatch[],
  input: BatchInput,
): BatchResult {
  const work = works.find((w) => w.id === input.workId)
  if (!work) throw new Error('作品不存在')
  const batchId = nextBatchId(batches)
  const baseRevision = work.latestRevision
  const effective = effectiveWindowsOf(work.id, windows, batches)

  const appliedWindows: LicenseWindow[] = []
  const supersededCandidateIds: string[] = []
  const diffs: BatchDiff[] = []
  const earlierInBatch: LicenseWindow[] = []

  for (const pw of input.payloadWindows) {
    const { superseded, reason, supersededIds } = resolveOne(pw, effective, earlierInBatch)
    if (superseded) {
      diffs.push({
        targetId: pw.id,
        targetType: 'window',
        reason: reason!,
        detail: `窗口 ${pw.channel}（${pw.territory}）与已生效独占窗口重叠，${reason}，本窗口不生效。`,
      })
      continue
    }
    appliedWindows.push({ ...pw, batchId, revision: baseRevision })
    earlierInBatch.push(pw)
    for (const cid of supersededIds) if (!supersededCandidateIds.includes(cid)) supersededCandidateIds.push(cid)
  }

  // 条款意见并入同一批次（不参与独占覆盖）。
  const appliedComments = input.payloadComments.map((c) => ({ ...c, batchId, revision: baseRevision }))

  const nothingApplied = input.payloadWindows.length > 0 && appliedWindows.length === 0
  let status: BatchStatus
  let batchEffective: boolean
  if (input.simulateFailure || nothingApplied) {
    status = '写入失败'
    batchEffective = false
  } else if (diffs.length > 0) {
    status = '差异'
    batchEffective = true
  } else {
    status = '已生效'
    batchEffective = true
  }

  // 生效且确有写入时，母地区最新修订号 +1。
  let nextWorks = works
  if (batchEffective && appliedWindows.length > 0) {
    nextWorks = works.map((w) => (w.id === work.id ? { ...w, latestRevision: w.latestRevision + 1 } : w))
  }

  // 被后到独占覆盖的普通授权窗口打上标记；生效窗口并入。
  let nextWindows = windows
  if (!input.simulateFailure && !nothingApplied) {
    nextWindows = windows.map((w) => (supersededCandidateIds.includes(w.id) && !w.supersededBy ? { ...w, supersededBy: batchId } : w))
    nextWindows = [...nextWindows, ...appliedWindows]
  }
  const nextComments = [...comments, ...appliedComments]

  const batch: ChangeBatch = {
    id: batchId,
    createdAt: input.now,
    workId: work.id,
    parentRegion: work.parentRegion,
    baseRevision,
    windowIds: input.payloadWindows.map((w) => w.id),
    commentIds: input.payloadComments.map((c) => c.id),
    status,
    failureReason: input.simulateFailure
      ? '模拟写入失败：已绑定母地区最新修订号，提交中断，可按批次号恢复。'
      : nothingApplied
        ? '本批次窗口全部被先到独占覆盖，未写入。'
        : undefined,
    diffs,
    effective: batchEffective,
    payloadWindows: input.payloadWindows,
    payloadComments: input.payloadComments,
  }

  return { works: nextWorks, windows: nextWindows, comments: nextComments, batches: [...batches, batch], batch }
}

/** 写入失败后按批次号恢复：重算当前生效状态，能写入则写入，仍落后则留下差异。 */
export function recoverBatch(
  works: Work[],
  windows: LicenseWindow[],
  comments: RightsComment[],
  batches: ChangeBatch[],
  batchId: string,
  now: string,
): BatchResult {
  const failed = batches.find((b) => b.id === batchId)
  if (!failed) throw new Error('批次不存在')
  if (failed.effective) return { works, windows, comments, batches, batch: failed }
  const work = works.find((w) => w.id === failed.workId)
  if (!work) throw new Error('作品不存在')

  const effective = effectiveWindowsOf(work.id, windows, batches)
  const appliedWindows: LicenseWindow[] = []
  const supersededCandidateIds: string[] = []
  const diffs: BatchDiff[] = []
  const earlierInBatch: LicenseWindow[] = []

  // 恢复时若母地区修订号已推进，说明本批次是后到批次，留下修订号差异。
  const revisionAdvanced = failed.baseRevision < work.latestRevision
  if (revisionAdvanced) {
    diffs.push({
      targetId: failed.id,
      targetType: 'window',
      reason: '修订号落后',
      detail: `批次绑定修订号 v${failed.baseRevision} 已落后于母地区最新 v${work.latestRevision}，按后到批次处理。`,
    })
  }

  for (const pw of failed.payloadWindows ?? []) {
    const { superseded, reason, supersededIds } = resolveOne(pw, effective, earlierInBatch)
    if (superseded) {
      diffs.push({
        targetId: pw.id,
        targetType: 'window',
        reason: reason!,
        detail: `窗口 ${pw.channel}（${pw.territory}）与已生效独占窗口重叠，${reason}，本窗口不生效。`,
      })
      continue
    }
    appliedWindows.push({ ...pw, batchId: failed.id, revision: work.latestRevision })
    earlierInBatch.push(pw)
    for (const cid of supersededIds) if (!supersededCandidateIds.includes(cid)) supersededCandidateIds.push(cid)
  }

  const appliedComments = (failed.payloadComments ?? []).map((c) => ({ ...c, batchId: failed.id, revision: work.latestRevision }))
  const nothingApplied = (failed.payloadWindows?.length ?? 0) > 0 && appliedWindows.length === 0

  let status: BatchStatus
  let batchEffective: boolean
  if (nothingApplied) {
    status = '写入失败'
    batchEffective = false
  } else if (diffs.length > 0) {
    status = '已恢复'
    batchEffective = true
  } else {
    status = '已恢复'
    batchEffective = true
  }

  let nextWorks = works
  if (batchEffective && appliedWindows.length > 0) {
    nextWorks = works.map((w) => (w.id === work.id ? { ...w, latestRevision: w.latestRevision + 1 } : w))
  }

  let nextWindows = windows
  if (!nothingApplied) {
    nextWindows = windows.map((w) => (supersededCandidateIds.includes(w.id) && !w.supersededBy ? { ...w, supersededBy: failed.id } : w))
    nextWindows = [...nextWindows, ...appliedWindows]
  }
  const nextComments = [...comments, ...appliedComments]

  const recovered: ChangeBatch = {
    ...failed,
    status,
    effective: batchEffective,
    failureReason: nothingApplied ? '恢复后仍全部被先到独占覆盖，未写入。' : undefined,
    diffs,
    recoveredAt: now,
  }

  const nextBatches = batches.map((b) => (b.id === failed.id ? recovered : b))
  return { works: nextWorks, windows: nextWindows, comments: nextComments, batches: nextBatches, batch: recovered }
}
