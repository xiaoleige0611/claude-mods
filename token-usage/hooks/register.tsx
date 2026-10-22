import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Limit, LimitBase, Meter, Slice, Tokens, TurnSample } from '../types'

const PANE = 'token-usage'
const ZERO: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 }
const TREND = 20

const total = atom({ plugin: 'token-usage', key: 'total' } as const, ZERO)
const last = atom({ plugin: 'token-usage', key: 'last' } as const, null)
const model = atom({ plugin: 'token-usage', key: 'model' } as const, '')
const meter = atom({ plugin: 'token-usage', key: 'meter' } as const, null)
const turnLog = atom({ plugin: 'token-usage', key: 'turnLog' } as const, [])
const tools = atom({ plugin: 'token-usage', key: 'tools' } as const, {})
const skills = atom({ plugin: 'token-usage', key: 'skills' } as const, {})
const pendingSkills = atom({ plugin: 'token-usage', key: 'pendingSkills' } as const, [])
const lastSkills = atom({ plugin: 'token-usage', key: 'lastSkills' } as const, [])
const limitBase = atom({ plugin: 'token-usage', key: 'limitBase' } as const, {})
const breakdown = atom({ plugin: 'token-usage', key: 'breakdown' } as const, null)
const isWarned = atom({ plugin: 'token-usage', key: 'isWarned' } as const, false)

