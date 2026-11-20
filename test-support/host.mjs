import { makeCtx } from './helpers.mjs'

/**
 * Build a Host context good enough for `apply(ctx)`: it captures the tool and
 * the web route instead of talking to a real DSH process.
 */
export async function makeHost() {
  const base = makeCtx()
  const routes = []
  const tools = []
  const handlers = []
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
    on(event, fn) {
      handlers.push({ event, fn })
    },
  }
  const mod = await import('../index.js')
  mod.apply(ctx)
  await new Promise(resolve => setTimeout(resolve, 5))
  const route = routes.find(item => item.path === '/competition-team/api')
  const injectTable = []
  for (const item of handlers) {
    if (item.event === 'webserver/index-inject') item.fn(injectTable)
  }
  const token = (injectTable.find(item => item.name === '__COMPETITION_TEAM_TOKEN__') || {}).value || ''
  return { ...base, ctx, tool: tools[0], handler: route.handler, routes, mod, token }
}