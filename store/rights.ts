import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LicenseWindow, RightsComment, Territory } from '@/lib/types'
import { initialComments, initialWindows } from '@/lib/mock-data'
import { findConflicts, shiftWindow } from '@/lib/rules'
import {
  commitBatch,
  migrateLegacy,
  rebaseBatch,
  recoverBatch,
  type BatchCommentPayload,
  type BatchState,
  type BatchWindowPayload,
  type ChangeBatch,
  type CommitBatchInput,
} from '@/lib/batch'
import { parentOf } from '@/lib/territory'

const buildInitial = (): BatchState => {
  const migrated = migrateLegacy(initialWindows, initialComments)
  return { ...migrated.state, revisions: migrated.state.revisions, seq: migrated.state.seq }
}

interface SubmitInput {
  parentTerritory: Territory
  windows?: BatchWindowPayload[]
  comments?: BatchCommentPayload[]
  summary?: string
  baseRevision?: number
  simulateWriteFailure?: boolean
  failReason?: string
}

interface SubmitSimultaneousInput {
  /** 按到达顺序排列（先到先得），各自预绑定当前修订号 */
  submissions: { parentTerritory: Territory; windows?: BatchWindowPayload[]; comments?: BatchCommentPayload[]; summary?: string }[]
}

interface RightsState extends BatchState {
  selectedWindowId: string
  selectedTerritory: string
  version: number
  updateWindow: (id: string, patch: Partial<LicenseWindow>) => void
  batchShift: (ids: string[], days: number) => void
  acceptComment: (id: string) => void
  submitComment: (payload: BatchCommentPayload, anchorWindowId?: string) => ChangeBatch
  selectWindow: (id: string) => void
  /** 单个变更批次提交（作品/授权窗口/条款意见同批次原子写入） */
  submitBatch: (input: SubmitInput) => ChangeBatch
  /** 两个地区组同时提交：预绑定同一修订号后按到达顺序逐批生效 */
  submitSimultaneous: (input: SubmitSimultaneousInput) => ChangeBatch[]
  /** 写入失败后按批次号恢复 */
  recover: (batchId: string, simulateWriteFailure?: boolean) => ChangeBatch | undefined
  /** 后到批次按最新修订号重新提交 */
  rebase: (batchId: string, simulateWriteFailure?: boolean) => ChangeBatch | undefined
  reset: () => void
}

const applyResult = (state: RightsState, result: { state: BatchState; batch: ChangeBatch }) => ({
  ...result.state,
  selectedWindowId: state.selectedWindowId,
  selectedTerritory: state.selectedTerritory,
  version: result.batch.status === '生效' ? state.version + 1 : state.version,
})

export const useRightsStore = create<RightsState>()(
  persist(
    (set, get) => ({
      ...buildInitial(),
      selectedWindowId: 'RW-102',
      selectedTerritory: '全部地区',
      version: 18,
      // 仅编辑草案内容，不直接落库确认；保存必须走 submitBatch 绑定修订号
      updateWindow: (id, patch) => set((state) => ({ windows: state.windows.map((item) => item.id === id ? { ...item, ...patch, status: '草案' } : item) })),
      batchShift: (ids, days) => set((state) => ({ windows: state.windows.map((item) => ids.includes(item.id) ? shiftWindow(item, days) : item), version: state.version + 1 })),
      acceptComment: (id) => set((state) => ({ comments: state.comments.map((item) => item.id === id ? { ...item, resolved: true } : item) })),
      submitComment: (payload, anchorWindowId) => {
        const state = get()
        const anchored = state.windows.find((item) => item.id === anchorWindowId)
          ?? state.windows.find((item) => item.id === payload.anchor.match(/(RW-\d+)/)?.[1])
        const parent = anchored ? parentOf(anchored.territory) : '东南亚区域'
        const result = commitBatch(state, { parentTerritory: parent, windows: [], comments: [payload], summary: '条款意见单提（随变更批次绑定修订号）' })
        set(applyResult(get(), result))
        return result.batch
      },
      selectWindow: (id) => set({ selectedWindowId: id }),
      submitBatch: (input) => {
        const result = commitBatch(get(), input as CommitBatchInput)
        set(applyResult(get(), result))
        return result.batch
      },
      submitSimultaneous: ({ submissions }) => {
        const batches: ChangeBatch[] = []
        // 同时提交：在写入前为每个母地区快照当前最新修订号，两批绑定同一修订号；
        // 随后严格按到达顺序写入，先到批次推进修订号，后到批次留下差异（同一独占先到先得）。
        const revisionSnapshot = { ...get().revisions }
        submissions.forEach((submission) => {
          const result = commitBatch(get(), {
            parentTerritory: submission.parentTerritory,
            windows: submission.windows,
            comments: submission.comments,
            summary: submission.summary,
            baseRevision: revisionSnapshot[submission.parentTerritory] ?? 0,
          })
          set(applyResult(get(), result))
          batches.push(result.batch)
        })
        return batches
      },
      recover: (batchId, simulateWriteFailure) => {
        const result = recoverBatch(get(), batchId, simulateWriteFailure)
        if (!result) return undefined
        set(applyResult(get(), result))
        return result.batch
      },
      rebase: (batchId, simulateWriteFailure) => {
        const result = rebaseBatch(get(), batchId, simulateWriteFailure)
        if (!result) return undefined
        set(applyResult(get(), result))
        return result.batch
      },
      reset: () => set((state) => ({ ...buildInitial(), selectedWindowId: state.selectedWindowId, selectedTerritory: state.selectedTerritory, version: 18 })),
    }),
    {
      name: 'yy53-rights-draft-v1',
      version: 2,
      // 旧稿（v1 及更早）没有修订号：迁移到首批 B-001，母地区修订号补齐为 1
      migrate: (persisted: unknown, version: number): Partial<RightsState> => {
        const data = (persisted ?? {}) as Partial<BatchState> & Partial<Pick<RightsState, 'selectedWindowId' | 'selectedTerritory' | 'version'>>
        if (version < 2) {
          const windows = data.windows ?? initialWindows
          const comments = data.comments ?? initialComments
          const migrated = migrateLegacy(windows, comments)
          return {
            ...migrated.state,
            selectedWindowId: data.selectedWindowId ?? 'RW-102',
            selectedTerritory: data.selectedTerritory ?? '全部地区',
            version: data.version ?? 18,
          }
        }
        return data as Partial<RightsState>
      },
      merge: (persisted, current) => {
        const data = persisted as Partial<RightsState>
        if (!data || !('revisions' in data) || !('batches' in data)) {
          return { ...current } as RightsState
        }
        return { ...current, ...data } as RightsState
      },
    },
  ),
)

export function useConflicts() {
  const windows = useRightsStore((state) => state.windows)
  return findConflicts(windows)
}

export type { LicenseWindow, RightsComment }