const fmt = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`

const bar = (percent: number, width = 20) => {
  const full = Math.round((Math.min(100, percent) / 100) * width)
  return '█'.repeat(full) + '░'.repeat(width - full)
}

const SPARK = '▁▂▃▄▅▆▇█'
const spark = (values: number[]) => {
  const max = Math.max(1, ...values)
  return values.map(v => SPARK[Math.min(7, Math.floor((v / max) * 7.999))]).join('')
}

const pad = (n: number) => `${n}`.padStart(2, '0')

// 按本地时区显示为 MM-DD HH:mm
const stamp = (ms: number) => {
  const d = new Date(ms)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const parse = (iso?: string) => {
  const ms = iso ? Date.parse(iso) : NaN
  return isNaN(ms) ? undefined : ms
}

const LIMIT_NAMES: Record<string, string> = {
  five_hour: '5 小时限额',
  seven_day: '7 天限额',
  spend_limit: '消费限额',
}

// /context 的分类名；未收录的保留原文
const SLICE_NAMES: Record<string, string> = {
  'System prompt': '系统提示词',
  'System tools': '内置工具',
  'MCP tools': 'MCP 工具',
  'MCP server instructions': 'MCP 服务器说明',
  'Organization instructions': '组织指令',
  'Custom agents': '自定义 Agent',
  'Memory files': '记忆文件',
  Skills: '技能',
  'Slash commands': '斜杠命令',
  Messages: '消息',
  'Free space': '剩余空间',
  'Autocompact buffer': '自动压缩预留',
}

// 速度至少要 2 分钟、1 个百分点的样本才推算，避免抖动
const project = (r: SessionRateLimit, base: LimitBase | undefined, now: number): Limit => {
  const limit: Limit = { kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt }
  if (!base) return limit
  const grew = r.percentUsed - base.percentUsed
  const elapsed = now - base.at
  if (grew < 1 || elapsed < 120_000) return limit
  return { ...limit, etaAt: now + ((100 - r.percentUsed) / grew) * elapsed }
}

type Measured = { context: Meter['context']; rateLimits: SessionRateLimit[]; cost?: { usd: number } }

const measure = async ($: EngineInterface, e: Measured) => {
  const now = await $.clock.now()
  const bases = await read($, limitBase)
  const next: Record<string, LimitBase> = {}
  for (const r of e.rateLimits) {
    const base = bases[r.kind]
    // 窗口重置（resetsAt 变了）或占用回落时重新起算
    const isSame = base && base.resetsAt === r.resetsAt && base.percentUsed <= r.percentUsed
    next[r.kind] = isSame ? base : { resetsAt: r.resetsAt, percentUsed: r.percentUsed, at: now }
  }
  await update($, limitBase, () => next)
  await update($, meter, () => ({
    context: { tokens: e.context.tokens, window: e.context.window, percent: e.context.percent },
    rateLimits: e.rateLimits.map(r => project(r, next[r.kind], now)),
    usd: e.cost?.usd,
  }))

  const pct = e.context.percent ?? 0
  const warned = await read($, isWarned)
  if (pct >= 85 && !warned) {
    $.ui.toast(`上下文已用 ${pct}%，可在 Token 用量面板一键压缩`)
    await update($, isWarned, () => true)
  } else if (pct < 70 && warned) {
    await update($, isWarned, () => false)
  }
}

const loadBreakdown = async ($: EngineInterface) => {
  const u = await $.session.usage({ breakdown: 'full' })
  const rows: Slice[] = (u.context.breakdown?.categories ?? [])
    .filter(c => c.kind === 'used' || c.kind === 'free')
    .map(c => ({ name: SLICE_NAMES[c.name] ?? c.name, tokens: c.tokens, kind: c.kind }))
  await update($, breakdown, () => rows)
}

const compact = async ($: EngineInterface) => {
  $.ui.toast('正在压缩上下文…')
  const r = await $.session.compact().catch((err: unknown) => ({
    skip: err instanceof Error ? err.message : String(err),
    messages: undefined,
  }))
  if (r.messages === undefined) {
    $.ui.toast(`未压缩：${r.skip}`)
  } else {
    const delta = r.tokensBefore && r.tokensAfter ? `：${fmt(r.tokensBefore)} → ${fmt(r.tokensAfter)}` : ''
    $.ui.toast(`上下文已压缩${delta}`)
    await update($, breakdown, () => null)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'tokens', description: '打开 Token 用量实时面板' })
    void $.session.usage().then(u => measure($, u))
    void $.ui.open({ id: PANE, title: 'Token 用量' })

    return next(e)
  })

  on('command.run', { command: 'tokens' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Token 用量' })

    return { text: '已打开 Token 用量面板。' }
  })

  // 主循环和子 Agent 的工具调用都计数
  on('tool.call', async ($, e, next) => {
    await update($, tools, t => ({ ...t, [e.tool]: (t[e.tool] ?? 0) + 1 }))

    return next(e)
  })

  // 技能展开时计数：/name、Skill 工具、子 Agent 预加载都会经过这里
  on('skill.prompt', async ($, e, next) => {
    const name = e.pluginName && !e.skill.includes(':') ? `${e.pluginName}:${e.skill}` : e.skill
    await update($, skills, s => ({ ...s, [name]: (s[name] ?? 0) + 1 }))
    await update($, pendingSkills, list => [...list, name])

    return next(e)
  })

  // 每轮结束（主循环和子 Agent 都算）累加真实 API 用量
  on('turn.complete', async ($, e, next) => {
    // /name 在本轮开始前就展开了，所以按「上一轮结束至今」归入本轮
    if (!e.agentId) {
      const used = await read($, pendingSkills)
      await update($, lastSkills, () => used)
      await update($, pendingSkills, () => [])
    }
    const u = e.usage
    if (u) {
      const turn: Tokens = {
        input: u.input_tokens,
        output: u.output_tokens,
        cacheRead: u.cache_read_input_tokens,
        cacheWrite: u.cache_creation_input_tokens,
        turns: 1,
      }
      await update($, total, t => ({
        input: t.input + turn.input,
        output: t.output + turn.output,
        cacheRead: t.cacheRead + turn.cacheRead,
        cacheWrite: t.cacheWrite + turn.cacheWrite,
        turns: t.turns + 1,
      }))
      if (!e.agentId) {
        const sample: TurnSample = { output: u.output_tokens, ms: e.durationMs }
        await update($, last, () => turn)
        await update($, model, () => u.model)
        await update($, turnLog, log => [...log, sample].slice(-TREND))
      }
    }

    return next(e)
  })

  // 上下文占用、限额窗口、费用由引擎推送
  on('session.measure', async ($, e, next) => {
    await measure($, e)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const t = await read($, total)
    const l = await read($, last)
    const m = await read($, meter)
    const name = await read($, model)
    const log = await read($, turnLog)
    const counts = await read($, tools)
    const skillCounts = await read($, skills)
    const turnSkills = await read($, lastSkills)
    const parts = await read($, breakdown)

    const ctx = m?.context
    const pct = ctx?.percent ?? 0
    const color = pct >= 85 ? 'red' : pct >= 60 ? 'yellow' : 'green'
    const prompt = t.input + t.cacheRead + t.cacheWrite
    const hit = prompt ? Math.round((t.cacheRead / prompt) * 100) : 0
    const lastSample = log[log.length - 1]
    const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1])
    const calls = ranked.reduce((sum, [, n]) => sum + n, 0)
    const shown = ranked.slice(0, 6)
    const rest = ranked.slice(6).reduce((sum, [, n]) => sum + n, 0)
    const skillRanked = Object.entries(skillCounts).sort((a, b) => b[1] - a[1])
    const skillCalls = skillRanked.reduce((sum, [, n]) => sum + n, 0)
    // 按首次出现顺序合并重复：a、b ×2
    const turnSkillText =
      [...new Set(turnSkills)]
        .map(s => {
          const n = turnSkills.filter(x => x === s).length
          return n > 1 ? `${s} ×${n}` : s
        })
        .join('、') || '无'
    const used = (parts ?? []).filter(p => p.kind === 'used').sort((a, b) => b.tokens - a.tokens)
    const free = parts?.find(p => p.kind === 'free')
    const share = (n: number) => (ctx?.window ? `${Math.round((n / ctx.window) * 100)}%`.padStart(4) : '')

    // 类目标题：青色加粗，概要灰色跟在后面
    const head = (title: string, extra?: string) => (
      <Text>
        <Text bold color="cyan">
          {title}
        </Text>
        {extra && <Text dimColor> · {extra}</Text>}
      </Text>
    )
    // 标签靠左、数值靠右
    const row = (label: string, value: string) => (
      <Box justifyContent="space-between">
        <Text dimColor>{label}</Text>
        <Text>{value}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          {head('上下文')}
          {ctx?.tokens === undefined ? (
            <Text dimColor>等待首次响应…</Text>
          ) : (
            <Text>
              <Text color={color}>{bar(pct)}</Text> {pct}% · {fmt(ctx.tokens)} / {fmt(ctx.window)}
            </Text>
          )}
          <Box>
            {parts ? (
              <Button key="hide-parts" label="收起构成" dimColor onPress={() => update($, breakdown, () => null)} />
            ) : (
              <Button key="show-parts" label="查看构成" dimColor onPress={() => loadBreakdown($)} />
            )}
            <Text> </Text>
            {parts && <Button key="reload-parts" label="刷新" dimColor onPress={() => loadBreakdown($)} />}
            {parts && <Text> </Text>}
            <Button key="compact" label="压缩上下文" onPress={() => compact($)} />
          </Box>
          {used.map(p => row(`  ${p.name}`, `${fmt(p.tokens)} ${share(p.tokens)}`))}
          {free && row(`  ${free.name}`, `${fmt(free.tokens)} ${share(free.tokens)}`)}
        </Box>

        <Box flexDirection="column">
          {head('会话累计', `${t.turns} 轮 · 缓存命中 ${hit}%`)}
          {row('输入', fmt(t.input))}
          {row('输出', fmt(t.output))}
          {row('缓存读取', fmt(t.cacheRead))}
          {row('缓存写入', fmt(t.cacheWrite))}
          <Box justifyContent="space-between">
            <Text bold>合计</Text>
            <Text bold>{fmt(t.input + t.output + t.cacheRead + t.cacheWrite)}</Text>
          </Box>
        </Box>

        {l && (
          <Box flexDirection="column">
            {head('最近一轮', name || undefined)}
            {row('输入 / 输出', `${fmt(l.input)} / ${fmt(l.output)}`)}
            {row('缓存 读 / 写', `${fmt(l.cacheRead)} / ${fmt(l.cacheWrite)}`)}
            {row('技能', turnSkillText)}
            {lastSample && lastSample.ms > 0 && row('耗时', `${(lastSample.ms / 1000).toFixed(1)}s`)}
            {lastSample &&
              lastSample.ms > 0 &&
              row('生成速度', `约 ${fmt(lastSample.output / (lastSample.ms / 1000))} token/秒`)}
          </Box>
        )}

        {log.length > 0 && (
          <Box flexDirection="column">
            {head('输出趋势', `最近 ${log.length} 轮`)}
            <Text color="cyan">{spark(log.map(s => s.output))}</Text>
            <Text dimColor>
              峰值 {fmt(Math.max(...log.map(s => s.output)))} · 平均{' '}
              {fmt(log.reduce((sum, s) => sum + s.output, 0) / log.length)}
            </Text>
          </Box>
        )}

        {calls > 0 && (
          <Box flexDirection="column">
            {head('工具调用', `共 ${calls} 次`)}
            {shown.map(([tool, n]) => row(tool, `${n}`))}
            {rest > 0 && row('其他', `${rest}`)}
          </Box>
        )}

        {skillCalls > 0 && (
          <Box flexDirection="column">
            {head('技能调用', `${skillRanked.length} 个 · 共 ${skillCalls} 次`)}
            {skillRanked.map(([skill, n]) => row(skill, `${n}`))}
          </Box>
        )}

        {m && (m.usd !== undefined || m.rateLimits.length > 0) && (
          <Box flexDirection="column">
            {head('费用与限额')}
            {m.usd !== undefined && row('费用', `$${m.usd.toFixed(4)}`)}
            {m.rateLimits.map(r => {
              const reset = parse(r.resetsAt)
              const eta =
                r.etaAt === undefined
                  ? '速度采样中'
                  : reset !== undefined && r.etaAt >= reset
                    ? '重置前不会耗尽'
                    : `预计 ${stamp(r.etaAt)} 耗尽`
              return (
                <Box flexDirection="column">
                  <Text>
                    {LIMIT_NAMES[r.kind] ?? r.kind} {bar(r.percentUsed, 10)} {r.percentUsed}%
                  </Text>
                  <Text dimColor>
                    {'  '}
                    {reset !== undefined ? `${stamp(reset)} 重置 · ` : ''}
                    {eta}
                  </Text>
                </Box>
              )
            })}
          </Box>
        )}
      </Box>
    )
  })
}
