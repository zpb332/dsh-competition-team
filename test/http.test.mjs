import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'

process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'ct-http-home-'))
const { makeHost } = await import('../test-support/host.mjs')
const { handler } = await makeHost()
const cwd = await mkdtemp(join(tmpdir(), 'ct-http-cwd-'))

const HOST = '127.0.0.1:51949'
const ORIGIN = 'http://' + HOST

class FakeResponse extends Writable {
  constructor() {
    super()
    this.status = 0
    this.headers = {}
    this.chunks = []
  }

  _write(chunk, _encoding, callback) {
    this.chunks.push(Buffer.from(chunk))
    callback()
  }

  writeHead(status, headers) {
    this.status = status
    this.headers = headers || {}
  }

  end(chunk, ...rest) {
    if (chunk) this.chunks.push(Buffer.from(chunk))
    return super.end(...rest)
  }

  get body() {
    return Buffer.concat(this.chunks).toString('utf8')
  }

  json() {
    return JSON.parse(this.body)
  }
}

async function call({ method = 'GET', path, headers = {}, body = '' } = {}) {
  const request = Readable.from(body ? [Buffer.from(body)] : [])
  request.method = method
  request.url = path
  request.headers = { host: HOST, ...headers }
  const response = new FakeResponse()
  const finished = new Promise((resolve, reject) => {
    response.on('finish', () => resolve(response))
    response.on('error', reject)
  })
  handler(request, response)
  return finished
}

function credentialHeaders(extra = {}) {
  return {
    origin: ORIGIN,
    'x-competition-team': '1',
    ...extra,
  }
}

test('state is same-origin only', async () => {
  const ok = await call({ path: '/competition-team/api/state' })
  assert.equal(ok.status, 200)
  assert.equal(ok.json().ok, true)

  const blocked = await call({
    path: '/competition-team/api/state',
    headers: { origin: 'http://evil.example' },
  })
  assert.equal(blocked.status, 403)
  assert.equal(blocked.json().error, 'cross-origin')
})

test('actions require the CSRF header and valid JSON', async () => {
  const noHeader = await call({
    method: 'POST',
    path: '/competition-team/api/action',
    headers: { origin: ORIGIN },
    body: '{}',
  })
  assert.equal(noHeader.status, 403)
  assert.equal(noHeader.json().error, 'header')

  const badJson = await call({
    method: 'POST',
    path: '/competition-team/api/action',
    headers: credentialHeaders(),
    body: '{bad',
  })
  assert.equal(badJson.status, 400)
  assert.equal(badJson.json().error, 'bad-json')
})

test('create and state round-trip through the HTTP route', async () => {
  const created = await call({
    method: 'POST',
    path: '/competition-team/api/action',
    headers: credentialHeaders(),
    body: JSON.stringify({
      action: 'create',
      title: 'HTTP 测试',
      brief: '这是一个足够长的题目描述，用于 HTTP 路由测试。',
      cwd,
      auto: false,
    }),
  })
  assert.equal(created.status, 200)
  const payload = created.json()
  assert.equal(payload.ok, true)
  assert.ok(payload.teamId)

  const state = await call({ path: '/competition-team/api/state' })
  assert.equal(state.status, 200)
  assert.equal(state.json().teams.length, 1)
  assert.equal(state.json().teams[0].title, 'HTTP 测试')
})

test('file route refuses traversal and serves team files', async () => {
  const state = await call({ path: '/competition-team/api/state' })
  const teamId = state.json().teams[0].id

  const outside = await call({
    path: `/competition-team/api/file?team=${teamId}&path=${encodeURIComponent('../../etc/passwd')}`,
  })
  assert.equal(outside.status, 404)
  assert.equal(outside.json().error, 'outside-team')

  const brief = await call({
    path: `/competition-team/api/file?team=${teamId}&path=brief.md`,
  })
  assert.equal(brief.status, 200)
  assert.match(brief.body, /HTTP 测试/)
})

test('models route maps the catalog and unknown actions are explicit', async () => {
  const models = await call({ path: '/competition-team/api/models' })
  assert.equal(models.status, 200)
  assert.equal(models.json().ok, true)

  const unknown = await call({
    method: 'POST',
    path: '/competition-team/api/action',
    headers: credentialHeaders(),
    body: JSON.stringify({ action: 'nope' }),
  })
  assert.equal(unknown.status, 200)
  assert.equal(unknown.json().ok, false)
  assert.match(unknown.json().error, /unknown-action/)
})