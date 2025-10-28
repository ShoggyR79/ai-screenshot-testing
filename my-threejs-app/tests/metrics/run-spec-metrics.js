#!/usr/bin/env node
/**
 * Run a Playwright spec N times and collect metrics.
 * Failure of any test in a run counts that run as FAIL.
 *
 * Usage:
 *   node tests/metrics/run-spec-metrics.js --spec tests/box-visual-ai.spec.ts --runs 20 --browser chromium
 *   (browser optional: chromium|firefox|webkit; default chromium)
 *   --grep "pattern" (optional) to target specific test(s)
 */
import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'

function getArg(name, def) {
  const idx = process.argv.indexOf(`--${name}`)
  return idx !== -1 ? process.argv[idx + 1] : def
}

const spec = getArg('spec', null)
if (!spec) {
  console.error('Missing --spec <file>')
  process.exit(1)
}
const runs = parseInt(getArg('runs', '20'), 10)
const browser = getArg('browser', 'chromium')
const grep = getArg('grep', null)
const delayMs = parseInt(getArg('delay', '0'), 10)
const abortOn = parseInt(getArg('abortOnFails', '0'), 10) // abort if fail count exceeds
const results = {
  spec,
  runs,
  browser,
  passRuns: 0,
  failRuns: 0,
  durationsMs: [],
  failures: []
}

console.log(`=== Metrics Runner ===
Spec: ${spec}
Runs: ${runs}
Browser: ${browser}
Grep: ${grep || '(none)'}
Delay per run: ${delayMs} ms
Abort threshold: ${abortOn || 'none'}
-------------------------`)

for (let i = 1; i <= runs; i++) {
  if (delayMs) awaitDelay(delayMs)
  const args = [
    'playwright',
    'test',
    spec,
    '--browser',
    browser,
    '--workers=1',
    '--reporter=json'
  ]
  if (grep) {
    args.push('-g', grep)
  }

  const start = Date.now()
  const proc = spawnSync('npx', args, { encoding: 'utf-8', env: { ...process.env } })
  const duration = Date.now() - start
  results.durationsMs.push(duration)

  let json
  try {
    json = JSON.parse(proc.stdout || '{}')
  } catch {
    json = { error: 'JSON parse failed', raw: proc.stdout.slice(0, 300) }
  }

  const numFailed = json?.stats?.numFailingTests ?? (proc.status === 0 ? 0 : 1)
  const success = numFailed === 0

  if (success) {
    results.passRuns++
  } else {
    results.failRuns++
    const reasoning = extractReasoning(json)
    results.failures.push({
      run: i,
      reasoning,
      failingTests: numFailed,
      tail: (proc.stdout || '').slice(-600)
    })
  }

  console.log(`Run ${String(i).padStart(2, '0')}: ${success ? 'PASS' : 'FAIL'} - ${duration} ms (failed tests: ${numFailed})`)

  if (abortOn && results.failRuns >= abortOn) {
    console.log(`Abort threshold reached (${abortOn} fails). Stopping early.`)
    break
  }
}

function extractReasoning(json) {
  if (!json || !json.suites) return 'No reasoning'
  const reasons = []
  for (const suite of json.suites) {
    for (const test of suite.tests || []) {
      if (test.status === 'failed') {
        const err = test.errors?.[0]
        if (err) reasons.push(err.message?.split('\n')[0] || 'Failure')
      }
    }
    for (const child of suite.suites || []) {
      for (const test of child.tests || []) {
        if (test.status === 'failed') {
          const err = test.errors?.[0]
          if (err) reasons.push(err.message?.split('\n')[0] || 'Failure')
        }
      }
    }
  }
  return reasons.join(' | ') || 'Failure'
}

function awaitDelay(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

const sum = results.durationsMs.reduce((a, b) => a + b, 0)
const avg = sum / results.durationsMs.length
const min = Math.min(...results.durationsMs)
const max = Math.max(...results.durationsMs)

console.log('\n=== Summary ===')
console.log(`Spec:              ${spec}`)
console.log(`Browser:           ${browser}`)
console.log(`Total runs:        ${results.durationsMs.length}`)
console.log(`Pass runs:         ${results.passRuns}`)
console.log(`Fail runs:         ${results.failRuns}`)
console.log(`Total time (ms):   ${sum}`)
console.log(`Avg per run (ms):  ${avg.toFixed(1)}`)
console.log(`Min run (ms):      ${min}`)
console.log(`Max run (ms):      ${max}`)

if (results.failures.length) {
  console.log('\nFailure samples (up to 5):')
  results.failures.slice(0, 5).forEach(f =>
    console.log(`  Run ${f.run}: ${f.reasoning}`)
  )
}

const outPath = path.join(process.cwd(), 'test-results', 'metrics')
fs.mkdirSync(outPath, { recursive: true })
fs.writeFileSync(
  path.join(outPath, `metrics-${path.basename(spec)}.json`),
  JSON.stringify(
    {
      ...results,
      stats: { totalMs: sum, avgMs: avg, minMs: min, maxMs: max }
    },
    null,
    2
  )
)

process.exit(results.failRuns ? 1 : 0)