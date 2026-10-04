'use client'

import { Fragment, useMemo, useState } from 'react'
import {
  Badge, Box, Button, Checkbox, Flex, Grid, Heading, HStack, Input, Select, Table, Tbody, Td, Text, Textarea, Th, Thead, Tr, useToast,
} from '@chakra-ui/react'
import { useRightsStore } from '@/store/rights'
import type { RightsType, Territory } from '@/lib/types'
import type { BatchStatus } from '@/lib/batch'
import { leavesOf, parentTerritories } from '@/lib/territory'

const rightsTypes: RightsType[] = ['院线', '电视', '流媒体', '航空', '非院线']

const statusColor: Record<BatchStatus, string> = {
  生效: 'green',
  独占驳回: 'red',
  后到差异: 'orange',
  写入失败: 'purple',
}

const simultaneousDemo = {
  submissions: [
    {
      parentTerritory: '东南亚区域' as Territory,
      summary: '新加坡地区组提交《远山回声》流媒体独占窗口',
      windows: [{
        workId: 'W-001', work: '《远山回声》', channel: '环球新媒体', rights: '流媒体' as RightsType,
        territory: '新加坡' as Territory, start: '2027-08-01', end: '2027-10-31',
        exclusive: true, sublicense: false, priority: 1,
      }],
      comments: [{
        channel: '环球新媒体', anchor: '新加坡 · 流媒体独占（待生成窗口）', author: '黎清', role: '法务',
        content: '新加坡独占期内不得向同区域 OTT 平台转授权。',
      }],
    },
    {
      parentTerritory: '东南亚区域' as Territory,
      summary: '马来西亚地区组提交《远山回声》流媒体独占窗口',
      windows: [{
        workId: 'W-001', work: '《远山回声》', channel: '星马传媒', rights: '流媒体' as RightsType,
        territory: '马来西亚' as Territory, start: '2027-09-15', end: '2028-03-15',
        exclusive: true, sublicense: false, priority: 1,
      }],
      comments: [{
        channel: '星马传媒', anchor: '马来西亚 · 流媒体独占（待生成窗口）', author: '章宁', role: '发行',
        content: '马来西亚与新加坡同属东南亚母地区，请按先到批次确认独占归属。',
      }],
    },
  ],
}

