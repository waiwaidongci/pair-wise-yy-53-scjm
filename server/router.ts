import { initTRPC } from '@trpc/server'
import { z } from 'zod'
import { initialComments, initialWindows } from '@/lib/mock-data'
import { findConflicts } from '@/lib/rules'
import { migrateLegacy } from '@/lib/batch'
import { leavesOf, parentOf, parentTerritories } from '@/lib/territory'

const t = initTRPC.create()
const windowInput = z.object({
  channel: z.string().min(2),
  workId: z.string().optional(),
  territory: z.enum(['中国大陆', '中国香港', '中国台湾', '新加坡', '马来西亚', '东南亚区域', '北美']).optional(),
  start: z.string().date(),
  end: z.string().date(),
  exclusive: z.boolean(),
})

// 服务端同样基于迁移后的首批数据做母地区归并核验
const migrated = migrateLegacy(initialWindows, initialComments).state

export const appRouter = t.router({
  catalog: t.procedure.query(() => ({
    works: [
      { id: 'W-001', title: '《远山回声》' },
      { id: 'W-002', title: '《深港口岸》' },
    ],
    channels: ['星海影院', '云帆视频', '南华卫视', '海岛航空', '环球新媒体', '星马传媒'],
  })),
  territoryGroups: t.procedure.query(() => parentTerritories.map((parent) => ({
    parent,
    leaves: leavesOf(parent),
    revision: migrated.revisions[parent] ?? 0,
  }))),
  windows: t.procedure.query(() => migrated.windows),
  conflicts: t.procedure.query(() => findConflicts(migrated.windows)),
  validateWindow: t.procedure.input(windowInput).mutation(({ input }) => {
    if (new Date(input.end) < new Date(input.start)) return { valid: false, message: '窗口结束日期不能早于开始日期。' }
    // 按母地区归并：同渠道在新加坡/马来西亚/东南亚区域之间的重叠也算碰撞
    const collision = migrated.windows.find((item) =>
      item.channel === input.channel
      && (!input.territory || parentOf(item.territory) === parentOf(input.territory))
      && input.start <= item.end && item.start <= input.end)
    return collision
      ? { valid: false, message: `与现有窗口 ${collision.id}（${collision.territory}，母地区 ${parentOf(collision.territory)}）重叠，请调整窗口或明确优先级。` }
      : { valid: true, message: '窗口结构校验通过。' }
  }),
  comments: t.procedure.query(() => migrated.comments),
})

export type AppRouter = typeof appRouter
