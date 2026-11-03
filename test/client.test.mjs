import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

function loadClient() {
  let loaded
  const window = {
    __ModuleLoader__: {
      load(definition) {
        loaded = definition
      },
    },
  }
  return { window, get loaded() { return loaded } }
}

function fakeReact() {
  return {
    createElement: () => null,
    useState: () => [undefined, () => {}],
    useEffect: () => {},
    useMemo: (factory) => factory(),
    useRef: () => ({ current: null }),
  }
}

test('client registers the approval detail slot at shadowing priority', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const holder = loadClient()
  const window = holder.window
  const document = {
    head: { appendChild: () => {} },
    createElement: () => ({ dataset: {}, textContent: '', remove: () => {} }),
  }
  const sandbox = { window, document, console }
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })

  assert.equal(holder.loaded.id, 'dsh-approval-detail')
  const module = holder.loaded.factory((name) => {
    assert.equal(name, 'react')
    return fakeReact()
  })

  let registration
  const ctx = {
    effect(callback) {
      callback()
    },
    locale: {
      register() {
        return () => {}
      },
    },
    slots: {
      inject(name, callback) {
        assert.equal(name, 'conversation.approval.detail')
        callback()
      },
      register(options, component) {
        registration = { options, component }
        return () => {}
      },
    },
  }

  module.apply(ctx)
  assert.equal(registration.options.name, 'conversation.approval.detail')
  assert.equal(registration.options.priority, -1)
  assert.equal(registration.options.locale, 'approval-detail')
  assert.equal(typeof registration.component, 'function')
  assert.deepEqual(Array.from(module.inject), ['slots', 'locale'])
})
