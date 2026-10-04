'use client'

import { useMemo, useState } from 'react'
import { Box, Flex, Grid, Heading, Text, Badge, Button, Input, Select, Checkbox, Table, Thead, Tbody, Tr, Th, Td, useToast } from '@chakra-ui/react'
import { useRightsStore } from '@/store/rights'
import type { LicenseWindow, RightsComment, RightsType, Territory } from '@/lib/types'

interface Template {
  label: string
  workId: string
  channel: string
  rights: RightsType
  territory: Territory
  start: string
  end: string
  exclusive: boolean
}

const templates: Record<string, Template> = {
  'sg-exclusive': { label: '新加坡 · 流媒体独占', workId: 'W-002', channel: '云帆视频', rights: '流媒体', territory: '新加坡', start: '2027-06-01', end: '2027-12-31', exclusive: true },
  'my-exclusive': { label: '马来西亚 · 流媒体独占', workId: 'W-002', channel: '云帆视频', rights: '流媒体', territory: '马来西亚', start: '2027-06-15', end: '2028-01-15', exclusive: true },
  'my-non-exclusive': { label: '马来西亚 · 航空普通', workId: 'W-002', channel: '海岛航空', rights: '航空', territory: '马来西亚', start: '2028-02-01', end: '2028-04-30', exclusive: false },
  'cn-exclusive': { label: '中国大陆 · 流媒体独占', workId: 'W-001', channel: '云帆视频', rights: '流媒体', territory: '中国大陆', start: '2027-06-01', end: '2027-12-31', exclusive: true },
}

const territories: Territory[] = ['中国大陆', '中国香港', '中国台湾', '新加坡', '马来西亚', '东南亚区域', '北美']

const statusColor: Record<string, string> = { 已生效: 'green', 已恢复: 'blue', 差异: 'orange', 写入失败: 'red' }

