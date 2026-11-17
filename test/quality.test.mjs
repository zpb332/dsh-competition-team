import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeStore, makeTeam, finishCaptain, assistantEvent } from '../test-support/helpers.mjs'

const { store, sessions, cwd, mod } = await makeStore()
const dir = await mkdtemp(join(tmpdir(), 'ct-quality-'))

async function file(name, content) {
  const target = join(dir, name)
  await writeFile(target, content)
  return target
}

test('qualityCheck catches empty artifacts and malformed images', async () => {
  const member = { name: '队员', role: 'member-1' }
  const empty = await file('tiny.txt', 'xx')
  assert.deepEqual((await mod.qualityCheck(empty, 'member-1/tiny.txt', member)).errors[0].code, 'empty-artifact')

  const png = await file('chart.png', 'this is definitely not a png, just text'.repeat(3))
  assert.deepEqual((await mod.qualityCheck(png, 'member-1/chart.png', member)).errors[0].code, 'bad-image')

  const goodPng = await file('good.png', Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 1),
  ]))
  assert.deepEqual((await mod.qualityCheck(goodPng, 'member-1/good.png', member)).errors, [])
})

test('qualityCheck catches stub code and single-row data', async () => {
  const member = { name: '队员', role: 'member-1' }
  const code = await file('main.py', 'print(1)\n#' + 'x'.repeat(40) + '\n')
  assert.deepEqual((await mod.qualityCheck(code, 'member-1/main.py', member)).errors[0].code, 'empty-code')

  const csv = await file('data.csv', 'a,b,c' + 'x'.repeat(40))
  assert.deepEqual((await mod.qualityCheck(csv, 'member-1/data.csv', member)).errors[0].code, 'thin-data')
})

test('paper checks block thin drafts and warn about missing sections', async () => {
  const paperMember = { name: '论文手', role: 'member-a' }
  const thin = await file('paper-thin.md', 'x'.repeat(400))
  assert.deepEqual((await mod.qualityCheck(thin, 'member-a/paper.md', paperMember)).errors[0].code, 'thin-paper')

  const unstructured = await file('paper-plain.md', 'x'.repeat(700))
  const warning = await mod.qualityCheck(unstructured, 'member-a/paper.md', paperMember)
  assert.deepEqual(warning.errors, [])
  assert.deepEqual(warning.warnings[0].code, 'missing-sections')

  const structured = await file('paper-good.md', '# 摘要\n' + 'x'.repeat(200) + '\n# 模型\n' + 'y'.repeat(300))
  assert.deepEqual((await mod.qualityCheck(structured, 'member-a/paper.md', paperMember)).warnings, [])
})

test('a declared empty artifact triggers the guard once, then blocks', async () => {
  const team = await makeTeam(store, cwd)
  await store.confirm(team.id)
  const captain = team.members.find(member => member.role === 'captain')
  await writeFile(
    join(team.root, 'handoffs', 'captain.md'),
    '<!-- competition-team\n'
      + JSON.stringify({ role: 'captain', status: 'done', artifacts: ['artifacts/captain/tiny.txt'], verdict: null, blockers: [] })
      + '\n-->\n# 交接\n',
    'utf8',
  )
  await writeFile(join(team.root, 'artifacts', 'captain', 'tiny.txt'), 'xx', 'utf8')
  const session = sessions.get(captain.sessionId)
  session.events.push(assistantEvent('完成汇报'))
  await store.onSessionEvent(session, { type: 'turn/end' })

  assert.equal(captain.status, 'running')
  assert.equal(captain.guardRetries, 1)

  await store.onSessionEvent(session, { type: 'turn/end' })
  assert.equal(captain.status, 'blocked')
  assert.equal(captain.error, 'low-quality-artifacts')
})

test('a normal artifact passes and leaves no quality warnings', async () => {
  const team = await makeTeam(store, cwd)
  await store.confirm(team.id)
  const captain = await finishCaptain(store, sessions, team)
  assert.equal(captain.status, 'done')
  assert.deepEqual(captain.qualityWarnings, [])
})