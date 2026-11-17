import { makeCtx } from './helpers.mjs'

/**
 * Build a Host context good enough for `apply(ctx)`: it captures the tool and
 * the web route instead of talking to a real DSH process.
 */
export async function makeHost() {
  const base = makeCtx()
  const routes = []
  const tools = []
  const ctx = {
    ...base.ctx,
    effect(fn) {
      const value = fn()
      if (typeof value === 'function') return value
      return () => {}
    },
    tools: {
      register(definition) {
        tools.push(definition)
        return () => {}
      },
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    on() {},
  }
  const mod = await import('../index.js')
  mod.apply(ctx)
  await new Promise(resolve => setTimeout(resolve, 5))
  const route = routes.find(item => item.path === '/competition-team/api')
  return { ...base, ctx, tool: tools[0], handler: route.handler, routes, mod }
}