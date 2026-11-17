import test from 'node:test'
import assert from 'node:assert/strict'
import { makeStore, makeTeam, finishCaptain } from '../test-support/helpers.mjs'

const { store, sessions, prompts, cwd } = await makeStore()

function promptsFor(sessionId) {
  return prompts.filter(item => item.sessionId === sessionId)
}

test('editing a pending proposal changes what approval executes', async () => {
  const team = await makeTeam(store, cwd)
  await store.confirm(team.id)
  await finishCaptain(store, sessions, team)
  const member = team.members.find(item => item.role === 'member-1')

  const proposal = await store.propose(team, '队长', 'dispatch', { role: 'member-1', task: '写旧任务' })
  const edited = await store.editProposal(team.id, proposal.proposalId, {
    task: '写新任务',
    note: '用户改过',
  })
  assert.equal(edited.ok, true)
  assert.equal(edited.proposal.task, '写新任务')
  assert.ok(edited.proposal.editedAt)

  const approved = await store.decideProposal(team.id, proposal.proposalId, 'approve')
  assert.equal(approved.ok, true)
  assert.equal(member.task, '写新任务')
  assert.ok(promptsFor(member.sessionId).some(item => item.text.includes('写新任务')))
  assert.ok(team.audit.some(item => item.action === 'edit'))
})

test('a proposal that is already decided cannot be edited', async () => {
  const team = await makeTeam(store, cwd)
  await store.confirm(team.id)
  await finishCaptain(store, sessions, team)

  const proposal = await store.propose(team, '队长', 'dispatch', { role: 'member-1', task: '写点东西' })
  await store.decideProposal(team.id, proposal.proposalId, 'reject')
  const edited = await store.editProposal(team.id, proposal.proposalId, { task: '改不了' })
  assert.equal(edited.ok, false)
  assert.equal(edited.error, 'proposal-done')
  assert.equal(edited.status, 'rejected')
})

test('editing an expired proposal marks it expired instead of changing it', async () => {
  const team = await makeTeam(store, cwd)
  await store.confirm(team.id)
  await finishCaptain(store, sessions, team)

  const proposal = await store.propose(team, '队长', 'dispatch', { role: 'member-1', task: '写点东西' })
  const stored = team.proposals.find(item => item.id === proposal.proposalId)
  stored.createdAt = Date.now() - 31 * 60 * 1000

  const edited = await store.editProposal(team.id, proposal.proposalId, { task: '改不了' })
  assert.equal(edited.ok, false)
  assert.equal(edited.error, 'proposal-expired')
  assert.equal(stored.status, 'expired')
})

test('the snapshot carries decided history and stale pending flags', async () => {
  const team = await makeTeam(store, cwd)
  await store.confirm(team.id)
  await finishCaptain(store, sessions, team)

  const rejected = await store.propose(team, '队长', 'dispatch', { role: 'member-1', task: '会被驳回' })
  await store.decideProposal(team.id, rejected.proposalId, 'reject')

  const pending = await store.propose(team, '队长', 'message', { role: 'member-1', note: '会过期' })
  const stored = team.proposals.find(item => item.id === pending.proposalId)
  stored.createdAt = Date.now() - 31 * 60 * 1000

  const snapshot = store.snapshotFor(team, [])
  const decided = snapshot.proposals.find(item => item.id === rejected.proposalId)
  assert.equal(decided.status, 'rejected')
  assert.ok(decided.decidedAt)
  const expired = snapshot.proposals.find(item => item.id === pending.proposalId)
  assert.equal(expired.status, 'pending')
  assert.equal(expired.expired, true)
})