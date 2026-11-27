/**
 * One command: render the day's reel, host it, publish it to Instagram.
 * Runs from the reel workflow only, so it can never block the carousel push.
 */
import { existsSync, readFileSync } from 'node:fs'
import { postVideoToFacebookPage, publishReel, sendVideoToTelegram, uploadVideoToCloudinary } from './reel.js'
import { r2Configured, uploadToR2 } from './r2.js'
import { releaseHostingConfigured, uploadReelToGitHub } from './gh-release.js'
import { humanize } from './ig-copy.js'

const SITE = process.env.SITE_URL || 'https://informalbuff.vercel.app'

const OUT = process.env.REEL_OUT || 'reel/out/reel.mp4'
const IG_USER_ID = process.env.IG_USER_ID
const TOKEN = process.env.META_PAGE_TOKEN
const DRY_RUN = process.env.DRY_RUN === 'true'

if (!existsSync(OUT)) {
  console.log(`no reel at ${OUT} — nothing to publish`)
  process.exit(0)
}

// The reel workflow fires four times a day; a morning reel must not say
// "evening". Derive the label from IST so the copy always matches the hour.
const istHour = Number(
  new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' })
    .format(new Date()),
)
const partOfDay = istHour < 11 ? 'morning' : istHour < 16 ? 'afternoon' : istHour < 21 ? 'evening' : 'night'

// Say the real number: a two-story reel that promises three is a lie at the
// exact moment someone decides whether to trust the account.
let storyCount = 3
for (const f of ['last-bundle.json', '../last-bundle.json']) {
  if (!existsSync(f)) continue
  try {
    const saved = JSON.parse(readFileSync(f, 'utf8'))
    if (Array.isArray(saved.stories) && saved.stories.length) storyCount = saved.stories.length
    break
  } catch {}
}
const countWord = ['one', 'two', 'three', 'four'][storyCount - 1] || String(storyCount)

const caption = humanize(`The ${countWord} stories worth your ${partOfDay} - in 30 seconds.

Full briefs, sources and context → informalbuff.vercel.app

#news #india #tech #business #worldnews #informalbuff`)

// Cover: the front-page card for this edition, built from the post's own slugs.
let coverUrl = process.env.REEL_COVER_URL || null
if (!coverUrl) {
  const many = process.env.REEL_COVER_SLUGS
  const lead = process.env.REEL_COVER_SLUG
  if (many) coverUrl = `${SITE}/api/cover?slugs=${many.split(',').map(encodeURIComponent).join(',')}`
  else if (lead) coverUrl = `${SITE}/api/cover?slug=${encodeURIComponent(lead)}`
}

if (DRY_RUN) {
  console.log('dry run — would publish:', OUT)
  console.log('caption:', caption.split('\n')[0])
  console.log('cover:', coverUrl || 'none')
  process.exit(0)
}

/**
 * Delayed runs are routine on GitHub. If Instagram posted within the last 20
 * minutes, this reel would duplicate the edition that just shipped, so skip.
 */
async function recentlyPosted(token, igUserId, minutes = 180) {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${igUserId}/media?fields=timestamp,media_type&limit=1&access_token=${token}`,
    )
    const json = await res.json()
    const last = json?.data?.[0]
    if (!last?.timestamp) return false
    // Only a recent REEL blocks another reel. A carousel posted a minute ago is
    // the very thing this reel belongs to.
    if (last.media_type !== 'VIDEO') return false
    const age = (Date.now() - new Date(last.timestamp).getTime()) / 60000
    return age < minutes
  } catch {
    return false
  }
}

if (await recentlyPosted(TOKEN, IG_USER_ID)) {
  console.log('instagram posted within 20 minutes — skipping this reel to avoid a duplicate')
  process.exit(0)
}

// R2 first (no egress bill, 10GB free), Cloudinary as the fallback so a
// missing R2 configuration never stops a reel going out.
const stamp = new Date().toISOString().slice(0, 10)
const key = `reels/${stamp}-${Date.now()}.mp4`

// Free hosts first: GitHub release assets need no card and carry no egress
// bill, R2 is next, Cloudinary is the last resort because video eats credits.
let videoUrl
if (releaseHostingConfigured()) {
  videoUrl = await uploadReelToGitHub(OUT, `reel-${stamp}-${Date.now()}.mp4`)
  console.log('hosted on github release', videoUrl)
} else if (r2Configured()) {
  videoUrl = await uploadToR2(OUT, key)
  console.log('hosted on r2', videoUrl)
} else {
  videoUrl = await uploadVideoToCloudinary(OUT)
  console.log('hosted on cloudinary', videoUrl)
}

// Each network is isolated: a Facebook or Telegram failure must not cost us
// the Instagram reel, and vice versa.
const result = { videoUrl, igReelId: null, fbVideoId: null, telegram: null }

try {
  result.igReelId = await publishReel({ igUserId: IG_USER_ID, token: TOKEN, videoUrl, caption, coverUrl })
  if (coverUrl) result.coverUrl = coverUrl
} catch (err) {
  console.error(`instagram failed: ${String(err).slice(0, 160)}`)
}

try {
  result.fbVideoId = await postVideoToFacebookPage({
    pageId: process.env.META_PAGE_ID,
    token: TOKEN,
    videoUrl,
    description: caption,
  })
} catch (err) {
  console.error(`facebook failed: ${String(err).slice(0, 160)}`)
}

try {
  result.telegram = await sendVideoToTelegram({
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHANNEL,
    videoUrl,
    file: OUT,
    caption: `The three stories worth your ${partOfDay} — in 30 seconds.`,
  })
} catch (err) {
  console.error(`telegram failed: ${String(err).slice(0, 160)}`)
}

// A green run that posted nothing is worse than a red one: the slot looks
// delivered when it is not. Non-zero exit makes GitHub show the miss.
if (!result.igReelId) process.exitCode = 1

console.log(JSON.stringify(result))
