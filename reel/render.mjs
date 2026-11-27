/**
 * Build the props for one reel from the site's bundle API, then render it.
 *
 *   node render.mjs --out out/reel.mp4
 *
 * The bundle gives us the same three stories the carousel used, so a reel and
 * a carousel never disagree about the day's news.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const SITE = (process.env.SITE_URL || 'https://informalbuff.vercel.app').replace(/\/$/, '')
const INGEST_KEY = process.env.INGEST_API_KEY || ''
/**
 * Music: one bed per day, rotating through a five-track pool so the feed never
 * sounds the same twice in a row. REEL_TRACK pins a file, REEL_AUDIO=none is
 * silent (tests).
 */
function pickTrack() {
  if (process.env.REEL_TRACK) {
    const f = `music/library/${process.env.REEL_TRACK}`
    return existsSync(resolve('public', f)) ? { file: f, gain: 1 } : null
  }
  const rotationPath = resolve('public/music/rotation.json')
  if (existsSync(rotationPath)) {
    const rotation = JSON.parse(readFileSync(rotationPath, 'utf8'))
    const pool = rotation.pool || []
    if (pool.length) {
      const dayNumber = Math.floor(Date.now() / 86400000)
      const pick = pool[dayNumber % pool.length]
      const gainDb = (rotation.targetMeanDb ?? -12) - (pick.meanDb ?? -15)
      const gain = Math.min(2, Math.max(0.5, Math.pow(10, gainDb / 20)))
      return { file: `music/library/${pick.file}`, gain, mood: pick.mood }
    }
  }
  return existsSync(resolve('public/music/bed.mp3')) ? { file: 'bed.mp3', gain: 1 } : null
}

const PICKED = process.env.REEL_AUDIO === 'none' ? null : pickTrack()
const AUDIO = PICKED ? PICKED.file : null
const AUDIO_GAIN = PICKED ? PICKED.gain : 1
if (PICKED) console.log(`music: ${PICKED.file}${PICKED.mood ? ` (${PICKED.mood})` : ''} gain ${AUDIO_GAIN.toFixed(2)}`)
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

/**
 * The carousel and the reel must tell the same three stories. push-bundles
 * writes last-bundle.json as it publishes; prefer that over a second bundle
 * call, which returns nothing once the stories are marked pushed.
 */
let rows = []
let bundleNote = ''
if (existsSync('last-bundle.json')) {
  try {
    const saved = JSON.parse(readFileSync('last-bundle.json', 'utf8'))
    const ageMinutes = (Date.now() - new Date(saved.at).getTime()) / 60000
    if (Array.isArray(saved.stories) && saved.stories.length && ageMinutes < 180) {
      rows = saved.stories.slice(0, 3)
      bundleNote = `using the carousel bundle (${Math.round(ageMinutes)} min old)`
    }
  } catch (err) {
    console.log(`last-bundle.json unreadable: ${err.message}`)
  }
}

if (!rows.length) {
  const res = await fetch(`${SITE}/api/bundle?mixed=1&limit=3&platform=instagram&edition=evening`, {
    headers: { 'x-ingest-key': INGEST_KEY },
  })
  const data = await res.json()
  if (!data.ok) throw new Error(`bundle: ${data.error}`)
  rows = (data.stories || []).slice(0, 3)
}
if (bundleNote) console.log(bundleNote)

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

// The publisher needs the lead slug to render the cover thumbnail.
writeFileSync('out/cover-slug.txt', String(rows[0]?.slug || ''))
writeFileSync('out/cover-slugs.txt', rows.slice(0, 3).map((r) => r.slug).join(','))

// Hook frame wants the raw photo, not the card that already carries text.
let heroImage = null
const heroSrc = rows[0]?.photo
if (heroSrc) {
  try {
    const r = await fetch(heroSrc)
    if (r.ok) {
      writeFileSync('public/posters/hero.jpg', Buffer.from(await r.arrayBuffer()))
      heroImage = 'posters/hero.jpg'
    }
  } catch (err) {
    console.log(`hero photo failed: ${err.message}`)
  }
}

const props = {
  hook: toHook(rows),
  hero: heroImage,
  payoff: whyLine(rows[0]?.content || '') || rows[0]?.excerpt || '',
  kicker: 'InformalBuff',
  handle: '@informal.buff',
  site: 'informalbuff.vercel.app',
  audio: AUDIO,
  audioVolume: AUDIO_GAIN,
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

/**
 * When there is no payoff sentence the composition has five seconds of nothing
 * before the CTA. Trim them off rather than hold on a static frame.
 */
const cleanPayoff = (props.payoff || '').replace(/\s+/g, ' ').trim()
const payoffUseful =
  cleanPayoff.length > 40 &&
  cleanPayoff.slice(0, 40).toLowerCase() !== props.hook.slice(0, 40).toLowerCase() &&
  !props.hook.toLowerCase().includes(cleanPayoff.slice(0, 40).toLowerCase())

if (!payoffUseful) {
  const trimmed = OUT.replace(/\.mp4$/, '-trim.mp4')
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', OUT, '-t', '25', '-c', 'copy', trimmed])
  renameSync(trimmed, OUT)
  console.log('trimmed 5s of empty payoff')
}