export function BatchPanel() {
  const works = useRightsStore((state) => state.works)
  const batches = useRightsStore((state) => state.batches)
  const submitBatch = useRightsStore((state) => state.submitBatch)
  const recoverBatch = useRightsStore((state) => state.recoverBatch)
  const toast = useToast()

  const [templateKey, setTemplateKey] = useState('sg-exclusive')
  const [channel, setChannel] = useState(templates['sg-exclusive']!.channel)
  const [territory, setTerritory] = useState<Territory>(templates['sg-exclusive']!.territory)
  const [start, setStart] = useState(templates['sg-exclusive']!.start)
  const [end, setEnd] = useState(templates['sg-exclusive']!.end)
  const [exclusive, setExclusive] = useState(templates['sg-exclusive']!.exclusive)
  const [simulateFailure, setSimulateFailure] = useState(false)
  const [comment, setComment] = useState('')

  const workId = templates[templateKey]!.workId
  const work = works.find((w) => w.id === workId)

  const sortedBatches = useMemo(() => [...batches].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [batches])

  function applyTemplate(key: string) {
    const tpl = templates[key]!
    setTemplateKey(key)
    setChannel(tpl.channel)
    setTerritory(tpl.territory)
    setStart(tpl.start)
    setEnd(tpl.end)
    setExclusive(tpl.exclusive)
  }

  function handleSubmit() {
    if (!work) return
    const win: LicenseWindow = {
      id: `PW-${Date.now()}`,
      workId: work.id,
      work: work.name,
      channel,
      rights: templates[templateKey]!.rights,
      territory,
      start,
      end,
      exclusive,
      sublicense: false,
      priority: 1,
      status: '草案',
    }
    const comments: RightsComment[] = comment.trim()
      ? [{ id: `CM-${Date.now()}`, channel, anchor: `${win.id} · ${territory}`, author: '当前用户', role: '发行', content: comment.trim(), resolved: false }]
      : []
    submitBatch({ workId: work.id, payloadWindows: [win], payloadComments: comments, simulateFailure })
    toast({
      title: simulateFailure ? '批次已提交但写入失败' : '变更批次已提交',
      description: simulateFailure ? '已绑定母地区修订号，可按批次号恢复。' : `已绑定母地区 ${work.parentRegion} 最新修订号 v${work.latestRevision}。`,
      status: simulateFailure ? 'warning' : 'success',
    })
    setComment('')
    setSimulateFailure(false)
  }

  return (
    <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={5} mt={4}>
      <Flex justify="space-between" align="flex-start" mb={4} gap={4} direction={{ base: 'column', md: 'row' }}>
        <Box>
          <Heading size="md">变更批次</Heading>
          <Text color="gray.500" fontSize="sm" mt={1}>作品、授权窗口、条款意见接入同一批次；绑定母地区最新修订号，独占高于普通授权，同一独占按先到批次生效，写入失败按批次号恢复，后到批次留下差异。</Text>
        </Box>
      </Flex>

      <Box p={4} bg="gray.50" borderRadius="8px" mb={4}>
        <Grid templateColumns={{ base: '1fr', md: '1fr 1fr 1fr' }} gap={3}>
          <Box>
            <Text fontSize="sm" mb={1}>作品（母地区 · 最新修订号）</Text>
            <Select value={workId} onChange={(e) => { const key = Object.keys(templates).find((k) => templates[k]!.workId === e.target.value); if (key) applyTemplate(key) }}>
              {works.map((w) => <option key={w.id} value={w.id}>{w.name} · {w.parentRegion}（v{w.latestRevision}）</option>)}
            </Select>
          </Box>
          <Box>
            <Text fontSize="sm" mb={1}>窗口模板</Text>
            <Select value={templateKey} onChange={(e) => applyTemplate(e.target.value)}>
              {Object.entries(templates).map(([key, tpl]) => <option key={key} value={key}>{tpl.label}</option>)}
            </Select>
          </Box>
          <Box>
            <Text fontSize="sm" mb={1}>渠道</Text>
            <Input value={channel} onChange={(e) => setChannel(e.target.value)} />
          </Box>
          <Box>
            <Text fontSize="sm" mb={1}>地区</Text>
            <Select value={territory} onChange={(e) => setTerritory(e.target.value as Territory)}>
              {territories.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Box>
          <Box>
            <Text fontSize="sm" mb={1}>开始</Text>
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Box>
          <Box>
            <Text fontSize="sm" mb={1}>结束</Text>
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Box>
        </Grid>
        <Flex mt={3} gap={4} align="center" flexWrap="wrap">
          <Checkbox isChecked={exclusive} onChange={(e) => setExclusive(e.target.checked)}>独占窗口</Checkbox>
          <Checkbox isChecked={simulateFailure} onChange={(e) => setSimulateFailure(e.target.checked)}>模拟写入失败（绑定修订号后中断，可恢复）</Checkbox>
        </Flex>
        <Box mt={3}>
          <Text fontSize="sm" mb={1}>条款意见（随批次提交）</Text>
          <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="可填写一条随批次保存的条款意见" />
        </Box>
        <Button mt={3} colorScheme="blue" onClick={handleSubmit}>提交变更批次</Button>
      </Box>

      <Table size="sm">
        <Thead>
          <Tr>
            <Th>批次号</Th>
            <Th>作品 · 母地区</Th>
            <Th>绑定修订号</Th>
            <Th>状态</Th>
            <Th>生效</Th>
            <Th>差异</Th>
            <Th>操作</Th>
          </Tr>
        </Thead>
        <Tbody>
          {sortedBatches.map((b) => {
            const w = works.find((x) => x.id === b.workId)
            return (
              <Tr key={b.id}>
                <Td fontWeight="600">{b.id}</Td>
                <Td>{w?.name} · {b.parentRegion}</Td>
                <Td>v{b.baseRevision}</Td>
                <Td><Badge colorScheme={statusColor[b.status]}>{b.status}</Badge></Td>
                <Td><Badge colorScheme={b.effective ? 'green' : 'gray'}>{b.effective ? '生效' : '未生效'}</Badge></Td>
                <Td>{b.diffs.length} 项</Td>
                <Td>{b.status === '写入失败' && <Button size="xs" colorScheme="blue" variant="outline" onClick={() => { recoverBatch(b.id); toast({ title: '已按批次号恢复', description: `批次 ${b.id} 重算完成。`, status: 'info' }) }}>按批次号恢复</Button>}</Td>
              </Tr>
            )
          })}
        </Tbody>
      </Table>

      {sortedBatches.filter((b) => b.diffs.length > 0).map((b) => (
        <Box key={b.id} mt={3} p={3} bg="orange.50" borderLeft="3px solid" borderColor="orange.400" borderRadius="6px">
          <Text fontWeight="700" fontSize="sm">{b.id} 后到差异（{b.diffs.length}）</Text>
          {b.diffs.map((d, i) => <Text key={i} fontSize="sm" color="gray.700" mt={1}>· {d.detail}</Text>)}
        </Box>
      ))}
    </Box>
  )
}
