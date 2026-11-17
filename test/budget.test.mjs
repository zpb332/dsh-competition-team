import test from 'node:test'
import assert from 'node:assert/strict'
import { makeStore, makeTeam, finishCaptain, assistantEvent } from '../test-support/helpers.mjs'

const { store, sessions, prompts, cwd } = await makeStore()

test('assistant usage is charged to the member and the team total', async () => {
  const team = await makeTeam(store, cwd)
  await store.confirm(team.id)
  const captain = await finishCaptain(store, sessions, team, {
    usage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 },
  })

  assert.equal(captain.status, 'done')
  assert.equal(captain.tokens, 1200)
  const snapshot = store.snapshotFor(team, [])
  assert.equal(snapshot.budget.used, 1200)
  assert.equal(snapshot.budget.state, 'ok')
  assert.equal(snapshot.members.find(member => member.role === 'captain').tokens, 1200)
})

test('usage falls back to input + output when totalTokens is absent', async () => {
  const team = await makeTeam(store, cwd)
  await store.confirm(team.id)
  const captain = await finishCaptain(store, sessions, team, {
    usage: { inputTokens: 100, outputTokens: 20 },
  })
  assert.equal(captain.tokens, 120)
})

test('crossing 80% sets the warned state exactly once', async () => {
  const team = await makeTeam(store, cwd)
  const budget = await store.setBudget(team.id, 1000)
  assert.equal(budget.ok, true)
  await store.confirm(team.id)
  await finishCaptain(store, sessions, team, { usage: { totalTokens: 800 } })

  assert.ok(team.budget.warnedAt)
  assert.equal(team.budget.exhaustedAt, null)
  assert.equal(store.snapshotFor(team, []).budget.state, 'warned')
  assert.equal(team.audit.filter(item => item.action === 'budget' && item.summary.includes('80%')).length, 1)
})

test('exhausting the budget blocks starts and feedback until it is raised', async () => {
  const team = await makeTeam(store, cwd)
  await store.setBudget(team.id, 1000)
  await store.confirm(team.id)
  await finishCaptain(store, sessions, team, { usage: { totalTokens: 1200 } })

  assert.ok(team.budget.exhaustedAt)
  assert.equal(store.snapshotFor(team, []).budget.state, 'exhausted')

  const blockedStart = await store.start(team.id, 'member-1')
  assert.equal(blockedStart.ok, false)
  assert.equal(blockedStart.error, 'budget-exhausted')

  const blockedFeedback = await store.feedback(team.id, '还想补一句')
  assert.equal(blockedFeedback.ok, false)
  assert.equal(blockedFeedback.error, 'budget-exhausted')

  assert.deepEqual(await store.startReady(team), [])

  const raised = await store.setBudget(team.id, 5000)
  assert.equal(raised.ok, true)
  assert.equal(store.snapshotFor(team, []).budget.state, 'ok')
  const started = await store.start(team.id, 'member-1')
  assert.equal(started.ok, true)
  assert.equal(team.members.find(member => member.role === 'member-1').status, 'running')
})

test('a live turn counts toward the total before turn end', async () => {
  const team = await makeTeam(store, cwd)
  await store.confirm(team.id)
  const captain = team.members.find(member => member.role === 'captain')
  const session = sessions.get(captain.sessionId)

  await store.onSessionEvent(session, {
    type: 'assistant/message',
    data: {
      message: { content: [{ type: 'text', text: '还在跑' }] },
      usage: { totalTokens: 300 },
    },
  })

  assert.equal(store.snapshotFor(team, []).budget.used, 300)
  assert.equal(store.snapshotFor(team, []).members.find(member => member.role === 'captain').tokens, 300)
})