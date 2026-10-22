import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'token-usage',
  component: 'Pane',
  requestId: 'token-usage',
  props: {
    title: 'Token 用量',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const T0 = Date.parse('2026-10-22T00:00:00Z')
const HOUR = 3_600_000

const usage = (input: number, output: number) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: 1000,
  cache_creation_input_tokens: 0,
  model: 'claude-opus-5-5',
})

const BREAKDOWN = {
  categories: [
    { name: 'System prompt', tokens: 3000, color: 'x', isDeferred: false, kind: 'used' },
    { name: 'Messages', tokens: 40000, color: 'x', isDeferred: false, kind: 'used' },
    { name: 'MCP server instructions', tokens: 1200, color: 'x', isDeferred: false, kind: 'used' },
    { name: 'Free space', tokens: 150000, color: 'x', isDeferred: false, kind: 'free' },
    { name: 'MCP tools', tokens: 9000, color: 'x', isDeferred: true, kind: 'deferred' },
  ],
}

test('the pane shows usage, trend, tools, limits and its controls', async ($, on) => {
  let now = T0
  const toasts: string[] = []
  on('clock.now', () => ({ value: now }))
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }))
  on('command.register', () => ({ value: { command: 'tokens' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.usage', (_, e) => ({
    value: {
      startedAt: 0,
      context: { window: 200000, ...(e?.breakdown ? { breakdown: BREAKDOWN as never } : {}) },
      rateLimits: [],
    },
  }))
  on('session.compact', () => ({
    messages: [{ role: 'user', text: 'summary', toolUses: [] }],
    tokensBefore: 150000,
    tokensAfter: 20000,
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('skill.prompt', (_, e) => ({ text: e.text }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'pwd' })
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  const skill = { text: 'x', frontmatter: {}, source: 'userSettings' } as const
  await $.skill.prompt({ ...skill, skill: 'recent-projects' })
  await $.skill.prompt({ ...skill, skill: 'brainstorming', pluginName: 'superpowers' })
  await $.skill.prompt({ ...skill, skill: 'brainstorming', pluginName: 'superpowers' })

  const turn = { answer: '', isAborted: false, reason: 'answer' } as const
  await $.turn.complete({ ...turn, turnId: 't1', durationMs: 10000, usage: usage(100, 200) })
  await $.turn.complete({ ...turn, turnId: 't2', durationMs: 5000, usage: usage(300, 400), agentId: 'a1' })

  const limit = (percentUsed: number) => [
    { kind: 'five_hour', percentUsed, resetsAt: '2026-10-22T10:30:00Z' },
  ]
  const ctx = (percent: number) => ({ tokens: percent * 2000, window: 200000, percent })
  await $.session.measure({ context: ctx(25), rateLimits: limit(20), cost: { usd: 0.1234 }, changed: ['context'] })
  now = T0 + HOUR
  await $.session.measure({ context: ctx(88), rateLimits: limit(42), cost: { usd: 0.1234 }, changed: ['context'] })
  expect(toasts.some(t => t.includes('上下文已用 88%'))).toBe(true)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text ?? ''
    // 一行「标签 … 数值」：标签所在 Text 的下一个 Text 是数值
    const value = async (label: string) => {
      const texts = (await ui.findAll({ type: 'Text' })).map(x => x.text)
      const at = texts.indexOf(label)
      return at < 0 ? undefined : texts[at + 1]
    }

    // 缓存命中 = 2000 / (400 + 2000 + 0)
    expect(await text(/会话累计/)).toBe('会话累计 · 2 轮 · 缓存命中 83%')
    expect(await value('输入')).toBe('400')
    expect(await value('输出')).toBe('600')
    expect(await value('合计')).toBe('3.0k')
    expect(await text(/88%/)).toContain('176.0k / 200.0k')
    expect(await value('费用')).toBe('$0.1234')
    // 子 Agent 的轮次只计入总量，不覆盖主线程的"最近一轮"
    expect(await text(/最近一轮/)).toBe('最近一轮 · claude-opus-5-5')
    expect(await value('输入 / 输出')).toBe('100 / 200')
    expect(await value('耗时')).toBe('10.0s')
    // t1 之前的技能归入 t1；t2 是子 Agent 的轮次，不改变"最近一轮"
    expect(await value('技能')).toBe('recent-projects、superpowers:brainstorming ×2')
    expect(await value('生成速度')).toBe('约 20 token/秒')
    expect(await text(/输出趋势/)).toBe('输出趋势 · 最近 1 轮')
    expect(await text(/工具调用/)).toBe('工具调用 · 共 3 次')
    expect(await value('Bash')).toBe('2')
    expect(await value('Read')).toBe('1')
    expect(await text(/技能调用/)).toBe('技能调用 · 2 个 · 共 3 次')
    expect(await value('superpowers:brainstorming')).toBe('2')
    expect(await value('recent-projects')).toBe('1')
    expect(await text(/5 小时限额/)).toContain('42%')
    // 1 小时涨 22 个点，剩 58 个点约 2.6 小时，早于 10:30 重置
    expect(await text(/重置 ·/)).toMatch(/10-22 \d\d:30 重置 · 预计 10-22 \d\d:\d\d 耗尽/)

    await ui.press({ key: 'show-parts' })
    expect(await value('  消息')).toBe('40.0k  20%')
    expect(await value('  系统提示词')).toBe('3.0k   2%')
    expect(await value('  MCP 服务器说明')).toBe('1.2k   1%')
    expect(await value('  剩余空间')).toBe('150.0k  75%')
    // 按需加载的工具定义不占窗口，不列出
    expect(await text(/MCP 工具/)).toBe('')
    await ui.press({ key: 'hide-parts' })
    expect(await text(/消息/)).toBe('')
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'compact' })
  expect(toasts).toContain('上下文已压缩：150.0k → 20.0k')
  await ui.unmount()
})