export function BatchConsole() {
  const windows = useRightsStore((state) => state.windows)
  const revisions = useRightsStore((state) => state.revisions)
  const batches = useRightsStore((state) => state.batches)
  const submitBatch = useRightsStore((state) => state.submitBatch)
  const submitSimultaneous = useRightsStore((state) => state.submitSimultaneous)
  const recover = useRightsStore((state) => state.recover)
  const rebase = useRightsStore((state) => state.rebase)
  const toast = useToast()
  const [expanded, setExpanded] = useState<string | null>(null)

  const works = useMemo(() => {
    const map = new Map<string, string>()
    windows.forEach((item) => map.set(item.workId, item.work))
    return Array.from(map.entries()).map(([id, title]) => ({ id, title }))
  }, [windows])

  const [parent, setParent] = useState<Territory>('东南亚区域')
  const [territory, setTerritory] = useState<Territory>('新加坡')
  const [workId, setWorkId] = useState('W-002')
  const [channel, setChannel] = useState('环球新媒体')
  const [rights, setRights] = useState<RightsType>('流媒体')
  const [start, setStart] = useState('2027-02-01')
  const [end, setEnd] = useState('2027-03-31')
  const [exclusive, setExclusive] = useState(false)
  const [sublicense, setSublicense] = useState(false)
  const [priority, setPriority] = useState(2)
  const [comment, setComment] = useState('')
  const [simulateFailure, setSimulateFailure] = useState(false)

  const baseRevision = revisions[parent] ?? 0
  const workTitle = works.find((item) => item.id === workId)?.title ?? ''

  function resetForm() {
    setComment('')
    setSimulateFailure(false)
  }

  function handleSubmit() {
    if (channel.trim().length < 2) return toast({ title: '渠道名称至少 2 个字符', status: 'warning' })
    if (new Date(end) < new Date(start)) return toast({ title: '窗口无效', description: '结束日期不能早于开始日期。', status: 'error' })
    const batch = submitBatch({
      parentTerritory: parent,
      windows: [{
        workId, work: workTitle, channel: channel.trim(), rights, territory,
        start, end, exclusive, sublicense, priority,
      }],
      comments: comment.trim() ? [{
        channel: channel.trim(), anchor: `${territory} · ${rights}${exclusive ? '独占' : '普通'}（待生成窗口）`,
        author: '当前用户', role: '发行', content: comment.trim(),
      }] : [],
      summary: `${territory} · ${workTitle} ${rights}${exclusive ? '独占' : '普通'}窗口提交`,
      simulateWriteFailure: simulateFailure,
      failReason: simulateFailure ? '模拟存储写入失败：批次已留存，可按批次号恢复。' : undefined,
    })
    if (batch.status === '生效') toast({ title: `批次 ${batch.id} 已写入`, description: `母地区 ${parent} 修订号 R${batch.baseRevision} → R${batch.committedRevision}，作品/窗口/条款意见同批提交。`, status: 'success' })
    else if (batch.status === '写入失败') toast({ title: `批次 ${batch.id} 写入失败`, description: `${batch.failReason} 未产生任何修订，可在台账中按批次号恢复。`, status: 'warning' })
    else toast({ title: `批次 ${batch.id}：${batch.status}`, description: batch.diffs[0]?.message, status: 'error' })
    resetForm()
  }

  function handleSimultaneous() {
    const results = submitSimultaneous(simultaneousDemo)
    results.forEach((batch, index) => {
      const group = index === 0 ? '新加坡（先到）' : '马来西亚（后到）'
      if (batch.status === '生效') toast({ title: `${group} 批次 ${batch.id} 生效`, description: `东南亚区域 R${batch.baseRevision} → R${batch.committedRevision}，独占窗口写入。`, status: 'success' })
      else toast({ title: `${group} 批次 ${batch.id}：${batch.status}`, description: batch.diffs.map((diff) => diff.message).join('；'), status: 'warning' })
    })
  }

  const pendingCount = batches.filter((item) => item.status !== '生效').length

  return (
    <Box mt={6}>
      <Flex justify="space-between" align="center" mb={4} gap={3} direction={{ base: 'column', md: 'row' }}>
        <Box>
          <Text color="brand.600" fontSize="xs" fontWeight="bold">CHANGE BATCH × PARENT TERRITORY REVISION</Text>
          <Heading size="lg" mt={1}>变更批次与母地区修订</Heading>
          <Text color="gray.600" fontSize="sm">作品、授权窗口与条款意见同一批次原子提交；提交绑定母地区最新修订号，独占高于普通授权，同一独占先到批次生效；写入失败按批次号恢复，后到批次留下差异。</Text>
        </Box>
        <HStack>
          <Button colorScheme="purple" variant="outline" onClick={handleSimultaneous}>模拟新、马两组同时提交独占</Button>
        </HStack>
      </Flex>

      <Grid templateColumns={{ base: '1fr', lg: 'repeat(5,1fr)' }} gap={3} mb={4}>
        {parentTerritories.map((name) => (
          <Box key={name} bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={3}>
            <Text fontWeight="700" fontSize="sm">{name === '东南亚区域' ? '东南亚（新加坡+马来西亚）' : name}</Text>
            <Text color="gray.500" fontSize="11px" mt={0.5}>{leavesOf(name).join(' / ')}</Text>
            <Flex justify="space-between" align="center" mt={2}>
              <Badge colorScheme={parent === name ? 'blue' : 'gray'}>当前 R{revisions[name] ?? 0}</Badge>
              <Button size="xs" variant="ghost" onClick={() => { setParent(name); setTerritory(leavesOf(name)[0]!) }}>在此提交</Button>
            </Flex>
          </Box>
        ))}
      </Grid>

      <Grid templateColumns={{ base: '1fr', xl: 'minmax(0,1fr) minmax(0,1.2fr)' }} gap={4}>
        <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}>
          <Flex justify="space-between" align="center" mb={3}>
            <Heading size="sm">提交变更批次</Heading>
            <Badge colorScheme="blue">绑定 {parent} R{baseRevision}</Badge>
          </Flex>
          <Grid templateColumns="1fr 1fr" gap={3}>
            <Box>
              <Text fontSize="xs" mb={1}>母地区组</Text>
              <Select size="sm" value={parent} onChange={(event) => { const next = event.target.value as Territory; setParent(next); setTerritory(leavesOf(next)[0]!) }}>
                {parentTerritories.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Box>
            <Box>
              <Text fontSize="xs" mb={1}>提交地区组</Text>
              <Select size="sm" value={territory} onChange={(event) => setTerritory(event.target.value as Territory)}>
                {leavesOf(parent).map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </Box>
            <Box>
              <Text fontSize="xs" mb={1}>作品</Text>
              <Select size="sm" value={workId} onChange={(event) => setWorkId(event.target.value)}>
                {works.map((item) => <option key={item.id} value={item.id}>{item.id} {item.title}</option>)}
              </Select>
            </Box>
            <Box>
              <Text fontSize="xs" mb={1}>渠道</Text>
              <Input size="sm" value={channel} onChange={(event) => setChannel(event.target.value)} />
            </Box>
            <Box>
              <Text fontSize="xs" mb={1}>权利类型</Text>
              <Select size="sm" value={rights} onChange={(event) => setRights(event.target.value as RightsType)}>
                {rightsTypes.map((item) => <option key={item}>{item}</option>)}
              </Select>
            </Box>
            <Box>
              <Text fontSize="xs" mb={1}>优先顺序</Text>
              <Input size="sm" type="number" value={priority} onChange={(event) => setPriority(Number(event.target.value))} />
            </Box>
            <Box>
              <Text fontSize="xs" mb={1}>开始日期</Text>
              <Input size="sm" type="date" value={start} onChange={(event) => setStart(event.target.value)} />
            </Box>
            <Box>
              <Text fontSize="xs" mb={1}>结束日期</Text>
              <Input size="sm" type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
            </Box>
          </Grid>
          <HStack mt={3}>
            <Checkbox isChecked={exclusive} onChange={(event) => setExclusive(event.target.checked)}>独占窗口</Checkbox>
            <Checkbox isChecked={sublicense} onChange={(event) => setSublicense(event.target.checked)}>允许次级授权</Checkbox>
            <Checkbox isChecked={simulateFailure} onChange={(event) => setSimulateFailure(event.target.checked)}>模拟写入失败</Checkbox>
          </HStack>
          <Text fontSize="xs" mt={3} mb={1}>条款意见（随本批次一同提交，不再单独落库）</Text>
          <Textarea size="sm" rows={3} value={comment} placeholder="例如：独占期内禁止同区域 OTT 转授权。" onChange={(event) => setComment(event.target.value)} />
          <Button size="sm" mt={3} colorScheme="blue" onClick={handleSubmit}>按修订号 R{baseRevision} 提交批次</Button>
        </Box>

        <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" overflow="hidden">
          <Flex p={4} justify="space-between" align="center">
            <Heading size="sm">批次台账</Heading>
            <Badge colorScheme={pendingCount ? 'orange' : 'green'}>{pendingCount ? `${pendingCount} 批待处理` : '全部生效'}</Badge>
          </Flex>
          <Table size="sm">
            <Thead><Tr><Th>批次</Th><Th>母地区 / 修订</Th><Th>状态</Th><Th>差异</Th><Th>操作</Th></Tr></Thead>
            <Tbody>
              {[...batches].reverse().map((batch) => (
                <Fragment key={batch.id}>
                  <Tr cursor="pointer" onClick={() => setExpanded(expanded === batch.id ? null : batch.id)}>
                    <Td>
                      <Text fontWeight="700">{batch.id}</Text>
                      <Text color="gray.500" fontSize="10px">{batch.submittedAt.slice(0, 16).replace('T', ' ')}</Text>
                    </Td>
                    <Td>
                      <Text fontSize="xs">{batch.parentTerritory ?? '全部母地区'}</Text>
                      <Text fontSize="10px" color="gray.500">R{batch.baseRevision}{batch.committedRevision ? ` → R${batch.committedRevision}` : ' 未写入'}</Text>
                    </Td>
                    <Td><Badge colorScheme={statusColor[batch.status]}>{batch.status}</Badge>{batch.attempts > 1 && <Text fontSize="10px" color="gray.500">尝试 {batch.attempts} 次</Text>}</Td>
                    <Td>{batch.diffs.length ? <Badge colorScheme="orange">{batch.diffs.length} 项</Badge> : <Text color="gray.400" fontSize="xs">—</Text>}</Td>
                    <Td onClick={(event) => event.stopPropagation()}>
                      {batch.status === '写入失败' && <Button size="xs" colorScheme="purple" variant="outline" onClick={() => { const result = recover(batch.id); if (result) toast({ title: `批次 ${result.id}：${result.status}`, description: result.status === '生效' ? `按批次号恢复成功，修订号推进至 R${result.committedRevision}。` : result.diffs[0]?.message, status: result.status === '生效' ? 'success' : 'warning' }) }}>按批次号恢复</Button>}
                      {(batch.status === '后到差异' || batch.status === '独占驳回') && <Button size="xs" colorScheme="orange" variant="outline" onClick={() => { const result = rebase(batch.id); if (result) toast({ title: `批次 ${result.id} 按最新修订号重提：${result.status}`, description: result.diffs[0]?.message ?? `修订号推进至 R${result.committedRevision}。`, status: result.status === '生效' ? 'success' : 'warning' }) }}>按最新 R 重提</Button>}
                      {batch.status === '生效' && <Text fontSize="xs" color="gray.400">{batch.appliedWindowIds.length} 窗 / {batch.comments.length} 意见</Text>}
                    </Td>
                  </Tr>
                  {expanded === batch.id && (
                    <Tr key={`${batch.id}-detail`}>
                      <Td colSpan={5} bg="gray.50">
                        <Box py={2} pl={2}>
                          <Text fontSize="xs" fontWeight="700">{batch.summary}</Text>
                          {batch.failReason && <Text fontSize="xs" color="purple.700" mt={1}>失败原因：{batch.failReason}</Text>}
                          {batch.diffs.length === 0 && <Text fontSize="xs" color="gray.500" mt={1}>无差异，批次内容已全部写入。</Text>}
                          {batch.diffs.map((diff, index) => (
                            <Box key={index} mt={1} p={2} bg="white" borderLeft="3px solid" borderLeftColor={diff.kind === '条款随批次留存' ? 'orange.300' : 'red.400'} borderRadius="4px">
                              <HStack><Badge colorScheme={diff.kind === '条款随批次留存' ? 'orange' : 'red'}>{diff.kind}</Badge><Text fontSize="11px" color="gray.600">{diff.windowLabel}</Text></HStack>
                              <Text fontSize="xs" mt={1}>{diff.message}</Text>
                            </Box>
                          ))}
                          <Text fontSize="10px" color="gray.400" mt={2}>写入窗口：{batch.appliedWindowIds.join('、') || '无'}{batch.coveredWindowIds.length ? `；覆盖普通授权：${batch.coveredWindowIds.join('、')}` : ''}</Text>
                        </Box>
                      </Td>
                    </Tr>
                  )}
                </Fragment>
              ))}
            </Tbody>
          </Table>
        </Box>
      </Grid>
    </Box>
  )
}
