/**
 * Publish a rendered reel to Instagram.
 *
 * Instagram cannot attach its in-app music library to an API upload, so the
 * track has to be baked into the MP4 (we generate our own, so we own it). The
 * trial-reel feature is app-only too — no API exists for it.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const GRAPH = 'https://graph.facebook.com/v21.0'

export async function uploadVideoToCloudinary(file) {
  const cloud = process.env.CLOUDINARY_CLOUD
  const key = process.env.CLOUDINARY_API_KEY
  const secret = process.env.CLOUDINARY_API_SECRET
  if (!cloud || !key || !secret) throw new Error('cloudinary not configured')

  const timestamp = Math.floor(Date.now() / 1000)
  const folder = 'informalbuff/reels'
  // Cloudinary signs the sorted params (minus file/api_key/cloud_name/resource_type).
  const toSign = `folder=${folder}&timestamp=${timestamp}`
  const signature = createHash('sha1').update(`${toSign}${secret}`).digest('hex')

  const bytes = await readFile(file)
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: 'video/mp4' }), 'reel.mp4')
  form.append('api_key', key)
  form.append('timestamp', String(timestamp))
  form.append('folder', folder)
  form.append('signature', signature)

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/video/upload`, {
    method: 'POST',
    body: form,
  })
  const json = await res.json()
  if (!json.secure_url) throw new Error(`cloudinary: ${JSON.stringify(json).slice(0, 200)}`)
  return json.secure_url
}

async function graph(path, params, method = 'POST') {
  const body = new URLSearchParams(params).toString()
  const url = method === 'GET' ? `${GRAPH}/${path}?${body}` : `${GRAPH}/${path}`
  const res = await fetch(url, {
    method,
    ...(method === 'GET' ? {} : { body }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })
  const json = await res.json()
  if (json.error) throw new Error(`${path}: ${json.error.message}`)
  return json
}

/** Reels transcode asynchronously: the container must reach FINISHED first. */
async function waitForContainer(id, token, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    const r = await graph(id, { fields: 'status_code,status', access_token: token }, 'GET')
    if (r.status_code === 'FINISHED') return
    if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') {
      throw new Error(`reel container ${r.status_code}: ${r.status || ''}`)
    }
    await new Promise((r2) => setTimeout(r2, 5000))
  }
  throw new Error('reel container timed out')
}

export async function publishReel({ igUserId, token, videoUrl, caption }) {
  const container = await graph(`${igUserId}/media`, {
    media_type: 'REELS',
    video_url: videoUrl,
    caption,
    share_to_feed: 'true',
    access_token: token,
  })
  await waitForContainer(container.id, token)
  const published = await graph(`${igUserId}/media_publish`, {
    creation_id: container.id,
    access_token: token,
  })
  return published.id
}

/** Facebook: a Page video post from the hosted file. */
export async function postVideoToFacebookPage({ pageId, token, videoUrl, description }) {
  const res = await fetch(`${GRAPH}/${pageId}/videos`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ file_url: videoUrl, description, access_token: token }).toString(),
  })
  const json = await res.json()
  if (json.error) throw new Error(json.error.message)
  return json.id
}

/** Telegram: the same MP4 as a native video, plays inline in the channel. */
export async function sendVideoToTelegram({ token, chatId, videoUrl, caption }) {
  if (!token || !chatId) throw new Error('telegram not configured')
  const res = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      video: videoUrl,
      caption,
      supports_streaming: true,
    }),
  })
  const json = await res.json()
  if (!json.ok) throw new Error(json.description)
  return { ok: true, messageId: json.result.message_id }
}
