#!/usr/bin/env node
/**
 * Post one carousel per desk to Instagram and Facebook.
 *
 *   node src/push-bundles.js [edition]
 *
 * Stories come from the site's bundle endpoint, so the images are the same
 * infographic posters the site renders — no separate card build here.
 * Instagram gets a carousel (max ten); Facebook gets the same images as a
 * multi-photo post.
 */
import { SITE, meta, INGEST_KEY, telegram } from './config.js'

const GRAPH = 'https://graph.facebook.com/v21.0'
const CLOUD = process.env.CLOUDINARY_CLOUD || 'sq9i1aty'
const only = (process.env.DESKS || '').split(',').map((d) => d.trim()).filter(Boolean)
const DESKS = only.length
  ? only
  : ['tech', 'world', 'india', 'business', 'markets', 'science', 'health']
const edition = process.argv[2] || 'morning'
const DRY_RUN = process.env.DRY_RUN === 'true'
const SKIP_META = process.env.SKIP_META === 'true'

const log = (...a) => console.log(...a)

/** Hosted JPEG for Instagram: Cloudinary fetches the poster we already render. */
function jpegUrl(posterUrl) {
  return `https://res.cloudinary.com/${CLOUD}/image/fetch/f_jpg,w_1080,q_auto/${encodeURIComponent(posterUrl)}`
}

async function graph(path, params, method = 'POST') {
  const body = new URLSearchParams({ ...params, access_token: meta.pageToken })
  const url = method === 'GET' ? `${GRAPH}/${path}?${body}` : `${GRAPH}/${path}`
  const res = await fetch(url, method === 'GET' ? undefined : { method, body })
  const json = await res.json()
  if (json.error) throw new Error(`${path}: ${json.error.message}`)
  return json
}

async function bundle(desk) {
  const res = await fetch(`${SITE}/api/bundle?desk=${desk}&limit=10&platform=instagram`, {
    headers: { 'x-ingest-key': INGEST_KEY },
  })
  const json = await res.json()
  if (!json.ok) throw new Error(`bundle ${desk}: ${json.error}`)
  return json
}

async function waitFor(id) {
  for (let i = 0; i < 30; i += 1) {
    const r = await graph(`${id}`, { fields: 'status_code' }, 'GET')
    if (r.status_code === 'FINISHED') return
    if (r.status_code === 'ERROR') throw new Error(`ig container ${id} failed`)
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error(`ig container ${id} timed out`)
}

async function pushDesk(desk) {
  const data = await bundle(desk)
  const stories = data.stories || []
  if (!stories.length) {
    log(`${desk}: nothing recent, skipped`)
    return { desk, skipped: 'empty' }
  }

  const images = stories.map((s) => s.cards.poster)
  const caption = data.captions.instagram
  log(`${desk}: ${stories.length} stories → ${images.length} images`)

  if (DRY_RUN) return { desk, dryRun: true, count: images.length, caption: caption.slice(0, 80) }
  if (SKIP_META) return { desk, count: images.length, skippedMeta: true }

  if (!meta.igEnabled) return { desk, skipped: 'instagram not configured' }

  // Instagram: single image when one story, carousel otherwise.
  let igId
  if (images.length === 1) {
    const c = await graph(`${meta.igUserId}/media`, { image_url: jpegUrl(images[0]), caption })
    await waitFor(c.id)
    const p = await graph(`${meta.igUserId}/media_publish`, { creation_id: c.id })
    igId = p.id
  } else {
    const children = []
    for (const img of images.slice(0, 10)) {
      const c = await graph(`${meta.igUserId}/media`, { image_url: jpegUrl(img), is_carousel_item: 'true' })
      children.push(c.id)
    }
    for (const id of children) await waitFor(id)
    const carousel = await graph(`${meta.igUserId}/media`, {
      media_type: 'CAROUSEL',
      children: children.join(','),
      caption,
    })
    await waitFor(carousel.id)
    const p = await graph(`${meta.igUserId}/media_publish`, { creation_id: carousel.id })
    igId = p.id
  }

  // Facebook: the same images as one multi-photo post.
  let fbId = null
  if (meta.enabled) {
    const photos = []
    for (const img of images.slice(0, 10)) {
      const r = await graph(`${meta.pageId}/photos`, { url: img, published: 'false' })
      photos.push(r.id)
    }
    const post = await graph(`${meta.pageId}/feed`, {
      message: data.captions.facebook,
      attached_media: JSON.stringify(photos.map((id) => ({ media_fbid: id }))),
    })
    fbId = post.id
  }

  return { desk, count: images.length, igId, fbId }
}

/** Telegram album: the same posters, caption on the first item. */
async function pushTelegram(desk, data) {
  if (!telegram.enabled) return { skipped: 'telegram channel not configured' }
  const stories = data.stories || []
  if (!stories.length) return { skipped: 'empty' }

  const media = stories.slice(0, 10).map((s, i) => ({
    type: 'photo',
    media: s.cards.poster,
    ...(i === 0 ? { caption: data.captions.telegram.slice(0, 950), parse_mode: 'HTML' } : {}),
  }))

  const res = await fetch(`https://api.telegram.org/bot${telegram.token}/sendMediaGroup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: telegram.channel, media }),
  })
  const json = await res.json()
  if (!json.ok) throw new Error(`telegram: ${json.description}`)
  return { ok: true, messages: json.result?.length ?? 0 }
}

const results = []
for (const desk of DESKS) {
  try {
    const pushed = await pushDesk(desk)
    if (!pushed.skipped) {
      try {
        const data = await bundle(desk)
        pushed.telegram = await pushTelegram(desk, data)
      } catch (err) {
        pushed.telegram = { error: String(err).slice(0, 120) }
      }
    }
    results.push(pushed)
  } catch (err) {
    results.push({ desk, error: String(err).slice(0, 200) })
    console.error(`${desk}: FAILED ${err}`)
  }
}

log(`\n${edition} push complete`)
for (const r of results) log(JSON.stringify(r))
