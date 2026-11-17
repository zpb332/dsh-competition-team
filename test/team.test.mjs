import test from 'node:test'
import assert from 'node:assert/strict'
import { makeStore, makeTeam, finishCaptain, assistantEvent } from '../test-support/helpers.mjs'

const { store, sessions, prompts, cwd } = await makeStore()

function promptsFor(sessionId) {
  return prompts.filter(item => item.sessionId === sessionId)
}

test('preflight rejects a short brief before creating any session', async () => {
  const team = await makeTeam(store, cwd, { brief: '短' })
  const before = prompts.length
  const result = await store.confirm(team.id)
  assert.equal(result.ok, false)
  assert.equal(result.error, 'preflight-failed')
  assert.deepEqual(result.details, ['brief-empty'])
  assert.equal(prompts.length, before)
  assert.equal(team.confirmed, false)
})

test('confirm starts the captain with the hand-off protocol', async () => {
  const team = await makeTeam(store, cwd)
  const result = await store.confirm(team.id)
  assert.equal(result.ok, true)
  assert.deepEqual(result.started, ['captain'])
  const captain = team.members.find(member => member.role === 'captain')
  assert.equal(captain.status, 'running')
  const sent = promptsFor(captain.sessionId)
  assert.equal(sent.length, 1)
  assert.match(sent[0].text, /【竞赛智队 · 队长】/)
  assert.match(sent[0].text, /handoffs[\\/]captain\.md/)
})

test('a turn without hand-off or artifact is retried once, then blocked', async () => {
  const team = await makeTeam(store, cwd)
  await store.confirm(team.id)
  const captain = team.members.find(member => member.role === 'captain')
  const session = sessions.get(captain.sessionId)

  await store.onSessionEvent(session, { type: 'turn/end' })
  assert.equal(captain.status, 'running')
  assert.equal(captain.guardRetries, 1)
  assert.equal(promptsFor(captain.sessionId).length, 2)

  await store.onSessionEvent(session, { type: 'turn/end' })
  assert.equal(captain.status, 'blocked')
  assert.equal(captain.error, 'no-output')
})

test('a structured hand-off with a real artifact is accepted', async () => {
  const team = await makeTeam(store, cwd)
  await store.confirm(team.id)
  const captain = await finishCaptain(store, sessions, team)
  assert.equal(captain.status, 'done')
  assert.equal(captain.handoffFormat, 'structured')
  assert.equal(team.members.find(member => member.role === 'member-1').status, 'pending')
})

test('a read-only reviewer writes through the plugin and its verdict lands on the team', async () => {
  const team = await makeTeam(store, cwd, {
    members: [
      { role: 'captain', name: '队长', kind: 'captain', task: '拆解任务', deps: [] },
      { role: 'reviewer', name: '审核员', kind: 'member', task: '审核产物', deps: ['captain'], readOnly: true },
    ],
  })
  await store.confirm(team.id)
  await finishCaptain(store, sessions, team)

  const reviewer = team.members.find(member => member.role === 'reviewer')
  const started = await store.start(team.id, 'reviewer')
  assert.equal(started.ok, true)
  assert.equal(reviewer.readOnlyApplied, true)

  const session = sessions.get(reviewer.sessionId)
  assert.ok(session.appended.some(item => item.type === 'sandbox/mode' && item.data.mode === 'read-only'))
  assert.ok(session.appended.some(item => item.type === 'approval/policy' && item.data.policy === 'never'))

  session.events.push(assistantEvent(
    '<!-- competition-team\n'
    + '{"role":"reviewer","status":"done","artifacts":[],"verdict":"pass","blockers":[]}\n'
    + '-->\n结论：通过',
  ))
  await store.onSessionEvent(session, { type: 'turn/end' })

  assert.equal(reviewer.status, 'done')
  assert.equal(team.verdict, 'pass')
  assert.equal(team.verdictRole, 'reviewer')
})

test('a member proposal does not run until the user approves it', async () => {
  const team = await makeTeam(store, cwd)
  await store.confirm(team.id)
  const captain = await finishCaptain(store, sessions, team)
  const member = team.members.find(member => member.role === 'member-1')

  const proposal = await store.propose(team, '队长', 'dispatch', {
    role: 'member-1',
    task: '写丙',
    reason: '测试',
  })
  assert.equal(proposal.pending, true)
  assert.equal(member.status, 'pending')

  const approved = await store.decideProposal(team.id, proposal.proposalId, 'approve')
  assert.equal(approved.ok, true)
  assert.equal(approved.proposal.status, 'approved')
  assert.equal(member.status, 'running')
  assert.ok(promptsFor(member.sessionId).some(item => item.text.includes('【队长派活')))
  assert.ok(promptsFor(captain.sessionId).some(item => item.text.includes('【提案结果】')))
})

