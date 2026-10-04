export type RightsType = '院线' | '电视' | '流媒体' | '航空' | '非院线'
export type Territory = '中国大陆' | '中国香港' | '中国台湾' | '新加坡' | '马来西亚' | '东南亚区域' | '北美'

/** 母地区层级：新加坡、马来西亚同属「东南亚区域」。用于跨地区重叠判定。 */
export const REGION_PARENT: Partial<Record<Territory, Territory>> = {
  新加坡: '东南亚区域',
  马来西亚: '东南亚区域',
}

/** 返回地区所属母地区；母地区自身映射到自身。 */
export function parentRegionOf(territory: Territory): Territory {
  return REGION_PARENT[territory] ?? territory
}

/**
 * 两个地区是否在同一授权范围内重叠：
 * 名称相等、或互为母子地区、或同属一个母地区，都视为重叠。
 * 例如 新加坡 与 马来西亚 名称不同，但同属「东南亚区域」，其独占窗口重叠。
 */
export function regionsOverlap(a: Territory, b: Territory): boolean {
  if (a === b) return true
  return parentRegionOf(a) === parentRegionOf(b)
}

/** 作品：归属一个母地区，并记录该母地区的最新修订号。 */
export interface Work {
  id: string
  name: string
  parentRegion: Territory
  latestRevision: number
}

export interface LicenseWindow {
  id: string
  workId: string
  work: string
  channel: string
  rights: RightsType
  territory: Territory
  start: string
  end: string
  exclusive: boolean
  sublicense: boolean
  priority: number
  status: '草案' | '冲突' | '已确认'
  /** 所属变更批次；旧稿迁移前为空。 */
  batchId?: string
  /** 写入时绑定的母地区修订号；旧稿无修订号，迁移到首批。 */
  revision?: number
  /** 被后到独占窗口覆盖时记录覆盖批次号。 */
  supersededBy?: string
}

export interface RightsComment {
  id: string
  channel: string
  anchor: string
  author: string
  role: string
  content: string
  resolved: boolean
  /** 所属变更批次；旧稿迁移前为空。 */
  batchId?: string
  /** 写入时绑定的母地区修订号。 */
  revision?: number
}

export interface DraftVersion {
  id: string
  author: string
  time: string
  summary: string
  changes: string[]
}

/** 批次状态：已生效 / 写入失败 / 已恢复 / 差异（部分生效，被先到批次覆盖的部分留差异）。 */
export type BatchStatus = '已生效' | '写入失败' | '已恢复' | '差异'

export type DiffReason = '独占被先到批次覆盖' | '修订号落后' | '独占高于普通授权' | '同渠道同语言同区域例外'

export interface BatchDiff {
  targetId: string
  targetType: 'window' | 'comment'
  reason: DiffReason
  detail: string
}

/** 变更批次：把作品、授权窗口、条款意见接进同一次提交，绑定母地区最新修订号。 */
export interface ChangeBatch {
  /** 批次号，用于写入失败后按批次号恢复。 */
  id: string
  /** 到达时间，决定同一独占的先到顺序。 */
  createdAt: string
  /** 作用域作品（一个批次对应一个作品）。 */
  workId: string
  /** 母地区（取自作品）。 */
  parentRegion: Territory
  /** 提交时绑定的母地区最新修订号。 */
  baseRevision: number
  windowIds: string[]
  commentIds: string[]
  status: BatchStatus
  failureReason?: string
  /** 后到批次留下的差异。 */
  diffs: BatchDiff[]
  /** 是否实际生效（先到批次生效；被覆盖的批次不生效）。 */
  effective: boolean
  /** 失败待恢复时保存的载荷，按批次号恢复时重算。 */
  payloadWindows?: LicenseWindow[]
  payloadComments?: RightsComment[]
  recoveredAt?: string
}
