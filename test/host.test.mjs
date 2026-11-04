import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { apply } from '../index.js'

function createContext({ llm, selection } = {}) {
  const routes = new Map()
  const ctx = {
    webServer: {
      routes,
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    },
    effect(callback) {
      return callback()
    },
    get(name) {
      if (name === 'llm') return llm
      if (name === 'agentDefaultModel') return selection === undefined ? undefined : { currentSelection: () => selection }
      return undefined
    },
  }
  apply(ctx)
  return ctx
}

class FakeResponse {
  constructor() {
    this.status = 0
    this.headers = {}
    this.body = ''
    this.writableEnded = false
    this.headersSent = false
    this.listeners = new Map()
  }

  on(event, listener) {
    const list = this.listeners.get(event) ?? []
    list.push(listener)
    this.listeners.set(event, list)
    return this
  }

  off(event, listener) {
    const list = this.listeners.get(event) ?? []
    this.listeners.set(event, list.filter((item) => item !== listener))
    return this
  }

  emit(event) {
    for (const listener of this.listeners.get(event) ?? []) listener()
  }

  writeHead(status, headers) {
    this.status = status
    this.headers = headers
    this.headersSent = true
  }

  end(body = '') {
    this.body = body
    this.writableEnded = true
    this.emit('close')
  }
}

function request(payload, method = 'POST') {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const req = Readable.from([Buffer.from(body)])
  req.method = method
  req.headers = { 'x-dsh-approval-detail': '1' }
  req.socket = { remoteAddress: '127.0.0.1' }
  req.destroy = () => {}
  return req
}

function routeOf(ctx) {
  const route = ctx.webServer.routes.get('/__dsh-approval-detail/analyze')
  assert.notEqual(route, undefined)
  return route
}

test('host route returns a normalized model risk analysis', async () => {
  let observed
  const ctx = createContext({
    selection: { provider: 'test-provider', model: 'test-model' },
    llm: {
      async *stream(options) {
        observed = options
        yield { type: 'text-delta', text: '{"level":"high","summary":"Deletes files outside the workspace.","factors":["recursive delete"],"recommendation":"Reject unless the path is verified."}' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
  })

  const res = new FakeResponse()
  await routeOf(ctx).handler(request({
    toolName: 'pwsh',
    arguments: '{"command":"Remove-Item -Recurse C:\\\\temp"}',
    locale: 'en',
  }), res)

  assert.equal(res.status, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.ok, true)
  assert.equal(body.analysis.level, 'high')
  assert.equal(body.analysis.factors[0], 'recursive delete')
  assert.equal(observed.provider, 'test-provider')
  assert.equal(observed.model, 'test-model')
  assert.match(observed.messages[0].content[0].text, /Remove-Item/u)
})

test('host route strips Markdown from structured fields and fenced JSON', async () => {
  const ctx = createContext({
    selection: { provider: 'test-provider', model: 'test-model' },
    llm: {
      async *stream() {
        yield { type: 'text-delta', text: '```json\n{"level":"high","summary":"**Run** `Remove-Item`","factors":["Use `-Force`"],"recommendation":"Do not ```run```"}```\n' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
  })

  const res = new FakeResponse()
  await routeOf(ctx).handler(request({ toolName: 'pwsh', arguments: '{}', locale: 'en' }), res)
  const body = JSON.parse(res.body)
  assert.equal(body.analysis.summary, 'Run Remove-Item')
  assert.equal(body.analysis.factors[0], 'Use -Force')
  assert.equal(body.analysis.recommendation, 'Do not run')
})

test('host route strips Markdown from an unstructured model answer', async () => {
  const ctx = createContext({
    selection: { provider: 'test-provider', model: 'test-model' },
    llm: {
      async *stream() {
        yield {
          type: 'text-delta',
          text: '**操作分析**\n\n- **工具**：`pwsh`\n- 代码：\n```` ```powershell ````\nGet-ChildItem\n```` ``` ````\n',
        }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
  })

  const res = new FakeResponse()
  await routeOf(ctx).handler(request({ toolName: 'pwsh', arguments: '{}', locale: 'zh' }), res)
  const body = JSON.parse(res.body)
  assert.equal(body.analysis.level, 'unknown')
  assert.match(body.analysis.summary, /操作分析/u)
  assert.match(body.analysis.summary, /pwsh/u)
  assert.match(body.analysis.summary, /Get-ChildItem/u)
  assert.doesNotMatch(body.analysis.summary, /\*\*/u)
  assert.doesNotMatch(body.analysis.summary, /`/u)
  assert.doesNotMatch(body.analysis.summary, /^powershell$/mu)
})

test('host route rejects non-POST requests', async () => {
  const ctx = createContext()
  const res = new FakeResponse()
  await routeOf(ctx).handler(request({ toolName: 'read' }, 'GET'), res)
  assert.equal(res.status, 405)
  assert.equal(JSON.parse(res.body).ok, false)
})

test('host route fails closed when no default model is composed', async () => {
  const ctx = createContext({
    llm: { async *stream() {} },
  })
  const res = new FakeResponse()
  await routeOf(ctx).handler(request({ toolName: 'read', arguments: '{}' }), res)
  assert.equal(res.status, 502)
  const body = JSON.parse(res.body)
  assert.equal(body.ok, false)
  assert.match(body.error, /default model/u)
})

test('host route rejects a request without the package marker', async () => {
  const ctx = createContext()
  const res = new FakeResponse()
  const req = request({ toolName: 'read', arguments: '{}' })
  req.headers = {}
  await routeOf(ctx).handler(req, res)
  assert.equal(res.status, 403)
})

test('host route rejects a non-loopback peer', async () => {
  const ctx = createContext()
  const res = new FakeResponse()
  const req = request({ toolName: 'read', arguments: '{}' })
  req.socket = { remoteAddress: '192.0.2.10' }
  await routeOf(ctx).handler(req, res)
  assert.equal(res.status, 403)
})

test('host route reports invalid JSON without throwing', async () => {
  const ctx = createContext()
  const res = new FakeResponse()
  await routeOf(ctx).handler(request('{not-json'), res)
  assert.equal(res.status, 400)
  assert.equal(JSON.parse(res.body).ok, false)
})
