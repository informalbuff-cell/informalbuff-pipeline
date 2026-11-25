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
const MAX_DESKS = Number(process.env.MAX_DESKS || 4)
// Instagram allows 25 API publishes per rolling 24h. Four slots x four desks
// keeps us at 16, well clear of the cap; the 06:00 signature post counts once.
const hourIst = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(new Date()))
const SIGNATURE = process.env.SIGNATURE === 'true' || (process.env.EDITION_AUTO !== 'false' && hourIst === 6)
const only = (process.env.DESKS || '').split(',').map((d) => d.trim()).filter(Boolean)
const DESKS = only.length
  ? only
  : ['tech', 'world', 'india', 'business', 'markets', 'science', 'health']
const edition =
  process.argv[2] ||
  (hourIst < 11 ? 'morning' : hourIst < 16 ? 'afternoon' : hourIst < 21 ? 'evening' : 'night')
const DRY_RUN = process.env.DRY_RUN === 'true'
const SKIP_META = process.env.SKIP_META === 'true'

const log = (...a) => console.log(...a)

/**
 * JPEG straight from the site. Instagram refuses some PNGs, and asking
 * Cloudinary to transcode burned a credit per image — encoding is done in the
 * poster route instead, so social costs nothing.
 */
function jpegUrl(posterUrl) {
  return posterUrl.includes('?') ? `${posterUrl}&ext=jpg` : `${posterUrl}?ext=jpg`
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
  const res = await fetch(`${SITE}/api/bundle?desk=${desk}&limit=10&platform=instagram&edition=${edition}`, {
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


async function pushSignature() {
  const res = await fetch(`${SITE}/api/bundle?signature=morning&limit=10&platform=instagram&edition=${edition}`, {
    headers: { 'x-ingest-key': INGEST_KEY },
  })
  const data = await res.json()
  if (!data.ok) throw new Error(`signature: ${data.error}`)
  const stories = data.stories || []
  if (!stories.length) return { skipped: 'no stories in 24h' }
  log(`signature: ${stories.length} desks → ${stories.length} images`)

  if (DRY_RUN) return { dryRun: true, count: stories.length }
  if (SKIP_META) return { count: stories.length, skippedMeta: true }

  const images = stories.map((s) => s.cards.poster)
  let igId = null
  if (meta.igEnabled) {
    const children = []
    for (const img of images.slice(0, 10)) {
      const c = await graph(`${meta.igUserId}/media`, { image_url: jpegUrl(img), is_carousel_item: 'true' })
      children.push(c.id)
    }
    for (const id of children) await waitFor(id)
    const car = await graph(`${meta.igUserId}/media`, {
      media_type: 'CAROUSEL',
      children: children.join(','),
      caption: data.captions.instagram,
    })
    await waitFor(car.id)
    const pub = await graph(`${meta.igUserId}/media_publish`, { creation_id: car.id })
    igId = pub.id
  }

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

  let tg = null
  try {
    tg = await pushTelegram('signature', data)
  } catch (err) {
    tg = { error: String(err).slice(0, 120) }
  }

  return { signature: true, count: images.length, igId, fbId, telegram: tg }
}

async function pushMixed() {
  const res = await fetch(`${SITE}/api/bundle?mixed=1&limit=10&platform=instagram&edition=${edition}`, {
    headers: { 'x-ingest-key': INGEST_KEY },
  })
  const data = await res.json()
  if (!data.ok) throw new Error(`mixed: ${data.error}`)
  const stories = data.stories || []
  if (!stories.length) return { skipped: 'nothing unpublished in 24h' }

  log(`mixed: ${stories.length} stories across ${new Set(stories.map(s => s.category)).size} desks`)
  if (DRY_RUN) return { dryRun: true, count: stories.length }

  const images = stories.map((s) => s.cards.poster)
  const slugs = stories.map((s) => s.slug)

  let igId = null
  if (meta.igEnabled && !SKIP_META) {
    if (images.length === 1) {
      const c = await graph(`${meta.igUserId}/media`, { image_url: jpegUrl(images[0]), caption: data.captions.instagram })
      await waitFor(c.id)
      igId = (await graph(`${meta.igUserId}/media_publish`, { creation_id: c.id })).id
    } else {
      const children = []
      for (const img of images.slice(0, 10)) {
        const c = await graph(`${meta.igUserId}/media`, { image_url: jpegUrl(img), is_carousel_item: 'true' })
        children.push(c.id)
      }
      for (const id of children) await waitFor(id)
      const car = await graph(`${meta.igUserId}/media`, {
        media_type: 'CAROUSEL',
        children: children.join(','),
        caption: data.captions.instagram,
      })
      await waitFor(car.id)
      igId = (await graph(`${meta.igUserId}/media_publish`, { creation_id: car.id })).id
    }
  }

  let fbId = null
  if (meta.enabled && !SKIP_META) {
    try {
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
    } catch (err) {
      // A Page-permission gap must not block Instagram or Telegram.
      console.error(`facebook failed: ${String(err).slice(0, 120)}`)
      fbId = null
    }
  }

  let tg = null
  try {
    tg = await pushTelegram('mixed', data)
  } catch (err) {
    tg = { error: String(err).slice(0, 120) }
  }

  // Only mark when the networks that matter actually received the post. A
  // Telegram-only run (Meta down) must leave the stories for the next attempt.
  if (!igId && !fbId) return { count: images.length, igId, fbId, telegram: tg, marked: false }

  try {
    await fetch(`${SITE}/api/admin/mark-pushed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ingest-key': INGEST_KEY },
      body: JSON.stringify({ slugs }),
    })
  } catch {}

  return { count: images.length, igId, fbId, telegram: tg }
}

const results = []
try {
  results.push(await pushMixed())
} catch (err) {
  results.push({ error: String(err).slice(0, 200) })
  console.error(`mixed FAILED ${err}`)
}

log(`\n${edition} push complete`)
for (const r of results) log(JSON.stringify(r))
