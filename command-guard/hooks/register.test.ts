import { expect, test } from 'claude-code/testing'

import { checkCommand, checkFile } from './register'

const kind = (v: ReturnType<typeof checkCommand>) => (v === null ? 'pass' : 'deny' in v ? 'deny' : 'ask')

test('rm: root and home are denied, broad targets ask, the rest pass', () => {
  expect(kind(checkCommand('rm -rf /'))).toBe('deny')
  expect(kind(checkCommand('sudo rm -fr ~'))).toBe('deny')
  expect(kind(checkCommand('cd /tmp && rm -r -f "$HOME"'))).toBe('deny')
  expect(kind(checkCommand('rm -rf *'))).toBe('ask')
  expect(kind(checkCommand('rm -Rf ./'))).toBe('ask')
  expect(kind(checkCommand('rm -rf node_modules build'))).toBe('pass')
  expect(kind(checkCommand('rm /'))).toBe('pass')
  expect(kind(checkCommand('ls ~'))).toBe('pass')
})

test('git: force push, hard reset, clean and discarding changes ask', () => {
  expect(kind(checkCommand('git push --force origin main'))).toBe('ask')
  expect(kind(checkCommand('git push -uf origin feat'))).toBe('ask')
  expect(kind(checkCommand('git push origin +main'))).toBe('ask')
  expect(kind(checkCommand('git push --force-with-lease'))).toBe('pass')
  expect(kind(checkCommand('git push -u origin feat'))).toBe('pass')
  expect(kind(checkCommand('git fetch && git reset --hard origin/main'))).toBe('ask')
  expect(kind(checkCommand('git reset --soft HEAD~1'))).toBe('pass')
  expect(kind(checkCommand('git clean -fd'))).toBe('ask')
  expect(kind(checkCommand('git clean -n'))).toBe('pass')
  expect(kind(checkCommand('git checkout .'))).toBe('ask')
  expect(kind(checkCommand('git restore --staged .'))).toBe('pass')
  expect(kind(checkCommand('git checkout -b feat'))).toBe('pass')
})

test('sql: drop, truncate and delete without where ask', () => {
  expect(kind(checkCommand('mysql -e "DROP TABLE user"'))).toBe('ask')
  expect(kind(checkCommand('mysql -e "truncate table t_order"'))).toBe('ask')
  expect(kind(checkCommand('mysql -e "delete from t_order"'))).toBe('ask')
  expect(kind(checkCommand('mysql -e "delete from t_order where id = 1"'))).toBe('pass')
  expect(kind(checkCommand('mysql -e "select * from t_order"'))).toBe('pass')
})

test('prod config files ask', () => {
  expect(kind(checkFile('/app/src/main/resources/application-prod.yml'))).toBe('ask')
  expect(kind(checkFile('bootstrap-prod.properties'))).toBe('ask')
  expect(kind(checkFile('/app/.env.production'))).toBe('ask')
  expect(kind(checkFile('/app/src/main/resources/application-dev.yml'))).toBe('pass')
  expect(kind(checkFile('/app/src/Prod.java'))).toBe('pass')
})

test('a denied Bash call never runs', async ($, on) => {
  let ran = false
  on('tool.call', () => ((ran = true), { result: {} }))

  const r = await $.tool.call({ tool: 'Bash', command: 'rm -rf ~' })

  expect(ran).toBe(false)
  expect(r.text).toContain('禁止递归删除 ~')
})
