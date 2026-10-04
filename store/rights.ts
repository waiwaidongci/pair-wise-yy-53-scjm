import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChangeBatch, LicenseWindow, RightsComment, Work } from '@/lib/types'
import { initialComments, initialWindows, initialWorks } from '@/lib/mock-data'
import { findConflicts, shiftWindow } from '@/lib/rules'
import { migrateLegacy, recoverBatch, submitBatch } from '@/lib/batches'

// 旧稿没有修订号，迁移到首批（每个作品一个首批，绑定母地区当前最新修订号）。
const migrated = migrateLegacy(initialWorks, initialWindows, initialComments, '2026-10-04T09:00:00.000Z')

interface SubmitBatchInput {
  workId: string
  payloadWindows: LicenseWindow[]
  payloadComments: RightsComment[]
  simulateFailure?: boolean
}

interface RightsState {
  works: Work[]
  windows: LicenseWindow[]
  comments: RightsComment[]
  batches: ChangeBatch[]
  selectedWindowId: string
  selectedTerritory: string
  version: number
  updateWindow: (id: string, patch: Partial<LicenseWindow>) => void
  batchShift: (ids: string[], days: number) => void
  acceptComment: (id: string) => void
  selectWindow: (id: string) => void
  submitBatch: (input: SubmitBatchInput) => void
  recoverBatch: (batchId: string) => void
  reset: () => void
}

export const useRightsStore = create<RightsState>()(
  persist(
    (set) => ({
      works: migrated.works,
      windows: migrated.windows,
      comments: migrated.comments,
      batches: migrated.batches,
      selectedWindowId: 'RW-102',
      selectedTerritory: '全部地区',
      version: 18,
      updateWindow: (id, patch) => set((state) => ({ windows: state.windows.map((item) => item.id === id ? { ...item, ...patch, status: '草案' } : item), version: state.version + 1 })),
      batchShift: (ids, days) => set((state) => ({ windows: state.windows.map((item) => ids.includes(item.id) ? shiftWindow(item, days) : item), version: state.version + 1 })),
      acceptComment: (id) => set((state) => ({ comments: state.comments.map((item) => item.id === id ? { ...item, resolved: true } : item), version: state.version + 1 })),
      selectWindow: (id) => set({ selectedWindowId: id }),
      submitBatch: (input) => set((state) => {
        const result = submitBatch(state.works, state.windows, state.comments, state.batches, { ...input, now: new Date().toISOString() })
        return { works: result.works, windows: result.windows, comments: result.comments, batches: result.batches, version: state.version + 1 }
      }),
      recoverBatch: (batchId) => set((state) => {
        const result = recoverBatch(state.works, state.windows, state.comments, state.batches, batchId, new Date().toISOString())
        return { works: result.works, windows: result.windows, comments: result.comments, batches: result.batches, version: state.version + 1 }
      }),
      reset: () => set({ works: migrated.works, windows: migrated.windows, comments: migrated.comments, batches: migrated.batches, version: 18 }),
    }),
    { name: 'yy53-rights-draft-v2', version: 2 },
  ),
)

export function useConflicts() {
  const windows = useRightsStore((state) => state.windows)
  const batches = useRightsStore((state) => state.batches)
  // 只对已生效（批次生效且未被后到独占覆盖）的窗口检测冲突。
  const effective = windows.filter((w) => {
    if (!w.batchId) return true
    const batch = batches.find((b) => b.id === w.batchId)
    return !!batch?.effective && !w.supersededBy
  })
  return findConflicts(effective)
}