test('approving after the target task changed marks the proposal stale', async () => {
  const team = await makeTeam(store, cwd)
  await store.confirm(team.id)
  await finishCaptain(store, sessions, team)

  const proposal = await store.propose(team, '队长', 'dispatch', { role: 'member-1', task: '写丙' })
  await store.dispatch(team.id, 'member-1', { task: '写丁' })

  const result = await store.decideProposal(team.id, proposal.proposalId, 'approve')
  assert.equal(result.ok, false)
  assert.equal(result.error, 'proposal-stale')
  assert.deepEqual(result.conflicts, ['task-changed'])
  assert.equal(result.proposal.status, 'stale')
})

test('a proposal past its TTL expires instead of running', async () => {
  const team = await makeTeam(store, cwd)
  await store.confirm(team.id)
  await finishCaptain(store, sessions, team)

  const proposal = await store.propose(team, '队长', 'dispatch', { role: 'member-1', task: '写丙' })
  const stored = team.proposals.find(item => item.id === proposal.proposalId)
  stored.createdAt = Date.now() - 31 * 60 * 1000

  const result = await store.decideProposal(team.id, proposal.proposalId, 'approve')
  assert.equal(result.ok, false)
  assert.equal(result.error, 'proposal-expired')
  assert.equal(stored.status, 'expired')
})

test('a burst of feedback becomes one merged captain turn', async () => {
  const team = await makeTeam(store, cwd)
  await store.confirm(team.id)
  const captain = await finishCaptain(store, sessions, team)

  await store.feedback(team.id, '意见一')
  await store.feedback(team.id, '意见二')
  assert.equal(team.feedbackQueue.length, 2)

  for (const timer of store.feedbackTimers.values()) clearTimeout(timer)
  store.feedbackTimers.clear()

  const before = promptsFor(captain.sessionId).length
  await store.flushFeedback(team.id)
  assert.equal(team.feedbackQueue.length, 0)
  assert.equal(team.feedback.length, 2)
  const sent = promptsFor(captain.sessionId).slice(before)
  assert.equal(sent.length, 1)
  assert.match(sent[0].text, /【用户意见】/)
  assert.match(sent[0].text, /意见一/)
  assert.match(sent[0].text, /意见二/)
})

test('watchdog marks a silent running member and an event recovers it', async () => {
  const team = await makeTeam(store, cwd)
  await store.confirm(team.id)
  await finishCaptain(store, sessions, team)

  const member = team.members.find(item => item.role === 'member-1')
  member.status = 'running'
  member.taskTurnOpen = true
  member.startedAt = Date.now() - 9 * 60 * 1000
  member.sessionId = 's-recover'
  // reconcile() must treat the turn as live; only the watchdog may flag it.
  const originalAgentGet = store.ctx.agents.get
  store.ctx.agents.get = id => (id === 's-recover' ? { id } : originalAgentGet(id))

  const marked = await store.watchdog()
  assert.ok(marked >= 1)
  // The watchdog now retries once instead of only flagging the member.
  assert.equal(member.status, 'running')
  assert.equal(member.stallRetries, 1)

  // A member flagged stalled by an older path still recovers on the next event.
  member.status = 'stalled'
  member.error = 'stalled'
  store.bySession.set('s-recover', { teamId: team.id, role: member.role })
  store.stalled.add('s-recover')
  await store.onSessionEvent({ id: 's-recover' }, { type: 'tool/call' })

  assert.equal(member.status, 'running')
  assert.equal(member.error, null)
})

test('the default roster reports to the captain and reads its task book', async () => {
  const team = await store.create({
    title: '默认队',
    brief: '这是一个用于默认组织结构测试的题目描述。',
    cwd,
  })
  const captain = team.members.find(member => member.kind === 'captain')
  const others = team.members.filter(member => member.kind !== 'captain')
  for (const member of others) {
    assert.ok(member.deps.includes('captain'), member.role + ' should report to the captain')
  }

  const memberPrompt = store.buildPrompt(team, others[0])
  assert.match(memberPrompt, /直属上级是队长/)
  assert.match(memberPrompt, /artifacts[\\/]captain[\\/]plan\.md/)

  const captainPrompt = store.buildPrompt(team, captain)
  assert.match(captainPrompt, /所有成员的直属上级/)
  assert.match(captainPrompt, /plan\.md/)
})
