import test from 'node:test'
import assert from 'node:assert/strict'
import { makeStore, makeTeam, finishCaptain } from '../test-support/helpers.mjs'

const { store, sessions, cwd } = await makeStore()

const chain = [
  { role: 'captain', name: '队长', kind: 'captain', task: '负责拆解任务', deps: [] },
  { role: 'member-1', name: '队员一', kind: 'member', task: '负责第一段实现', deps: ['captain'] },
  { role: 'member-2', name: '队员二', kind: 'member', task: '负责第二段实现', deps: ['member-1'] },
]

function members(team) {
  return Object.fromEntries(team.members.map(member => [member.role, member]))
}

async function failCaptain(team) {
  const captain = members(team).captain
  await store.onAgentError({ id: captain.sessionId }, Object.assign(new Error('401 unauthorized'), { status: 401 }))
  return captain
}

test('a permanent failure blocks every pending descendant, transitively', async () => {
  const team = await makeTeam(store, cwd, { auto: false, members: chain })
  await store.confirm(team.id)
  const captain = await failCaptain(team)
  const byRole = members(team)

  assert.equal(captain.status, 'failed')
  assert.equal(byRole['member-1'].status, 'blocked')
  assert.equal(byRole['member-1'].error, 'upstream-failed:captain')
  assert.equal(byRole['member-2'].status, 'blocked')
  assert.equal(byRole['member-2'].error, 'upstream-failed:member-1')
  assert.equal(store.snapshotFor(team, []).status, 'blocked')
})

test('retrying the failed upstream returns blocked descendants to pending', async () => {
  const team = await makeTeam(store, cwd, { auto: false, members: chain })
  await store.confirm(team.id)
  await failCaptain(team)

  const started = await store.start(team.id, 'captain')
  assert.equal(started.ok, true)
  const byRole = members(team)
  assert.equal(byRole.captain.status, 'running')
  assert.equal(byRole['member-1'].status, 'pending')
  assert.equal(byRole['member-2'].status, 'pending')

  await finishCaptain(store, sessions, team)
  assert.equal(byRole.captain.status, 'done')
  const next = await store.start(team.id, 'member-1')
  assert.equal(next.ok, true)
  assert.equal(byRole['member-1'].status, 'running')
})

test('skipping the failed upstream unblocks and starts the next member', async () => {
  const team = await makeTeam(store, cwd, { auto: true, members: chain })
  await store.confirm(team.id)
  await failCaptain(team)
  const byRole = members(team)
  assert.equal(byRole['member-1'].status, 'blocked')

  const result = await store.skip(team.id, 'captain')
  assert.equal(result.ok, true)
  assert.equal(byRole.captain.status, 'skipped')
  assert.equal(byRole['member-1'].status, 'running')
  assert.equal(byRole['member-2'].status, 'pending')
})