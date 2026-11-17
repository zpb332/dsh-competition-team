import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHandoff, handoffBlock, validateWorkflow } from '../index.js'

const captain = { role: 'captain', kind: 'captain', name: '队长', deps: [] }
const member = { role: 'member-1', kind: 'member', name: '队员', deps: ['captain'] }

test('parseHandoff reads a structured block', () => {
  const text = '<!-- competition-team\n{"role":"captain","status":"done","artifacts":["artifacts/captain/a.txt"],"verdict":"pass","blockers":[]}\n-->\n# 交接'
  const parsed = parseHandoff(text)
  assert.equal(parsed.format, 'structured')
  assert.equal(parsed.meta.verdict, 'pass')
  assert.deepEqual(parsed.meta.artifacts, ['artifacts/captain/a.txt'])
})

test('parseHandoff distinguishes legacy, malformed and empty notes', () => {
  assert.equal(parseHandoff('# 只有自然语言').format, 'legacy')
  assert.equal(parseHandoff('').format, 'none')
  assert.equal(parseHandoff('<!-- competition-team {broken -->').format, 'malformed')
})

test('handoffBlock emits JSON the parser can read back', () => {
  const block = handoffBlock(
    { role: 'member-1', name: '队员' },
    [{ rel: 'member-1/out.txt' }],
    'pass',
  )
  const parsed = parseHandoff(block)
  assert.equal(parsed.format, 'structured')
  assert.equal(parsed.meta.role, 'member-1')
  assert.deepEqual(parsed.meta.artifacts, ['artifacts/member-1/out.txt'])
  assert.equal(parsed.meta.verdict, 'pass')
})

test('validateWorkflow accepts a captain plus one dependent member', () => {
  const result = validateWorkflow([captain, member])
  assert.equal(result.ok, true)
  assert.deepEqual(result.errors, [])
})

test('validateWorkflow reports structural errors', () => {
  assert.deepEqual(validateWorkflow([]).errors, ['empty-roster'])
  assert.ok(validateWorkflow([member]).errors.includes('need-exactly-one-captain'))
  assert.ok(validateWorkflow([captain]).errors.includes('need-more-members'))
  assert.ok(validateWorkflow([captain, { ...member, deps: ['member-1'] }]).errors
    .some(error => error.startsWith('self-dependency:')))
  assert.ok(validateWorkflow([captain, { ...member, deps: ['ghost'] }]).errors
    .some(error => error.startsWith('missing-dependency:')))
  const cycle = validateWorkflow([
    { ...captain, deps: ['member-1'] },
    { ...member, deps: ['captain'] },
  ])
  assert.ok(cycle.errors.includes('cycle'))
})