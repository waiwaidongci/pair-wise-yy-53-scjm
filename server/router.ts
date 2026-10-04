import { initTRPC } from '@trpc/server'
import { z } from 'zod'
import { initialComments, initialWindows, initialWorks } from '@/lib/mock-data'
import { findConflicts } from '@/lib/rules'
import { migrateLegacy, recoverBatch, submitBatch } from '@/lib/batches'
import type { ChangeBatch, LicenseWindow, RightsComment, Work } from '@/lib/types'

const t = initTRPC.create()

// 服务端内存态：启动时把旧稿迁移到首批（绑定母地区最新修订号）。
const migrated = migrateLegacy(initialWorks, initialWindows, initialComments, '2026-10-04T09:00:00.000Z')
let works: Work[] = migrated.works
let windows: LicenseWindow[] = migrated.windows
let comments: RightsComment[] = migrated.comments
let batches: ChangeBatch[] = migrated.batches

const windowInput = z.object({
  channel: z.string().min(2),
  start: z.string().date(),
  end: z.string().date(),
  exclusive: z.boolean(),
})

const payloadWindowInput = z.object({
  id: z.string(),
  workId: z.string(),
  work: z.string(),
  channel: z.string().min(2),
  rights: z.enum(['院线', '电视', '流媒体', '航空', '非院线']),
  territory: z.enum(['中国大陆', '中国香港', '中国台湾', '新加坡', '马来西亚', '东南亚区域', '北美']),
  start: z.string().date(),
  end: z.string().date(),
  exclusive: z.boolean(),
  sublicense: z.boolean(),
  priority: z.number(),
  status: z.enum(['草案', '冲突', '已确认']),
})

const payloadCommentInput = z.object({
  id: z.string(),
  channel: z.string(),
  anchor: z.string(),
  author: z.string(),
  role: z.string(),
  content: z.string(),
  resolved: z.boolean(),
})

export const appRouter = t.router({
  catalog: t.procedure.query(() => ({ works: ['W-001', 'W-002'], channels: ['星海影院', '云帆视频', '南华卫视', '海岛航空', '环球新媒体'] })),
  works: t.procedure.query(() => works),
  windows: t.procedure.query(() => windows),
  comments: t.procedure.query(() => comments),
  batches: t.procedure.query(() => batches),
  conflicts: t.procedure.query(() => findConflicts(windows.filter((w) => {
    if (!w.batchId) return true
    const batch = batches.find((b) => b.id === w.batchId)
    return !!batch?.effective && !w.supersededBy
  }))),
  validateWindow: t.procedure.input(windowInput).mutation(({ input }) => {
    if (new Date(input.end) < new Date(input.start)) return { valid: false, message: '窗口结束日期不能早于开始日期。' }
    const collision = windows.find((item) => item.channel === input.channel && input.start <= item.end && item.start <= input.end)
    return collision ? { valid: false, message: `与现有窗口 ${collision.id} 重叠，请调整窗口或明确优先级。` } : { valid: true, message: '窗口结构校验通过。' }
  }),
  // 提交变更批次：绑定母地区最新修订号，独占高于普通授权，同一独占按先到批次生效。
  submitBatch: t.procedure.input(z.object({
    workId: z.string(),
    payloadWindows: z.array(payloadWindowInput),
    payloadComments: z.array(payloadCommentInput),
    simulateFailure: z.boolean().optional(),
  })).mutation(({ input }) => {
    const result = submitBatch(works, windows, comments, batches, { ...input, now: new Date().toISOString() })
    works = result.works
    windows = result.windows
    comments = result.comments
    batches = result.batches
    return { batch: result.batch, works, windows, comments, batches }
  }),
  // 写入失败后按批次号恢复：重算生效状态，后到批次留下差异。
  recoverBatch: t.procedure.input(z.object({ batchId: z.string() })).mutation(({ input }) => {
    const result = recoverBatch(works, windows, comments, batches, input.batchId, new Date().toISOString())
    works = result.works
    windows = result.windows
    comments = result.comments
    batches = result.batches
    return { batch: result.batch, works, windows, comments, batches }
  }),
})

export type AppRouter = typeof appRouter
