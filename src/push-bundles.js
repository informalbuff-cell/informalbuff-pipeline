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
import { writeFileSync } from 'node:fs'
import { SITE, meta, INGEST_KEY, telegram } from './config.js'
import { humanize, lintCaption } from './ig-copy.js'

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
/** The reel workflow owns the 20:30 Instagram slot on days it runs. */
const SKIP_IG = process.env.SKIP_IG === 'true'
/** Facebook is also covered by the reel at the 20:30 slot. */
const SKIP_FB = process.env.SKIP_FB === 'true'
/** Recaps are only allowed in the first hour of an edition window. */
const ALLOW_RECAP = process.env.ALLOW_RECAP !== '0'

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

/** Facebook: the same poster carousel Instagram gets, as one multi-photo post
 *  with the caption. Uploads are unpublished first, then attached, so they
 *  belong to the post instead of sitting loose in the Photos album. */
async function postFacebook(pageId, images, message) {
  const ids = []
  for (const img of images.slice(0, 10)) {
    const r = await graph(`${pageId}/photos`, { url: img, published: 'false' })
    ids.push(r.id)
  }
  const post = await graph(`${pageId}/feed`, {
    message,
    attached_media: JSON.stringify(ids.map((id) => ({ media_fbid: id }))),
  })
  return post.id
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


/** Hand the published stories to the reel renderer, whichever path ran. */
function recordBundle(stories) {
  try {
    writeFileSync(
      'last-bundle.json',
      JSON.stringify({
        edition,
        at: new Date().toISOString(),
        stories: stories.slice(0, 3).map((s) => ({ slug: s.slug, title: s.title, cards: s.cards })),
      }),
    )
  } catch (err) {
    console.log(`could not write last-bundle.json: ${err.message}`)
  }
}

async function pushDesk(desk) {
  const data = await bundle(desk)
  const stories = data.stories || []
  if (!stories.length) {
    log(`${desk}: nothing recent, skipped`)
    return { desk, skipped: 'empty' }
  }

  // Slide 1 is the one-line hook card; the posters follow. This is the format
  // every large news account uses — a poster alone is unreadable at feed size.
  // Slide one is the split card (photo + three facts) — the layout that stops
  // the scroll. Posters carry the detail behind it.
  const splitCard = null
  // Six slides, not ten: each Instagram image costs two API calls (create +
  // poll) and a ten-image carousel is what keeps tripping the app-level rate
  // limit. Six reads better on a phone anyway.
  const images = [
    ...(splitCard ? [splitCard] : []),
    ...stories.map((s) => s.cards.poster),
  ].slice(0, 6)
  // Machine-written captions carry tells (dashes, slop verbs). Clean them
  // before they reach the feed and say so when the first line is too long.
  const caption = humanize(data.captions.instagram)
  const captionIssues = lintCaption(caption)
  if (captionIssues.length) log(`${desk}: caption — ${captionIssues.join(', ')}`)
  log(`${desk}: ${stories.length} stories → ${images.length} images`)

  recordBundle(stories)
  if (DRY_RUN) return { desk, dryRun: true, count: images.length, caption: caption.slice(0, 80) }
  if (SKIP_META) return { desk, count: images.length, skippedMeta: true }

  if (!meta.igEnabled) return { desk, skipped: 'instagram not configured' }

  // Instagram: single image when one story, carousel otherwise.
  let igId
  if (images.length === 1) {
    const c = await graph(`${meta.igUserId}/media`, { image_url: jpegUrl(images[0]), caption })
    await waitFor(c.id)
    const p = await withThrottleRetry(
      () => graph(`${meta.igUserId}/media_publish`, { creation_id: c.id }),
      'instagram publish',
    )
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
    const p = await withThrottleRetry(
      () => graph(`${meta.igUserId}/media_publish`, { creation_id: carousel.id }),
      'instagram publish',
    )
    igId = p.id
  }

  // Facebook: one published photo post (cover poster + caption).
  let fbId = null
  if (meta.enabled && !SKIP_FB) {
    fbId = await postFacebook(meta.pageId, images, data.captions.facebook)
  }

  return { desk, count: images.length, igId, fbId }
}

/** Telegram album: the same posters, caption on the first item. */
async function pushTelegram(desk, data, given) {
  if (!telegram.enabled) return { skipped: 'telegram channel not configured' }
  const stories = given || data.stories || []
  if (!stories.length) return { skipped: 'empty' }

  const media = stories.slice(0, 10).map((s, i) => ({
    type: 'photo',
    media: jpegUrl(s.cards.poster),
    ...(i === 0 ? { caption: data.captions.telegram.slice(0, 950), parse_mode: 'HTML' } : {}),
  }))

  const res = await fetch(`https://api.telegram.org/bot${telegram.token}/sendMediaGroup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: telegram.channel, media }),
  })
  const json = await res.json()
  if (!json.ok) throw new Error(`telegram: ${json.description}`)
  return { ok: true, messages: json.result?.length ?? 0, ids: (json.result || []).map((m) => m.message_id) }
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

  recordBundle(stories)
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
  if (meta.enabled && !SKIP_FB) {
    fbId = await postFacebook(meta.pageId, images, data.captions.facebook)
  }

  let tg = null
  try {
    tg = await pushTelegram('signature', data)
  } catch (err) {
    tg = { error: String(err).slice(0, 120) }
  }

  return { signature: true, count: images.length, igId, fbId, telegram: tg }
}


/** The day's biggest stories, read straight from the published feed. */
async function recapStories(limit) {
  const xml = await fetch(`${SITE}/feed.xml`).then((r) => r.text())
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit)
  const unescape = (t) =>
    t.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  return items
    .map((m) => {
      const chunk = m[1]
      const title = unescape(((chunk.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || '').trim())
      const link = ((chunk.match(/<link>([^<]+)<\/link>/) || [])[1] || '').trim()
      const slug = link.split('/article/')[1] || ''
      const category = ((chunk.match(/<category>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/category>/) || [])[1] || '').trim()
      return { title, slug, category, excerpt: '', cards: { poster: `${SITE}/api/poster2?slug=${encodeURIComponent(slug)}` } }
    })
    .filter((s) => s.title && s.slug)
}

/** Captions for a recap, since the bundle endpoint only captions fresh stories. */
function recapCaptions(stories, edition) {
  const stamp = edition === 'evening' ? 'Tonight' : edition === 'afternoon' ? 'This afternoon' : 'This morning'
  const head = stories[0]?.title || 'The stories that matter'
  const list = stories.slice(1, 4).map((s, i) => `${i + 2}. ${s.title}`).join('\n')
  const site = SITE.replace(/\/$/, '')
  const host = site.replace(/^https?:\/\//, '')
  return {
    instagram: `${head}\n\n${stamp} — a recap of the day in ${stories.length} stories:\n${list}\n\nSave this. Send it to one person who should see it.\nFollow @informal.buff for the next brief.\nFull stories, sources and context → link in bio (${host})\n\n#news #india #tech #business #worldnews #informalbuff`,
    facebook: `${head}\n\n${stamp} — a recap of the day in ${stories.length} stories:\n${list}\n\nEvery story is sourced and rewritten in our own words.\nFull stories, sources and context → ${site}\n\n#news #breakingnews #india #tech #business`,
    telegram: `${stamp} recap — ${stories.length} stories\n\n${stories.slice(0, 4).map((s) => `• ${s.title}\n${site}/article/${s.slug}`).join('\n')}\n\nEverything, with sources → ${site}`,
  }
}


/** True when a Meta post went out recently — used to stop a second-hour run
 *  from pushing a duplicate edition 75 minutes after the first. */
async function postedRecently(minutes = 180) {
  const token = process.env.META_PAGE_TOKEN
  const ig = process.env.IG_USER_ID
  if (!token || !ig) return false
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${ig}/media?fields=timestamp&limit=1&access_token=${token}`,
    )
    const json = await res.json()
    const last = json?.data?.[0]?.timestamp
    if (!last) return false
    return Date.now() - new Date(last).getTime() < minutes * 60 * 1000
  } catch {
    return false
  }
}


/**
 * The same lead story two editions running is what readers see as a double
 * post. Ask Instagram what it published last, and if the planned lead is the
 * same story, either lead with something else or skip the edition.
 */
async function lastPostedLead(minutes = 480) {
  const token = process.env.META_PAGE_TOKEN
  const ig = process.env.IG_USER_ID
  if (!token || !ig) return null
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${ig}/media?fields=caption,timestamp,media_type&limit=5&access_token=${token}`,
    )
    const json = await res.json()
    // Skip reels: their caption is the "N stories worth your evening" template,
    // so the useful comparison is the last carousel's lead line.
    const last = (json?.data || []).find(
      (m) => m?.caption && !/^The .* stories worth your/i.test(m.caption),
    )
    if (!last?.caption || !last?.timestamp) return null
    if (Date.now() - new Date(last.timestamp).getTime() > minutes * 60000) return null
    return last.caption.split('\n')[0].replace(/…$/, '').trim()
  } catch {
    return null
  }
}

