import { expect, test } from 'claude-code/testing'

const LONG = '结论'.repeat(400)
const turn = { durationMs: 1, isAborted: false, reason: 'answer', turnId: 't' } as const

test('a long main answer gets one TL;DR line from haiku; short, sub-agent and failed calls do not', async ($, on) => {
  const prompts: string[] = []
  let reply: { isAnswered: true; text: string } | { isAnswered: false; reason: 'empty-reply' } = {
    isAnswered: true,
    text: '\n  改用本地市场安装，改完执行 /reload-plugins 即可。\n多余的第二行',
  }
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  on('model.complete', (_, e) => {
    expect(e.model).toBe('haiku')
    prompts.push(e.prompt)
    return { value: { ...reply, usage } }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))

  const long = await $.turn.complete({ ...turn, answer: LONG })
  expect(long.text).toBe('TL;DR：改用本地市场安装，改完执行 /reload-plugins 即可。')
  expect(prompts[0]).toContain(LONG)

  expect((await $.turn.complete({ ...turn, answer: '好的' })).text).toBe('好的')
  expect((await $.turn.complete({ ...turn, answer: LONG, agentId: 'a1' })).text).toBe(LONG)
  expect(prompts.length).toBe(1)

  reply = { isAnswered: false, reason: 'empty-reply' }
  expect((await $.turn.complete({ ...turn, answer: LONG })).text).toBe(LONG)
})
