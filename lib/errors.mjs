/** Classify a provider/tool failure as transient (retryable) or permanent. */
export function classifyError(error) {
  const parts = [
    error && error.message,
    error && error.code,
    error && error.name,
    error && error.status,
    error && error.statusCode,
  ].filter(value => value !== undefined && value !== null)
  const text = parts.join(' ')
  const lower = text.toLowerCase()
  const status = Number(error && (error.status || error.statusCode))
  if ([429, 500, 502, 503, 504].includes(status)) return { transient: true, code: 'http-' + status }
  if (/rate.?limit|too many requests|overloaded|temporarily unavailable|service unavailable|timeout|timed out|econnreset|econnrefused|eai_again|etimedout|socket hang up|network|fetch failed|\b50[234]\b|\b429\b/.test(lower)) {
    return { transient: true, code: 'network' }
  }
  if (/401|403|unauthorized|forbidden|invalid api key|authentication|permission denied/.test(lower)) {
    return { transient: false, code: 'auth' }
  }
  if (/404|model.*not found|no such model|unknown model|model not available/.test(lower)) {
    return { transient: false, code: 'model-missing' }
  }
  if (/400|422|invalid|bad request|context length|too many tokens/.test(lower)) {
    return { transient: false, code: 'bad-request' }
  }
  if (/abort|cancel/.test(lower)) return { transient: false, code: 'cancelled' }
  return { transient: false, code: 'unknown' }
}