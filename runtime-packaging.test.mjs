import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))

test('Docker runtime contains the complete relative module import graph', () => {
  const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8')
  const runtime = docker.split(/FROM\s+node:[^\n]+\s+AS\s+runtime/i)[1]
  assert.ok(runtime, 'runtime stage must exist')
  const copied = new Set()
  for (const line of runtime.split('\n')) {
    const copy = line.match(/^COPY\s+(.+?)\s+\.\/$/)
    if (!copy || copy[1].startsWith('--from=')) continue
    for (const name of copy[1].split(/\s+/)) copied.add(name)
  }
  const visited = new Set()
  function visit(name) {
    if (visited.has(name)) return
    visited.add(name)
    assert.ok(copied.has(name), `Docker runtime COPY omits ${name}`)
    assert.ok(fs.existsSync(path.join(root, name)), `Source file missing: ${name}`)
    const source = fs.readFileSync(path.join(root, name), 'utf8')
    const imports = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"](\.\.?\/[^'"]+)['"]/g
    for (const match of source.matchAll(imports)) {
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1]))
      visit(dependency)
    }
  }
  visit('server.js')
})
