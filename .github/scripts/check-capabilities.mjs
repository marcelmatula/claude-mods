// Fails when a mod's hooks or $ calls grow beyond what its capabilities.json declares.
//
//   node .github/scripts/check-capabilities.mjs <mod folder>
//
// `claude plugin validate --json` reports each hooks module's hooks and $ calls as notes
// ("./register.tsx hooks: a, b", "./register.tsx calls: $.x.y, ..."). Something used but not
// declared is an error; something declared but no longer used is a warning.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const mod = process.argv[2]
if (!mod) {
  console.error('usage: node .github/scripts/check-capabilities.mjs <mod folder>')
  process.exit(2)
}

let failed = false
const say = (level, text) => {
  if (level === 'error') failed = true
  console.log(process.env.GITHUB_ACTIONS ? `::${level} title=${mod} capabilities::${text}` : `${level}: ${mod}: ${text}`)
}

// Splits "a, b{x=1,y=2}, c (via f, g)" on the commas outside braces and parentheses.
const splitList = list => {
  const items = []
  let depth = 0
  let current = ''
  for (const ch of list) {
    if (ch === '{' || ch === '(') depth += 1
    if (ch === '}' || ch === ')') depth -= 1
    if (ch === ',' && depth === 0) {
      items.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  items.push(current.trim())
  return items.filter(Boolean)
}

let output
try {
  output = execFileSync('claude', ['plugin', 'validate', mod, '--json'], { encoding: 'utf8' })
} catch (err) {
  output = err.stdout ?? '' // A failed validation still prints its report; the validate step reports the failure.
}

let report
try {
  report = JSON.parse(output)
} catch {
  say('error', 'claude plugin validate --json printed no JSON report')
  process.exit(1)
}

const used = { hooks: new Set(), calls: new Set() }
const seen = { hooks: false, calls: false }
for (const note of (report.contents ?? []).flatMap(entry => entry.notes ?? [])) {
  const match = /^\S+ (hooks|calls): (.*)$/.exec(note)
  if (!match) continue
  const [, kind, list] = match
  seen[kind] = true
  if (/^nothing\b/.test(list.trim())) continue
  // A call made through helper functions is reported as "$.x.y (via helper)" or
  // "$.x.y (via one, other)".
  for (const item of splitList(list)) used[kind].add(item.replace(/ \(via [^)]*\)$/, ''))
}

if (existsSync(join(mod, 'hooks', 'hooks.json')) && !(seen.hooks && seen.calls)) {
  say('error', "the validate report has no 'hooks:' or 'calls:' note for the hooks module; its format may have changed, so update this script")
  process.exit(1)
}

const file = join(mod, 'capabilities.json')
const found = { hooks: [...used.hooks].sort(), calls: [...used.calls].sort() }
if (!existsSync(file)) {
  say('error', `no capabilities.json; declare what the mod uses: ${JSON.stringify(found)}`)
  process.exit(1)
}

let declared
try {
  declared = JSON.parse(readFileSync(file, 'utf8'))
} catch (err) {
  say('error', `capabilities.json is not valid JSON: ${err.message}`)
  process.exit(1)
}

for (const kind of ['hooks', 'calls']) {
  const allowed = new Set(Array.isArray(declared[kind]) ? declared[kind] : [])
  for (const item of found[kind]) {
    if (!allowed.has(item)) say('error', `uses ${kind === 'hooks' ? 'hook' : 'call'} ${item}, which capabilities.json does not declare`)
  }
  for (const item of allowed) {
    if (!used[kind].has(item)) say('warning', `declares ${kind === 'hooks' ? 'hook' : 'call'} ${item}, which it no longer uses; remove it from capabilities.json and the README`)
  }
}

if (!failed) console.log(`${mod}: uses no hook or $ call beyond capabilities.json (${found.hooks.length} hooks, ${found.calls.length} calls)`)
process.exit(failed ? 1 : 0)
