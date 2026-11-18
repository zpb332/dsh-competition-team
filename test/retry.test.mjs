import test from 'node:test'
import assert from 'node:assert/strict'

// Retries must be fast in tests; the constant is read at module load.
process.env.COMPETITION_RETRY_MS = '20'
const { makeStore, makeTeam } = await import('../test-support/helpers.mjs')
const { store, sessions, prompts, cwd, mod } = await makeStore()

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function waitFor(predicate, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition')
    await sleep(10)
  }
}

function promptsFor(sessionId) {
  return prompts.filter(item => item.sessionId === sessionId)
}

test('classifyError separates transient from permanent failures', () => {
  assert.equal(mod.classifyError(Object.assign(new Error('429'), { status: 429 })).transient, true)
  assert.equal(mod.classifyError(new Error('ECONNRESET socket hang up')).transient, true)
  assert.equal(mod.classifyError(new Error('503 Service Unavailable')).transient, true)
  assert.equal(mod.classifyError(Object.assign(new Error('401'), { status: 401 })).code, 'auth')
  assert.equal(mod.classifyError(new Error('model not found')).code, 'model-missing')
  assert.equal(mod.classifyError(new Error('aborted by user')).code, 'cancelled')
})

test('a transient agent error schedules a retry and resumes the member', async () => {
  const team = await makeTeam(store, cwd)
  await store.confirm(team.id)
  const captain = team.members.find(member => member.role === 'captain')
  const before = promptsFor(captain.sessionId).length

  await store.onAgentError({ id: captain.sessionId }, Object.assign(new Error('429 rate limit'), { status: 429 }))
  assert.equal(captain.status, 'retrying')
  assert.equal(captain.retryAttempts, 1)
  assert.equal(store.snapshotFor(team, []).status, 'running')

  await waitFor(() => captain.status === 'running')
  const sent = promptsFor(captain.sessionId).slice(before)
  assert.equal(sent.length, 1)
  assert.match(sent[0].text, /【网络重试】/)
})

test('a permanent error fails immediately without retrying', async () => {
  const team = await makeTeam(store, cwd)
  await store.confirm(team.id)
  const captain = team.members.find(member => member.role === 'captain')
  const before = promptsFor(captain.sessionId).length

  await store.onAgentError({ id: captain.sessionId }, Object.assign(new Error('401 unauthorized'), { status: 401 }))
  assert.equal(captain.status, 'failed')
  assert.equal(captain.error, 'auth')
  assert.equal(captain.retryAttempts, 0)
  await sleep(60)
  assert.equal(promptsFor(captain.sessionId).length, before)
})

test('transient retries stop after two attempts', async () => {
  const team = await makeTeam(store, cwd)
  await store.confirm(team.id)
  const captain = team.members.find(member => member.role === 'captain')
  const fail = () => store.onAgentError(
    { id: captain.sessionId },
    Object.assign(new Error('503 Service Unavailable'), { status: 503 }),
  )

  await fail()
  assert.equal(captain.retryAttempts, 1)
  await waitFor(() => captain.status === 'running')

  await fail()
  assert.equal(captain.retryAttempts, 2)
  assert.equal(captain.status, 'retrying')
  await waitFor(() => captain.status === 'running')

  await fail()
  assert.equal(captain.status, 'failed')
  assert.equal(captain.error, 'transient-exhausted')
})

test('budget exhaustion disables the transient retry', async () => {
  const team = await makeTeam(store, cwd)
  await store.setBudget(team.id, 1000)
  await store.confirm(team.id)
  const captain = team.members.find(member => member.role === 'captain')
  captain.tokens = 1200
  const before = promptsFor(captain.sessionId).length

  await store.onAgentError({ id: captain.sessionId }, Object.assign(new Error('500'), { status: 500 }))
  assert.equal(captain.status, 'failed')
  assert.equal(captain.error, 'transient-exhausted')
  assert.equal(captain.retryAttempts, 0)
  await sleep(60)
  assert.equal(promptsFor(captain.sessionId).length, before)
})