import test from 'node:test'
import assert from 'node:assert/strict'
import { makeStore, makeTeam, finishCaptain } from '../test-support/helpers.mjs'

const { store, sessions, prompts, cwd } = await makeStore()

function promptsFor(sessionId) {
  return prompts.filter(item => item.sessionId === sessionId)
}

test('a host reload marks a live turn interrupted and startup resumes it once', async () => {
  const team = await makeTeam(store, cwd)
  await store.confirm(team.id)
  const captain = team.members.find(member => member.role === 'captain')
  assert.equal(captain.status, 'running')

  // No live Agent means the turn died with the previous host process.
  await store.loadAll()
  assert.equal(captain.status, 'failed')
  assert.equal(captain.error, 'interrupted')

  const before = promptsFor(captain.sessionId).length
  const resumed = await store.resumeTeams()
  assert.equal(resumed, 1)
  assert.equal(captain.status, 'running')
  assert.equal(captain.resumeAttempts, 1)
  const sent = promptsFor(captain.sessionId).slice(before)
  assert.equal(sent.length, 1)
  assert.match(sent[0].text, /【中断恢复】/)
})

test('a second interruption is not auto-resumed again', async () => {
  const team = await makeTeam(store, cwd)
  await store.confirm(team.id)
  const captain = team.members.find(member => member.role === 'captain')

  await store.loadAll()
  await store.resumeTeams()
  assert.equal(captain.status, 'running')
  assert.equal(captain.resumeAttempts, 1)

  await store.loadAll()
  assert.equal(captain.status, 'failed')
  assert.equal(captain.error, 'interrupted')
  const before = promptsFor(captain.sessionId).length
  const resumed = await store.resumeTeams()
  assert.equal(resumed, 0)
  assert.equal(captain.status, 'failed')
  assert.equal(promptsFor(captain.sessionId).length, before)
})

test('budget exhaustion stops interrupted resume', async () => {
  const team = await makeTeam(store, cwd)
  await store.setBudget(team.id, 1000)
  await store.confirm(team.id)
  const captain = team.members.find(member => member.role === 'captain')
  captain.tokens = 1200

  await store.loadAll()
  assert.equal(captain.error, 'interrupted')
  const before = promptsFor(captain.sessionId).length
  const resumed = await store.resumeTeams()

  assert.equal(resumed, 0)
  assert.equal(captain.status, 'failed')
  assert.equal(promptsFor(captain.sessionId).length, before)
})

test('startup self-heal continues ready pending members', async () => {
  const team = await makeTeam(store, cwd, { auto: true })
  await store.confirm(team.id)
  team.auto = false
  await finishCaptain(store, sessions, team)

  const member = team.members.find(item => item.role === 'member-1')
  assert.equal(member.status, 'pending')
  team.auto = true

  const resumed = await store.resumeTeams()
  assert.ok(resumed >= 1)
  assert.equal(member.status, 'running')
  const sent = promptsFor(member.sessionId)
  assert.equal(sent.length, 1)
  assert.match(sent[0].text, /【竞赛智队 · 队员】/)
})

test('startup self-heal leaves drafts and stopped teams alone', async () => {
  const draft = await makeTeam(store, cwd, { auto: true })
  const resumed = await store.resumeTeams()
  assert.equal(draft.confirmed, false)
  assert.ok(resumed >= 0)
  assert.equal(draft.members[0].status, 'pending')
})
test('startup self-heal does not start a never-started confirmed team', async () => {
  const team = await makeTeam(store, cwd, { auto: true })
  team.confirmed = true
  team.startedOnce = false

  const resumed = await store.resumeTeams()
  assert.equal(resumed, 0)
  assert.equal(team.members[0].status, 'pending')
})
