import { open, stat } from 'node:fs/promises'
import { extname } from 'node:path'

/** Declared artifacts smaller than this are treated as empty stubs. */
export const MIN_ARTIFACT_BYTES = 32
export const MIN_CODE_BYTES = 64
export const MIN_PAPER_BYTES = 500

async function readHead(path, length) {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/** Deterministic content checks for declared artifacts (no model involved). */
export async function qualityCheck(filePath, rel, member) {
  const errors = []
  const warnings = []
  let info
  try { info = await stat(filePath) } catch { return { errors, warnings } }
  const size = info.size
  const ext = extname(rel).toLowerCase()
  const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)
  const isCode = ['.py', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.java', '.cpp', '.c', '.r'].includes(ext)
  const isPaper = ext === '.tex'
    || ((ext === '.md' || ext === '.markdown') && /论文|paper/i.test(String(member.name || '') + String(member.role || '')))

  if (size < MIN_ARTIFACT_BYTES) {
    errors.push({ path: rel, code: 'empty-artifact' })
    return { errors, warnings }
  }
  if (isImage) {
    const head = await readHead(filePath, 16)
    const ok = (ext === '.png' && head[0] === 0x89 && head.toString('ascii', 1, 4) === 'PNG')
      || ((ext === '.jpg' || ext === '.jpeg') && head[0] === 0xff && head[1] === 0xd8)
      || (ext === '.gif' && head.toString('ascii', 0, 3) === 'GIF')
      || (ext === '.webp' && head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP')
    if (!ok) errors.push({ path: rel, code: 'bad-image' })
    return { errors, warnings }
  }
  if (isCode && size < MIN_CODE_BYTES) errors.push({ path: rel, code: 'empty-code' })
  if (ext === '.csv' || ext === '.tsv') {
    const head = await readHead(filePath, 2048)
    const lines = head.toString('utf8').split(/\r?\n/).filter(line => line.trim().length > 0)
    if (lines.length < 2) errors.push({ path: rel, code: 'thin-data' })
  }
  if (isPaper) {
    const head = await readHead(filePath, 8192)
    const text = head.toString('utf8')
    if (size < MIN_PAPER_BYTES) {
      errors.push({ path: rel, code: 'thin-paper' })
    } else {
      const sections = [/摘要|abstract/i, /假设|assumption/i, /模型|model/i, /求解|solution/i, /结论|conclusion/i]
      const found = sections.filter(pattern => pattern.test(text)).length
      if (found < 2) warnings.push({ path: rel, code: 'missing-sections' })
    }
  }
  return { errors, warnings }
}