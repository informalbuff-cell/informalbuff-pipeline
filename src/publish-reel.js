/**
 * One command: render the day's reel, host it, publish it to Instagram.
 * Runs from the reel workflow only, so it can never block the carousel push.
 */
import { existsSync } from 'node:fs'
import { publishReel, uploadVideoToCloudinary } from './reel.js'

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

const videoUrl = await uploadVideoToCloudinary(OUT)
console.log('hosted', videoUrl)

const id = await publishReel({ igUserId: IG_USER_ID, token: TOKEN, videoUrl, caption })
console.log(JSON.stringify({ ok: true, igReelId: id, videoUrl }))
