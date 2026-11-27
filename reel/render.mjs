/**
 * Build the props for one reel from the site's bundle API, then render it.
 *
 *   node render.mjs --out out/reel.mp4
 *
 * The bundle gives us the same three stories the carousel used, so a reel and
 * a carousel never disagree about the day's news.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const SITE = (process.env.SITE_URL || 'https://informalbuff.vercel.app').replace(/\/$/, '')
const INGEST_KEY = process.env.INGEST_API_KEY || ''
/**
 * The bed is part of the product, so it is on by default when the file is
 * there. Relying on REEL_AUDIO alone broke once when the step moved between
 * workflows and the variable stayed behind.
 */
const DEFAULT_AUDIO = 'music/bed.mp3'
const AUDIO_OVERRIDE = process.env.REEL_AUDIO
const AUDIO =
  AUDIO_OVERRIDE === 'none'
    ? null
    : AUDIO_OVERRIDE || (existsSync(resolve('public', DEFAULT_AUDIO)) ? DEFAULT_AUDIO : null)
const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : 'out/reel.mp4'

const WASH = ['#d3f3c8', '#cfe9f7', '#ffd9e2']

/** Eight words is the most a hook can carry before it stops being a hook. */
function toHook(rows) {
  const first = (rows[0]?.title || 'The stories that matter').trim()
  const words = first.split(/\s+/)
  if (words.length <= 8) return first
  return `${words.slice(0, 8).join(' ')}…`
}

/** Pull the one-line consequence out of the article body. */
function whyLine(html = '') {
  const m = html.match(/<h2[^>]*>\s*Why it matters\s*<\/h2>([\s\S]*?)(?=<h2|<div|$)/i)
  if (!m) return ''
  const text = m[1]
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
  const sentence = text.split(/(?<=[.!?])\s/)[0] || text
  return sentence.length > 120 ? `${sentence.slice(0, 117)}…` : sentence
}

const res = await fetch(`${SITE}/api/bundle?mixed=1&limit=3&platform=instagram&edition=evening`, {
  headers: { 'x-ingest-key': INGEST_KEY },
})
const data = await res.json()
if (!data.ok) throw new Error(`bundle: ${data.error}`)

let rows = (data.stories || []).slice(0, 3)

/**
 * Outside the edition window everything is already marked as pushed, so fall
 * back to the newest published stories from the RSS feed. A reel can still be
 * built and tested without touching the publishing state.
 */
if (!rows.length) {
  const xml = await fetch(`${SITE}/feed.xml`).then((r) => r.text())
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 3)
  rows = items.map((m) => {
    const chunk = m[1]
    const title = (chunk.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || ''
    const link = (chunk.match(/<link>([^<]+)<\/link>/) || [])[1] || ''
    const slug = link.split('/article/')[1] || ''
    return {
      title: title.replace(/&amp;/g, '&').trim(),
      slug,
      excerpt: '',
      content: '',
      cards: { poster: `${SITE}/api/poster?slug=${encodeURIComponent(slug)}` },
    }
  })
  if (rows.length) console.log(`bundle empty — using ${rows.length} latest stories from the feed`)
}

if (!rows.length) {
  console.log('no stories available — nothing to render')
  process.exit(0)
}

/**
 * Download the posters first. Remotion renders frames in parallel and a remote
 * image inside a frame can blow the 28s delayRender budget on a cold Vercel
 * function — local files remove that failure mode entirely.
 */
mkdirSync('public/posters', { recursive: true })

// REEL_STYLE=split uses the photographic split card as the frame instead of the
// editorial poster, so the reel looks like the carousel people just scrolled.
const STYLE = process.env.REEL_STYLE || 'poster'
const stories = []
for (const [i, s] of rows.entries()) {
  const src =
    STYLE === 'split'
      ? s.cards?.split ? `${s.cards.split}&format=story` : `${SITE}/api/split?slug=${encodeURIComponent(s.slug)}&format=story`
      : s.cards?.poster || `${SITE}/api/poster?slug=${encodeURIComponent(s.slug)}`
  const file = `public/posters/story-${i}.png`
  const img = await fetch(src)
  if (!img.ok) throw new Error(`poster ${i}: ${img.status}`)
  writeFileSync(file, Buffer.from(await img.arrayBuffer()))
  stories.push({
    title: s.title,
    line:
      whyLine(s.content || '') ||
      (s.excerpt || '').replace(/^\s*Quick answer:\s*/i, '').slice(0, 120),
    image: `posters/story-${i}.png`,
    wash: WASH[i % WASH.length],
  })
}

const props = {
  hook: toHook(rows),
  kicker: 'InformalBuff',
  handle: '@informal.buff',
  site: 'informalbuff.vercel.app',
  audio: AUDIO,
  style: STYLE,
  stories,
}

mkdirSync(dirname(resolve(OUT)), { recursive: true })
writeFileSync('props.json', JSON.stringify(props, null, 2))
console.log(`props: ${stories.length} stories → ${OUT}`)

execFileSync(
  'npx',
  ['remotion', 'render', 'Reel', OUT, '--props=props.json', '--log=error', '--concurrency=2'],
  { stdio: 'inherit' },
)

console.log(`rendered ${OUT}`)
