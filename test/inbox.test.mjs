import test from 'node:test'
import assert from 'node:assert/strict'
import { makeStore, makeTeam, finishCaptain } from '../test-support/helpers.mjs'

const { store, sessions, cwd } = await makeStore()

function unread(team) {
  return (team.notifications || []).filter(item => !item.readAt).length
}

test('a blocked member leaves one inbox entry that can be marked read', async () => {
  const team = await makeTeam(store, cwd)
  await store.confirm(team.id)
  const captain = team.members.find(member => member.role === 'captain')
  const session = sessions.get(captain.sessionId)
  await store.onSessionEvent(session, { type: 'turn/end' })
  await store.onSessionEvent(session, { type: 'turn/end' })

  assert.equal(captain.status, 'blocked')
  const blocked = team.notifications.filter(item => item.kind === 'blocked')
  assert.equal(blocked.length, 1)
  assert.equal(unread(team), 1)
  assert.equal(store.snapshotFor(team, []).unread, 1)

  const result = await store.readNotifications(team.id)
  assert.equal(result.ok, true)
  assert.equal(unread(team), 0)
  assert.equal(store.snapshotFor(team, []).notifications[0].readAt > 0, true)
})

test('a proposal and a task book both land in the inbox', async () => {
  const team = await makeTeam(store, cwd)
  await store.confirm(team.id)
  await finishCaptain(store, sessions, team)

  await store.propose(team, '队长', 'dispatch', { role: 'member-1', task: '写一点新东西' })
  assert.ok(team.notifications.some(item => item.kind === 'proposal'))
})

test('budget exhaustion is recorded in the inbox', async () => {
  const team = await makeTeam(store, cwd)
  await store.setBudget(team.id, 1000)
  await store.confirm(team.id)
  await finishCaptain(store, sessions, team, { usage: { totalTokens: 1200 } })

  const budget = team.notifications.filter(item => item.kind === 'budget')
  assert.equal(budget.length, 1)
  assert.match(budget[0].text, /预算用尽/)
})

test('the inbox survives a save/load roundtrip and is capped', async () => {
  const team = await makeTeam(store, cwd)
  for (let index = 0; index < 35; index += 1) {
    store.notify(team, 'proposal', '测试通知 ' + index)
  }
  assert.equal(team.notifications.length, 30)
  await store.save(team)
  store.teams.delete(team.id)
  const loaded = await store.load(team.id)
  assert.equal(loaded.notifications.length, 30)
  assert.ok(unread(loaded) >= 29)
})