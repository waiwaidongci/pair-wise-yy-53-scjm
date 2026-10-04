'use client'

import { useMemo, useState } from 'react'
import { Box, Flex, Grid, Heading, Text, Badge, Button, Input, Select, Checkbox, Table, Thead, Tbody, Tr, Th, Td, useToast, HStack } from '@chakra-ui/react'
import { useRightsStore, useConflicts } from '@/store/rights'
import { BatchConsole } from '@/components/BatchConsole'
import type { Territory } from '@/lib/types'
import { leavesOf, parentOf, parentTerritories } from '@/lib/territory'

export default function WindowsPage() {
  const windows = useRightsStore((state) => state.windows)
  const revisions = useRightsStore((state) => state.revisions)
  const updateWindow = useRightsStore((state) => state.updateWindow)
  const batchShift = useRightsStore((state) => state.batchShift)
  const submitBatch = useRightsStore((state) => state.submitBatch)
  const selectedWindowId = useRightsStore((state) => state.selectedWindowId)
  const selectWindow = useRightsStore((state) => state.selectWindow)
  const selectedTerritory = useRightsStore((state) => state.selectedTerritory)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [shiftDays, setShiftDays] = useState(7)
  const [saveComment, setSaveComment] = useState('')
  const toast = useToast()
  const conflicts = useConflicts()
  const filtered = useMemo(() => {
    if (selectedTerritory === '全部地区') return windows
    const leaves = new Set(leavesOf(selectedTerritory as Territory))
    return windows.filter((item) => item.territory === selectedTerritory || leaves.has(item.territory))
  }, [windows, selectedTerritory])
  const selected = windows.find((item) => item.id === selectedWindowId)

  // 保存 = 作品/授权窗口/条款意见进入同一变更批次，绑定母地区最新修订号
  function validateAndSave() {
    if (!selected) return
    if (new Date(selected.end) < new Date(selected.start)) return toast({ title: '窗口无效', description: '结束日期不能早于开始日期。', status: 'error' })
    const collision = conflicts.find((issue) => issue.windowIds.includes(selected.id))
    const batch = submitBatch({
      parentTerritory: parentOf(selected.territory),
      windows: [{
        id: selected.id,
        workId: selected.workId,
        work: selected.work,
        channel: selected.channel,
        rights: selected.rights,
        territory: selected.territory,
        start: selected.start,
        end: selected.end,
        exclusive: selected.exclusive,
        sublicense: selected.sublicense,
        priority: selected.priority,
      }],
      comments: saveComment.trim() ? [{
        channel: selected.channel,
        anchor: `${selected.id} · ${selected.rights}${selected.exclusive ? '独占' : '普通'}窗口确认`,
        author: '当前用户',
        role: '发行',
        content: saveComment.trim(),
      }] : [],
      summary: `确认 ${selected.work} ${selected.channel} ${selected.territory} 授权窗口（${selected.id}）`,
    })
    if (batch.status === '生效') {
      toast({
        title: collision ? `批次 ${batch.id} 已写入，仍存在冲突` : `批次 ${batch.id} 已确认`,
        description: `母地区修订号 R${batch.baseRevision} → R${batch.committedRevision}${collision ? `；${collision.explanation}` : '，授权窗口与条款意见同批提交。'}`,
        status: collision ? 'warning' : 'success',
      })
      setSaveComment('')
    } else {
      toast({ title: `批次 ${batch.id}：${batch.status}`, description: batch.diffs[0]?.message, status: 'error' })
    }
  }

  return (
    <Box>
      <Flex justify="space-between" mb={5} gap={4} direction={{ base: 'column', md: 'row' }}><Box><Text color="brand.600" fontSize="xs" fontWeight="bold">TIME × TERRITORY</Text><Heading fontSize="3xl" my={1}>授权窗口与地区矩阵</Heading><Text color="gray.600">按母地区组联动筛选（新加坡 / 马来西亚 / 东南亚区域同组归并），批量调整后即时重算独占、重叠与倒挂冲突。</Text></Box><Flex gap={2}><Select maxW="180px" value={selectedTerritory} onChange={(event) => useRightsStore.setState({ selectedTerritory: event.target.value })}><option value="全部地区">全部地区</option>{parentTerritories.map((parent) => leavesOf(parent).length > 1 ? <optgroup key={parent} label={`母地区 · ${parent}`}>{leavesOf(parent).map((territory) => <option key={territory} value={territory}>{territory}</option>)}</optgroup> : <option key={parent} value={parent}>{parent}</option>)}</Select><Button colorScheme="blue" onClick={validateAndSave}>校验并按批次保存</Button></Flex></Flex>
      <Grid templateColumns={{ base: '1fr', xl: 'minmax(0,1.1fr) minmax(360px,.8fr)' }} gap={4}>
        <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" overflow="hidden">
          <Flex p={4} justify="space-between" align="center"><Heading size="md">授权窗口清单</Heading><HStack><Select size="sm" w="110px" value={shiftDays} onChange={(event) => setShiftDays(Number(event.target.value))}><option value={7}>+7 天</option><option value={14}>+14 天</option><option value={-7}>-7 天</option><option value={-14}>-14 天</option></Select><Button size="sm" onClick={() => { if (!selectedIds.length) return toast({ title: '请选择窗口', status: 'warning' }); batchShift(selectedIds, shiftDays) }}>批量调窗</Button></HStack></Flex>
          <Table size="sm"><Thead><Tr><Th w="36px"></Th><Th>作品 / 渠道</Th><Th>地区 / 母地区</Th><Th>开始</Th><Th>结束</Th><Th>独占</Th><Th>批次·修订</Th></Tr></Thead><Tbody>{filtered.map((item) => <Tr key={item.id} bg={selectedWindowId === item.id ? 'blue.50' : undefined} cursor="pointer" onClick={() => selectWindow(item.id)}><Td onClick={(event) => event.stopPropagation()}><Checkbox isChecked={selectedIds.includes(item.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /></Td><Td><Text fontWeight="600">{item.work}</Text><Text color="gray.500" fontSize="xs">{item.channel} · {item.id}</Text></Td><Td><Text>{item.territory}</Text><Text color="gray.500" fontSize="10px">母地区 {parentOf(item.territory)}</Text></Td><Td>{item.start}</Td><Td>{item.end}</Td><Td><Badge colorScheme={item.exclusive ? 'purple' : 'gray'}>{item.exclusive ? '独占' : '普通'}</Badge></Td><Td><Text fontSize="10px">{item.batchId ?? '—'} · R{item.revision ?? 0}</Text></Td></Tr>)}</Tbody></Table>
        </Box>
        <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={5}>
          <Heading size="md" mb={1}>窗口条款</Heading><Text color="gray.500" fontSize="sm" mb={1}>{selected?.id ?? '请选择窗口'}{selected && ` · 母地区 ${parentOf(selected.territory)} 当前 R${revisions[parentOf(selected.territory)] ?? 0}（窗口写入于 ${selected.batchId ?? '—'} R${selected.revision ?? 0}）`}</Text>
          {selected && <Grid templateColumns="1fr 1fr" gap={4}>
            <Box gridColumn="span 2"><Text fontSize="sm" mb={1}>渠道</Text><Input value={selected.channel} onChange={(event) => updateWindow(selected.id, { channel: event.target.value })} /></Box>
            <Box><Text fontSize="sm" mb={1}>开始日期</Text><Input type="date" value={selected.start} onChange={(event) => updateWindow(selected.id, { start: event.target.value })} /></Box>
            <Box><Text fontSize="sm" mb={1}>结束日期</Text><Input type="date" value={selected.end} onChange={(event) => updateWindow(selected.id, { end: event.target.value })} /></Box>
            <Box><Text fontSize="sm" mb={1}>优先顺序</Text><Input type="number" value={selected.priority} onChange={(event) => updateWindow(selected.id, { priority: Number(event.target.value) })} /></Box>
            <Box><Text fontSize="sm" mb={1}>地区</Text><Select value={selected.territory} onChange={(event) => updateWindow(selected.id, { territory: event.target.value as Territory })}>{parentTerritories.flatMap((parent) => leavesOf(parent)).map((territory) => <option key={territory}>{territory}</option>)}</Select></Box>
            <Checkbox isChecked={selected.exclusive} onChange={(event) => updateWindow(selected.id, { exclusive: event.target.checked })}>独占窗口</Checkbox><Checkbox isChecked={selected.sublicense} onChange={(event) => updateWindow(selected.id, { sublicense: event.target.checked })}>允许次级授权</Checkbox>
            <Box gridColumn="span 2"><Text fontSize="sm" mb={1}>条款意见（随保存批次一并提交）</Text><Input value={saveComment} placeholder="留空表示不新增条款意见；旧稿已确认的意见已随首批迁移" onChange={(event) => setSaveComment(event.target.value)} /></Box>
          </Grid>}
          {selected && conflicts.filter((issue) => issue.windowIds.includes(selected.id)).map((issue) => <Box key={issue.id} mt={4} p={3} bg={issue.severity === '高' ? 'red.50' : 'orange.50'} borderLeft="3px solid" borderLeftColor={issue.severity === '高' ? 'red.500' : 'orange.400'}><Text fontWeight="700" fontSize="sm">{issue.type}</Text><Text fontSize="sm" color="gray.600" mt={1}>{issue.explanation}</Text></Box>)}
          <Button w="100%" mt={5} colorScheme="blue" onClick={validateAndSave}>保存并重新校验（同批次提交）</Button>
        </Box>
      </Grid>
      <BatchConsole />
    </Box>
  )
}
