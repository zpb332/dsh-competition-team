import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeStore, makeTeam, finishCaptain } from '../test-support/helpers.mjs'

const { store, sessions, prompts, cwd, mod } = await makeStore()

function promptsFor(sessionId) {
  return prompts.filter(item => item.sessionId === sessionId)
}

async function writePlan(team, assignments) {
  await writeFile(
    join(team.root, 'artifacts', 'captain', 'plan.md'),
    '# 计划\n\n<!-- competition-team-assignments\n'
      + JSON.stringify(assignments, null, 2)
      + '\n-->\n',
    'utf8',
  )
}

test('parseAssignments reads and filters the task book block', () => {
  const text = '<!-- competition-team-assignments\n'
    + '[{"role":"core-a","task":"写模型文件"},{"role":"core-b","task":"x"},{"task":"无角色"}]'
    + '\n-->'
  const parsed = mod.parseAssignments(text)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].role, 'core-a')
  assert.equal(mod.parseAssignments('no block').length, 0)
  assert.equal(mod.parseAssignments('<!-- competition-team-assignments not-json -->').length, 0)
})

test('the captain task book becomes one proposal and pauses dispatch until approved', async () => {
  const team = await makeTeam(store, cwd, {
    auto: true,
    members: [
      { role: 'captain', name: '队长', kind: 'captain', task: '拆解任务', deps: [] },
      { role: 'member-1', name: '队员', kind: 'member', task: '执行旧任务', deps: ['captain'] },
    ],
  })
  await store.confirm(team.id)
  await writePlan(team, [{ role: 'member-1', task: '按任务书写的新任务' }])
  await finishCaptain(store, sessions, team)

  const proposals = team.proposals.filter(item => item.type === 'assignments')
  assert.equal(proposals.length, 1)
  assert.equal(proposals[0].status, 'pending')
  assert.equal(proposals[0].assignments[0].role, 'member-1')
  const member = team.members.find(item => item.role === 'member-1')
  assert.equal(member.status, 'pending')
  assert.equal(member.task, '执行旧任务')

  const approved = await store.decideProposal(team.id, proposals[0].id, 'approve')
  assert.equal(approved.ok, true)
  assert.equal(member.task, '按任务书写的新任务')
  assert.equal(member.taskSource, 'captain')
  assert.equal(member.status, 'running')
  assert.ok(promptsFor(member.sessionId).some(item => item.text.includes('按任务书写的新任务')))
  assert.ok(team.audit.some(item => item.action === 'assign'))
})

test('rejecting the task book keeps the old tasks and resumes the normal flow', async () => {
  const team = await makeTeam(store, cwd, {
    auto: true,
    members: [
      { role: 'captain', name: '队长', kind: 'captain', task: '拆解任务', deps: [] },
      { role: 'member-1', name: '队员', kind: 'member', task: '执行旧任务', deps: ['captain'] },
    ],
  })
  await store.confirm(team.id)
  await writePlan(team, [{ role: 'member-1', task: '不该生效的任务' }])
  await finishCaptain(store, sessions, team)

  const proposal = team.proposals.find(item => item.type === 'assignments')
  const rejected = await store.decideProposal(team.id, proposal.id, 'reject')
  assert.equal(rejected.ok, true)
  const member = team.members.find(item => item.role === 'member-1')
  assert.equal(member.task, '执行旧任务')
  assert.equal(member.status, 'running')
  assert.ok(promptsFor(member.sessionId).some(item => item.text.includes('旧任务')))
})

test('an unchanged task book creates no proposal', async () => {
  const team = await makeTeam(store, cwd, {
    auto: true,
    members: [
      { role: 'captain', name: '队长', kind: 'captain', task: '拆解任务', deps: [] },
      { role: 'member-1', name: '队员', kind: 'member', task: '执行旧任务', deps: ['captain'] },
    ],
  })
  await store.confirm(team.id)
  await writePlan(team, [{ role: 'member-1', task: '执行旧任务' }])
  await finishCaptain(store, sessions, team)

  assert.equal((team.proposals || []).filter(item => item.type === 'assignments').length, 0)
  assert.equal(team.members.find(item => item.role === 'member-1').status, 'running')
})
test('parseAssignmentsDetailed reports malformed, short and non-array payloads', () => {
  assert.deepEqual(mod.parseAssignmentsDetailed('no block').warnings, [])
  assert.deepEqual(mod.parseAssignmentsDetailed('<!-- competition-team-assignments {bad -->').warnings, ['malformed-json'])
  assert.deepEqual(mod.parseAssignmentsDetailed('<!-- competition-team-assignments {"a":1} -->').warnings, ['not-array'])
  const short = mod.parseAssignmentsDetailed('<!-- competition-team-assignments [{"role":"core-a","task":"x"}] -->')
  assert.deepEqual(short.warnings, ['task-too-short:core-a'])
  assert.equal(short.assignments.length, 0)
})

