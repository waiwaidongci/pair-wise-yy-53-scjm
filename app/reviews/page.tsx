'use client'

import { useState } from 'react'
import { Box, Flex, Grid, Heading, Text, Badge, Button, Textarea, Checkbox, Tabs, TabList, Tab, TabPanels, TabPanel, useToast, HStack } from '@chakra-ui/react'
import Link from 'next/link'
import { useRightsStore } from '@/store/rights'
import { versions } from '@/lib/mock-data'

export default function ReviewsPage() {
  const comments = useRightsStore((state) => state.comments)
  const acceptComment = useRightsStore((state) => state.acceptComment)
  const submitComment = useRightsStore((state) => state.submitComment)
  const batches = useRightsStore((state) => state.batches)
  const revisions = useRightsStore((state) => state.revisions)
  const windows = useRightsStore((state) => state.windows)
  const [draft, setDraft] = useState('流媒体开窗日期以院线独占结束次日为准，并单独拆分港澳台物料。')
  const [anchorWindowId, setAnchorWindowId] = useState('RW-102')
  const [accepted, setAccepted] = useState<string[]>(['RW-102 开窗日期由 11-15 调整为 11-20'])
  const toast = useToast()

  function exportPackage() {
    const report = {
      version: 'v18',
      generatedAt: new Date().toISOString(),
      parentRevisions: revisions,
      batches: batches.map((batch) => ({
        id: batch.id,
        parentTerritory: batch.parentTerritory,
        baseRevision: batch.baseRevision,
        committedRevision: batch.committedRevision,
        status: batch.status,
        appliedWindowIds: batch.appliedWindowIds,
        coveredWindowIds: batch.coveredWindowIds,
        diffs: batch.diffs,
        failReason: batch.failReason,
        attempts: batch.attempts,
      })),
      accepted,
      unresolved: comments.filter((item) => !item.resolved).map((item) => ({ anchor: item.anchor, author: item.author, content: item.content, batchId: item.batchId, revision: item.revision })),
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = '发行权审批包-v18.json'
    link.click()
    URL.revokeObjectURL(link.href)
    toast({ title: '审批包已导出', description: '包含母地区修订号、变更批次台账与留存差异。', status: 'success' })
  }

  function handleSubmitComment() {
    const win = windows.find((item) => item.id === anchorWindowId)
    const batch = submitComment({
      channel: win?.channel ?? '云帆视频',
      anchor: `${anchorWindowId} · 条款意见`,
      author: '当前用户',
      role: '法务',
      content: draft.trim(),
    }, anchorWindowId)
    if (batch.status === '生效') {
      toast({ title: `法务意见已随批次 ${batch.id} 提交`, description: `与授权窗口绑定同一母地区修订号 R${batch.committedRevision}，不再单独落库。`, status: 'success' })
      setDraft('')
    } else {
      toast({ title: `条款批次 ${batch.id}：${batch.status}`, description: batch.diffs[0]?.message, status: 'warning' })
    }
  }

  return (
    <Box>
      <Flex justify="space-between" mb={5} gap={4} direction={{ base: 'column', md: 'row' }}><Box><Text color="brand.600" fontSize="xs" fontWeight="bold">VERSION & APPROVAL</Text><Heading fontSize="3xl" my={1}>版本比较与条款合并</Heading><Text color="gray.600">条款意见锚定窗口并随变更批次同批提交，后到批次的意见随差异留存；任意版本可逐项接受，已确认版本进入只读审批。</Text></Box><HStack><Button as={Link} href="/windows" variant="outline">前往批次台账</Button><Button colorScheme="blue" onClick={exportPackage}>导出可追溯审批包</Button></HStack></Flex>
      <Tabs colorScheme="blue" variant="enclosed">
        <TabList><Tab>条款意见</Tab><Tab>版本差异</Tab><Tab>批次与审批时间线</Tab></TabList>
        <TabPanels>
          <TabPanel px={0} pt={4}><Grid templateColumns={{ base: '1fr', lg: '1.3fr .8fr' }} gap={4}>
            <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px">{comments.map((comment) => <Box key={comment.id} p={4} borderBottom="1px solid" borderColor="gray.100"><Flex justify="space-between"><Box><Text fontWeight="700">{comment.role} · {comment.author}</Text><Text color="gray.500" fontSize="xs">{comment.anchor}{comment.batchId ? ` · 批次 ${comment.batchId} / R${comment.revision ?? 0}` : ''}</Text></Box><Badge colorScheme={comment.resolved ? 'green' : comment.withheld ? 'purple' : 'orange'}>{comment.resolved ? '已解决' : comment.withheld ? '随批次留存' : '待处理'}</Badge></Flex><Text color="gray.600" mt={3}>{comment.content}</Text>{!comment.resolved && <Button mt={3} size="sm" colorScheme="blue" variant="outline" onClick={() => acceptComment(comment.id)}>接受并合并条款</Button>}</Box>)}</Box>
            <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}><Heading size="md" mb={3}>发表评论锚点</Heading><Box mb={3}><Text fontSize="xs" mb={1}>锚定授权窗口（决定母地区与修订号）</Text><select value={anchorWindowId} onChange={(event) => setAnchorWindowId(event.target.value)} style={{ width: '100%', padding: '6px', border: '1px solid #e2e8f0', borderRadius: 6 }}>{windows.filter((item) => item.status !== '已覆盖').map((item) => <option key={item.id} value={item.id}>{item.id} · {item.work} {item.channel}（{item.territory} / 批次 {item.batchId ?? '—'} R{item.revision ?? 0}）</option>)}</select></Box><Textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={7} /><Button mt={3} colorScheme="blue" isDisabled={!draft.trim()} onClick={handleSubmitComment}>提交法务意见（随变更批次）</Button><Text fontSize="11px" color="gray.500" mt={2}>意见与窗口、作品在同一批次原子写入；若批次因修订落后或独占先到先得被驳回，意见随批次差异保留，可在批次台账重提。</Text></Box>
          </Grid></TabPanel>
          <TabPanel px={0} pt={4}><Grid templateColumns={{ base: '1fr', lg: '1fr 1fr' }} gap={4}>{versions.slice(0, 2).map((version) => <Box key={version.id} bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}><Flex justify="space-between"><Box><Heading size="md">{version.id}</Heading><Text color="gray.500" fontSize="sm">{version.author} · {version.time}</Text></Box><Badge>{version.changes.length} 项</Badge></Flex><Text fontWeight="600" mt={4}>{version.summary}</Text>{version.changes.map((change) => <Checkbox key={change} mt={3} isChecked={accepted.includes(change)} onChange={(event) => setAccepted((current) => event.target.checked ? [...current, change] : current.filter((item) => item !== change))}>{change}</Checkbox>)}</Box>)}</Grid></TabPanel>
          <TabPanel px={0} pt={4}><Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={5}>
            <Flex justify="space-between" mb={4} align="center"><Heading size="md">变更批次时间线</Heading><Button size="sm" as={Link} href="/windows" variant="outline">在授权窗口页处理失败/后到批次</Button></Flex>
            {[...batches].reverse().map((batch) => <HStack key={batch.id} align="flex-start" mb={4}><Badge colorScheme={batch.status === '生效' ? 'green' : batch.status === '写入失败' ? 'purple' : 'orange'}>{batch.id}</Badge><Box><Text fontWeight="700">{batch.summary}</Text><Text color="gray.500" fontSize="sm">{batch.parentTerritory ?? '全部母地区'} · R{batch.baseRevision}{batch.committedRevision ? ` → R${batch.committedRevision}` : ' 未写入'} · {batch.status}{batch.attempts > 1 ? ` · 尝试 ${batch.attempts} 次` : ''}</Text>{batch.diffs.map((diff, index) => <Text key={index} fontSize="xs" color="orange.700" mt={1}>差异：{diff.message}</Text>)}{batch.failReason && <Text fontSize="xs" color="purple.700" mt={1}>失败原因：{batch.failReason}</Text>}</Box></HStack>)}
            <HStack align="flex-start"><Badge colorScheme="gray">待处理</Badge><Box><Text fontWeight="700">发行负责人审批</Text><Text color="gray.500" fontSize="sm">全部高风险冲突解决、失败批次恢复或后到批次重提后，进入只读审批。</Text></Box></HStack>
          </Box></TabPanel>
        </TabPanels>
      </Tabs>
    </Box>
  )
}