const sameStory = (a, b) =>
  Boolean(a && b) && a.toLowerCase().slice(0, 38) === b.toLowerCase().slice(0, 38)


/**
 * Instagram's app-level throttle clears in minutes. Retrying with a growing
 * wait turns a lost slot into a late one; without it the carousel is simply
 * gone and only Facebook and Telegram get the edition.
 */
async function withThrottleRetry(fn, label, attempts = 3) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const msg = String(err && err.message ? err.message : err)
      if (!/limit reached|rate limit|too many/i.test(msg) || i === attempts - 1) throw err
      const wait = 45 * (i + 1) * 1000
      log(`${label}: throttled, waiting ${wait / 1000}s (attempt ${i + 1}/${attempts})`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw lastErr
}

async function pushMixed() {
  const res = await fetch(`${SITE}/api/bundle?mixed=1&limit=10&platform=instagram&edition=${edition}`, {
    headers: { 'x-ingest-key': INGEST_KEY },
  })
  const data = await res.json()
  if (!data.ok) throw new Error(`mixed: ${data.error}`)
  // Spacing is enforced by the clock, not by the window label: whatever hour a
  // delayed runner lands on, two carousels must never be 40 minutes apart.
  if (await postedRecently(150)) {
    return { skipped: 'a carousel posted within the last 2.5 hours' }
  }

  let stories = data.stories || []

  /**
   * A slot with nothing new is covered by a recap of the day's biggest
   * stories instead of going dark. The feed already carries them in order.
   */
  // Second-hour recap is blocked only when this edition already shipped. If
  // nothing posted recently, the slot is genuinely empty and a recap is the
  // difference between a late edition and no edition.
  if (!stories.length && !ALLOW_RECAP && (await postedRecently(180))) {
    return { skipped: 'nothing new, and this edition already posted' }
  }

  if (!stories.length) {
    stories = await recapStories(10)
    if (!stories.length) return { skipped: 'nothing unpublished and no recap available' }
    log(`nothing new — recapping ${stories.length} stories from the day`)
    data.captions = recapCaptions(stories, edition)
  }

  // One story once: the feed can carry the same headline twice, and the last
  // edition's lead must not lead again.
  const seenSlug = new Set()
  const seenTitle = new Set()
  stories = stories.filter((s) => {
    const t = (s.title || '').toLowerCase().replace(/[^a-z0-9 ]+/g, '').slice(0, 60)
    if (!s.slug || seenSlug.has(s.slug) || seenTitle.has(t)) return false
    seenSlug.add(s.slug)
    seenTitle.add(t)
    return true
  })

  const previousLead = await lastPostedLead()
  if (previousLead && stories.length && sameStory(stories[0]?.title, previousLead)) {
    const alt = stories.find((s) => !sameStory(s.title, previousLead))
    if (!alt) return { skipped: 'only story is the one already posted' }
    stories = [alt, ...stories.filter((s) => s !== alt)]
    log(`lead already posted — leading with "${alt.title.slice(0, 50)}"`)
  }

  log(`mixed: ${stories.length} stories across ${new Set(stories.map(s => s.category)).size} desks`)

  recordBundle(stories)


  // A published edition, not a rehearsal: the reel step reads this file so a run
  // that skipped the carousel cannot publish a stray reel.
  if (!DRY_RUN) {
    try {
      writeFileSync('edition-published.json', JSON.stringify({ at: new Date().toISOString(), edition, count: stories.length }))
    } catch (err) {
      log(`could not write edition-published.json: ${err.message}`)
    }
  }

  if (DRY_RUN) return { dryRun: true, count: stories.length }

  // The dense card is the image; the carousel is the story set, not a teaser.
  // Six slides: ten images is twenty API calls and that is what trips limits.
  // Four slides: six images means twelve API calls and that is what trips Meta.
  const images = stories.map((s) => s.cards.poster).slice(0, 4)
  const slugs = stories.map((s) => s.slug)

  let tg = null
  try {
    tg = await pushTelegram('mixed', data, stories)
  } catch (err) {
    tg = { error: String(err).slice(0, 120) }
  }

  // Only mark when the networks that matter actually received the post. A
  // Telegram-only run (Meta down) must leave the stories for the next attempt.
  let fbId = null
  if (meta.enabled && !SKIP_META && !SKIP_FB) {
    try {
      fbId = await postFacebook(meta.pageId, images, data.captions.facebook)
    } catch (err) {
      // A Page-permission gap must not block Instagram or Telegram.
      console.error(`facebook failed: ${String(err).slice(0, 120)}`)
      fbId = null
    }
  }

  let igId = null
  if (meta.igEnabled && !SKIP_META && !SKIP_IG) {
   try {
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
   } catch (err) {
     console.error(`instagram failed: ${String(err).slice(0, 120)}`)
     igId = null
   }
  }

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
