/** Kahn topological order; a leftover means a cycle. */
export function topoOrder(members) {
  const indegree = new Map()
  const children = new Map(members.map(member => [member.role, []]))
  for (const member of members) indegree.set(member.role, 0)
  for (const member of members) {
    for (const dep of member.deps) {
      if (!children.has(dep)) continue
      indegree.set(member.role, (indegree.get(member.role) || 0) + 1)
      children.get(dep).push(member.role)
    }
  }
  const queue = members.filter(member => (indegree.get(member.role) || 0) === 0).map(member => member.role)
  const order = []
  while (queue.length > 0) {
    const id = queue.shift()
    order.push(id)
    for (const child of children.get(id) || []) {
      const next = (indegree.get(child) || 0) - 1
      indegree.set(child, next)
      if (next === 0) queue.push(child)
    }
  }
  return { ok: order.length === members.length, order }
}

/** Structural checks a confirmed workflow must pass. */
export function validateWorkflow(members) {
  const errors = []
  if (!Array.isArray(members) || members.length === 0) return { ok: false, errors: ['empty-roster'] }
  const ids = new Set(members.map(member => member.role))
  const captains = members.filter(member => member.kind === 'captain')
  if (captains.length !== 1) errors.push('need-exactly-one-captain')
  if (members.length < 2) errors.push('need-more-members')
  for (const member of members) {
    for (const dep of member.deps) {
      if (dep === member.role) errors.push(`self-dependency:${member.role}`)
      else if (!ids.has(dep)) errors.push(`missing-dependency:${member.role}->${dep}`)
    }
  }
  if (!topoOrder(members).ok) errors.push('cycle')
  return { ok: errors.length === 0, errors }
}

/** Parse the structured hand-off block; free-form notes stay valid but unverified. */
export function parseHandoff(text) {
  const source = typeof text === 'string' ? text : ''
  const match = /<!--\s*competition-team\s*([\s\S]*?)-->/i.exec(source)
  if (!match) return { meta: null, format: source.trim() ? 'legacy' : 'none' }
  try {
    return { meta: JSON.parse(match[1].trim()), format: 'structured' }
  } catch {
    return { meta: null, format: 'malformed' }
  }
}

/** The metadata block this plugin writes when the member did not. */
export function handoffBlock(member, artifacts, verdict) {
  const meta = {
    role: member.role,
    status: 'done',
    artifacts: artifacts.map(file => 'artifacts/' + file.rel),
    verdict: verdict || null,
    blockers: [],
    writtenBy: 'competition-team',
  }
  return '<!-- competition-team' + String.fromCharCode(10) + JSON.stringify(meta, null, 2) + String.fromCharCode(10) + '-->'
}

/** Parse the captain's machine-readable per-member task book. */
export function parseAssignmentsDetailed(text) {
  const source = typeof text === 'string' ? text : ''
  const match = /<!--\s*competition-team-assignments\s*([\s\S]*?)-->/i.exec(source)
  if (!match) return { assignments: [], warnings: [] }
  let parsed
  try {
    parsed = JSON.parse(match[1].trim())
  } catch {
    return { assignments: [], warnings: ['malformed-json'] }
  }
  if (!Array.isArray(parsed)) return { assignments: [], warnings: ['not-array'] }
  const assignments = []
  const warnings = []
  for (const item of parsed.slice(0, 100)) {
    if (!item || typeof item.role !== 'string' || typeof item.task !== 'string') {
      warnings.push('bad-entry')
      continue
    }
    const role = item.role.trim()
    const task = item.task.trim().slice(0, 4000)
    if (!role) {
      warnings.push('bad-entry')
      continue
    }
    if (task.length < 4) {
      warnings.push('task-too-short:' + role)
      continue
    }
    assignments.push({ role, task })
    if (assignments.length >= 20) break
  }
  return { assignments, warnings }
}

export function parseAssignments(text) {
  return parseAssignmentsDetailed(text).assignments
}