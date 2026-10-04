import type { Territory } from './types'

// 国际发行把“东南亚”拆成了新加坡、马来西亚两个提交地区组，
// 历史稿件里还存在“东南亚区域”整体授权。冲突判断必须按母地区归并，
// 不能再只按地区名称相等（旧逻辑：a.territory !== b.territory）。

/** 叶子提交地区 -> 母地区组 */
const parentTerritory: Record<Territory, Territory> = {
  中国大陆: '中国大陆',
  中国香港: '中国香港',
  中国台湾: '中国台湾',
  新加坡: '东南亚区域',
  马来西亚: '东南亚区域',
  东南亚区域: '东南亚区域',
  北美: '北美',
}

/** 母地区组 -> 其下可提交的叶子地区（用于矩阵与提交表单） */
export const territoryGroups: Partial<Record<Territory, Territory[]>> = {
  中国大陆: ['中国大陆'],
  中国香港: ['中国香港'],
  中国台湾: ['中国台湾'],
  东南亚区域: ['新加坡', '马来西亚', '东南亚区域'],
  北美: ['北美'],
}

/** 全部母地区组（去重保序） */
export const parentTerritories = Array.from(new Set(Object.values(parentTerritory))) as Territory[]

export function parentOf(territory: Territory): Territory {
  return parentTerritory[territory] ?? territory
}

/**
 * 同一作品的两个授权地区是否共享母地区授权范围。
 * 新加坡 / 马来西亚 / 东南亚区域 三者互相覆盖；其余地区独立。
 */
export function territoriesOverlap(a: Territory, b: Territory): boolean {
  return parentOf(a) === parentOf(b)
}

export function leavesOf(parent: Territory): Territory[] {
  return territoryGroups[parent] ?? [parent]
}

export function isParentTerritory(territory: Territory): boolean {
  return parentOf(territory) === territory
}
