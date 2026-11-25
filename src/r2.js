/**
 * Cloudflare R2 upload, hand-rolled SigV4 so no dependency is needed.
 *
 * R2's free tier is 10GB storage with no egress charges, which is the right
 * home for daily video: Cloudinary's credits are sized for images, and video
 * processing eats them in weeks.
 *
 * Needs three environment values, all from the Cloudflare dashboard:
 *   R2_ACCOUNT_ID  R2_ACCESS_KEY_ID  R2_SECRET_ACCESS_KEY
 * plus R2_BUCKET (default: informalbuff) and R2_PUBLIC_BASE, the public
 * r2.dev or custom domain the bucket is served from.
 */
import { createHash, createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const sha256 = (data) => createHash('sha256').update(data).digest('hex')
const hmac = (key, data) => createHmac('sha256', key).update(data).digest()

export function r2Configured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_PUBLIC_BASE,
  )
}

export async function uploadToR2(file, key) {
  const account = process.env.R2_ACCOUNT_ID
  const bucket = process.env.R2_BUCKET || 'informalbuff'
  const accessKey = process.env.R2_ACCESS_KEY_ID
  const secret = process.env.R2_SECRET_ACCESS_KEY
  const host = `${account}.r2.cloudflarestorage.com`
  const region = 'auto'
  const service = 's3'

  const body = await readFile(file)
  const payloadHash = sha256(body)

  const now = new Date()
  const amzDate = `${now.toISOString().replace(/[:-]|\.\d{3}/g, '')}`
  const dateStamp = amzDate.slice(0, 8)

  const canonicalUri = `/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`
  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = ['PUT', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')

  const scope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n')

  let key2 = hmac(`AWS4${secret}`, dateStamp)
  key2 = hmac(key2, region)
  key2 = hmac(key2, service)
  key2 = hmac(key2, 'aws4_request')
  const signature = createHmac('sha256', key2).update(stringToSign).digest('hex')

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  const res = await fetch(`https://${host}${canonicalUri}`, {
    method: 'PUT',
    headers: {
      authorization,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      'content-type': 'video/mp4',
      'cache-control': 'public, max-age=31536000, immutable',
    },
    body,
  })

  if (!res.ok) {
    throw new Error(`r2 ${res.status}: ${(await res.text()).slice(0, 160)}`)
  }

  const base = process.env.R2_PUBLIC_BASE.replace(/\/$/, '')
  return `${base}/${key}`
}
