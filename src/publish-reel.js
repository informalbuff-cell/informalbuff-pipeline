/**
 * One command: render the day's reel, host it, publish it to Instagram.
 * Runs from the reel workflow only, so it can never block the carousel push.
 */
import { existsSync } from 'node:fs'
import { postVideoToFacebookPage, publishReel, sendVideoToTelegram, uploadVideoToCloudinary } from './reel.js'
import { r2Configured, uploadToR2 } from './r2.js'
import { releaseHostingConfigured, uploadReelToGitHub } from './gh-release.js'

const OUT = process.env.REEL_OUT || 'reel/out/reel.mp4'
const IG_USER_ID = process.env.IG_USER_ID
const TOKEN = process.env.META_PAGE_TOKEN
const DRY_RUN = process.env.DRY_RUN === 'true'

if (!existsSync(OUT)) {
  console.log(`no reel at ${OUT} — nothing to publish`)
  process.exit(0)
}

const caption = `The three stories worth your evening — in 30 seconds.

Full briefs, sources and context → informalbuff.vercel.app

#news #india #tech #business #worldnews #informalbuff`

if (DRY_RUN) {
  console.log('dry run: would upload and publish', OUT)
  process.exit(0)
}

/**
 * Delayed runs are routine on GitHub. If Instagram posted within the last 20
 * minutes, this reel would duplicate the edition that just shipped, so skip.
 */
async function recentlyPosted(token, igUserId, minutes = 20) {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${igUserId}/media?fields=timestamp&limit=1&access_token=${token}`,
    )
    const json = await res.json()
    const last = json?.data?.[0]?.timestamp
    if (!last) return false
    return Date.now() - new Date(last).getTime() < minutes * 60 * 1000
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
  result.igReelId = await publishReel({ igUserId: IG_USER_ID, token: TOKEN, videoUrl, caption })
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
    caption: 'The three stories worth your evening — in 30 seconds.',
  })
} catch (err) {
  console.error(`telegram failed: ${String(err).slice(0, 160)}`)
}

console.log(JSON.stringify(result))
