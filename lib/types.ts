export type RightsType = '院线' | '电视' | '流媒体' | '航空' | '非院线'
export type Territory = '中国大陆' | '中国香港' | '中国台湾' | '新加坡' | '马来西亚' | '东南亚区域' | '北美'

export type WindowStatus = '草案' | '冲突' | '已确认' | '已覆盖'

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
  status: WindowStatus
  /** 授权窗口随哪个变更批次写入（首批迁移为 MIGRATION_BATCH_ID） */
  batchId?: string
  /** 写入时母地区组的修订号；旧稿没有修订号，迁移后补齐为首批修订号 */
  revision?: number
}

export interface RightsComment {
  id: string
  channel: string
  anchor: string
  author: string
  role: string
  content: string
  resolved: boolean
  /** 条款意见必须与作品/授权窗口同一变更批次提交 */
  batchId?: string
  /** 后到批次因修订号落后而未写入时，条款意见随差异一并保留 */
  withheld?: boolean
  revision?: number
}

export interface DraftVersion {
  id: string
  author: string
  time: string
  summary: string
  changes: string[]
}
