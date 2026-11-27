/**
 * Caption and hook hygiene, borrowed from the MIT instagram-agent-skill pack:
 * on-screen hooks are six words or fewer and carry the number, captions lose
 * the typographic tells and the slop vocabulary that make machine writing
 * obvious in a feed.
 */
import { readFileSync } from 'node:fs'

const slop = JSON.parse(readFileSync(new URL('./data/slop.json', import.meta.url), 'utf8'))
// Entries are {find, replace}: swap the slop for the plainer word instead of
// leaving a hole where the sentence used to be.
const WORD_MAP = new Map(slop.words.map((w) => [String(w.find).toLowerCase(), w.replace ?? '']))
const PHRASE_MAP = new Map(slop.phrases.map((p) => [String(p.find), p.replace ?? '']))

export function humanize(text) {
  let out = String(text || '')
  for (const t of slop.typographic) out = out.split(t.from).join(t.to)
  for (const [find, replace] of PHRASE_MAP) {
    const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    out = out.replace(re, replace)
  }
  out = out
    .split(' ')
    .map((w) => {
      const key = w.toLowerCase().replace(/[^a-z]/g, '')
      return WORD_MAP.has(key) ? WORD_MAP.get(key) : w
    })
    .filter((w) => w !== '')
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/^[,\s]+/, '')
    .trim()
  return out
}

/** The feed shows 125 characters; the promise has to fit inside them. */
export function lintCaption(text, { hashtags = 4 } = {}) {
  const body = String(text || '')
  const issues = []
  if (body.split('\n')[0].length > 125) issues.push('first line over 125 characters')
  if (/[—–]/.test(body)) issues.push('dash characters')
  const tags = (body.match(/#\w+/g) || []).length
  if (tags < 3) issues.push(`only ${tags} hashtags`)
  if (tags > 6) issues.push(`${tags} hashtags is noise`)
  if (hashtags && tags === 0) issues.push('no hashtags')
  return issues
}

/**
 * On-screen hook: six words at most, no punctuation it does not need, and the
 * number first when the story has one.
 */
export function scoreHook(candidate) {
  const words = String(candidate || '').trim().split(/\s+/).filter(Boolean)
  let score = 0
  if (/\d/.test(candidate)) score += 3
  if (words.length <= 6) score += 2
  if (!/[.!?]$/.test(candidate)) score += 1
  score -= Math.max(0, words.length - 6)
  return score
}

export function bestHook(candidates) {
  const cleaned = candidates.filter(Boolean).map((c) => String(c).trim())
  if (!cleaned.length) return ''
  return cleaned.sort((a, b) => scoreHook(b) - scoreHook(a))[0]
}