test('unknown roles and short tasks are surfaced while valid entries still propose', async () => {
  const team = await makeTeam(store, cwd, {
    auto: false,
    members: [
      { role: 'captain', name: '队长', kind: 'captain', task: '拆解任务', deps: [] },
      { role: 'member-1', name: '队员', kind: 'member', task: '执行旧任务', deps: ['captain'] },
    ],
  })
  await store.confirm(team.id)
  await writePlan(team, [
    { role: 'member-1', task: '执行任务书里的新任务' },
    { role: 'ghost', task: '不存在的成员任务' },
    { role: 'member-1', task: 'x' },
  ])
  await finishCaptain(store, sessions, team)

  const proposal = team.proposals.find(item => item.type === 'assignments')
  assert.ok(proposal)
  assert.equal(proposal.assignments.length, 1)
  assert.equal(proposal.assignments[0].role, 'member-1')
  assert.ok(team.assignmentCheck.warnings.some(code => code.startsWith('unknown-role:ghost')))
  assert.ok(team.assignmentCheck.warnings.some(code => code.startsWith('task-too-short:member-1')))
})

test('a plan without the machine block is reported and creates no proposal', async () => {
  const team = await makeTeam(store, cwd, {
    auto: false,
    members: [
      { role: 'captain', name: '队长', kind: 'captain', task: '拆解任务', deps: [] },
      { role: 'member-1', name: '队员', kind: 'member', task: '执行旧任务', deps: ['captain'] },
    ],
  })
  await store.confirm(team.id)
  await writeFile(join(team.root, 'artifacts', 'captain', 'plan.md'), '# 只有文字，没有机器块\n', 'utf8')
  await finishCaptain(store, sessions, team)

  assert.equal(team.proposals, undefined)
  assert.equal(team.assignmentCheck.hasPlan, true)
  assert.ok(team.assignmentCheck.warnings.includes('no-block'))
})

test('approving a task book while the member is running marks the task pending', async () => {
  const team = await makeTeam(store, cwd, {
    auto: true,
    members: [
      { role: 'captain', name: '队长', kind: 'captain', task: '拆解任务', deps: [] },
      { role: 'member-1', name: '队员', kind: 'member', task: '执行旧任务', deps: ['captain'] },
    ],
  })
  await store.confirm(team.id)
  await finishCaptain(store, sessions, team)
  const member = team.members.find(item => item.role === 'member-1')
  assert.equal(member.status, 'running')

  await writePlan(team, [{ role: 'member-1', task: '执行任务书里的新任务' }])
  const captain = team.members.find(item => item.role === 'captain')
  const proposal = await store.proposeAssignments(team, captain)
  assert.ok(proposal)
  await store.decideProposal(team.id, proposal.id, 'approve')
  assert.equal(member.task, '执行任务书里的新任务')
  assert.equal(member.taskPending, true)

  member.status = 'done'
  member.taskTurnOpen = false
  await store.start(team.id, 'member-1')
  assert.equal(member.taskPending, false)
})

test('assignment checks survive save/load and appear in the snapshot', async () => {
  const team = await makeTeam(store, cwd)
  team.confirmed = true
  team.assignmentCheck = { at: Date.now(), hasPlan: true, parsed: 1, changed: 1, warnings: ['no-block'] }
  await store.save(team)
  store.teams.delete(team.id)
  const loaded = await store.load(team.id)
  assert.deepEqual(loaded.assignmentCheck.warnings, ['no-block'])
  assert.equal(store.snapshotFor(loaded, []).assignmentCheck.hasPlan, true)
})
