import test from 'node:test'
import assert from 'node:assert/strict'
import { makeStore, makeTeam, finishCaptain } from '../test-support/helpers.mjs'

const { store, sessions, prompts, cwd, ctx } = await makeStore()

function promptsFor(sessionId) {
  return prompts.filter(item => item.sessionId === sessionId)
}

function forceSilent(member, ms) {
  member.status = 'running'
  member.taskTurnOpen = true
  member.startedAt = Date.now() - ms
  store.live.set(member.sessionId, {
    progress: '',
    tool: null,
    at: Date.now() - ms,
    recent: [],
    tokens: 0,
  })
}

test('a silent turn is cancelled and retried once with a resume note', async () => {
  const team = await makeTeam(store, cwd)
  await store.confirm(team.id)
  const captain = team.members.find(member => member.role === 'captain')
  forceSilent(captain, 9 * 60 * 1000)

  const cancels = []
  const originalGet = ctx.agents.get
  ctx.agents.get = id => (id === captain.sessionId
    ? { id, cancel: reason => cancels.push(reason) }
    : originalGet(id))

  const before = promptsFor(captain.sessionId).length
  const handled = await store.watchdog()
  ctx.agents.get = originalGet

  assert.equal(handled, 1)
  assert.equal(captain.stallRetries, 1)
  assert.equal(captain.status, 'running')
  assert.ok(cancels.includes('stalled'))
  const sent = promptsFor(captain.sessionId).slice(before)
  assert.equal(sent.length, 1)
  assert.match(sent[0].text, /【停滞恢复】/)
})

test('a second stall is not retried again and fails the member', async () => {
  const team = await makeTeam(store, cwd)
  await store.confirm(team.id)
  const captain = team.members.find(member => member.role === 'captain')

  const originalGet = ctx.agents.get
  ctx.agents.get = id => (id === captain.sessionId
    ? { id, cancel: () => {} }
    : originalGet(id))

  forceSilent(captain, 9 * 60 * 1000)
  await store.watchdog()
  assert.equal(captain.stallRetries, 1)
  assert.equal(captain.status, 'running')

  forceSilent(captain, 9 * 60 * 1000)
  const before = promptsFor(captain.sessionId).length
  await store.watchdog()
  ctx.agents.get = originalGet

  assert.equal(captain.status, 'failed')
  assert.equal(captain.error, 'stalled')
  assert.equal(captain.stallRetries, 1)
  assert.equal(promptsFor(captain.sessionId).length, before)
  assert.ok(team.audit.some(item => item.action === 'stall' && item.summary.includes('停滞未恢复')))
})

test('budget exhaustion stops the automatic retry', async () => {
  const team = await makeTeam(store, cwd)
  await store.setBudget(team.id, 1000)
  await store.confirm(team.id)
  const captain = team.members.find(member => member.role === 'captain')
  captain.tokens = 1200
  forceSilent(captain, 9 * 60 * 1000)

  const originalGet = ctx.agents.get
  ctx.agents.get = id => (id === captain.sessionId ? { id, cancel: () => {} } : originalGet(id))
  const before = promptsFor(captain.sessionId).length
  await store.watchdog()
  ctx.agents.get = originalGet

  assert.equal(captain.status, 'failed')
  assert.equal(promptsFor(captain.sessionId).length, before)
  assert.ok(team.audit.some(item => item.action === 'stall' && item.summary.includes('预算用尽')))
})

test('skipping a member lets downstream start and says so in its prompt', async () => {
  const team = await makeTeam(store, cwd, {
    auto: true,
    members: [
      { role: 'captain', name: '队长', kind: 'captain', task: '拆解任务', deps: [] },
      { role: 'member-1', name: '队员一', kind: 'member', task: '执行第一段', deps: ['captain'] },
      { role: 'member-2', name: '队员二', kind: 'member', task: '执行第二段', deps: ['member-1'] },
    ],
  })
  await store.confirm(team.id)
  await finishCaptain(store, sessions, team)

  const first = team.members.find(member => member.role === 'member-1')
  const second = team.members.find(member => member.role === 'member-2')
  assert.equal(first.status, 'running')

  const skipped = await store.skip(team.id, 'member-1')
  assert.equal(skipped.ok, true)
  assert.equal(first.status, 'skipped')
  assert.equal(second.status, 'running')
  const sent = promptsFor(second.sessionId)
  assert.match(sent[sent.length - 1].text, /已跳过，没有交接/)
})