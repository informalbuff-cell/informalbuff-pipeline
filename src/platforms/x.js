// X: OAuth 1.0a request signing, v1.1 media upload, v2 tweet creation.

import crypto from 'node:crypto';
import { x } from '../config.js';

const enc = (s) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function oauthHeader(method, url, extraParams = {}) {
  const params = {
    oauth_consumer_key: x.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: x.accessToken,
    oauth_version: '1.0',
    ...extraParams,
  };

  const base = [
    method.toUpperCase(),
    enc(url),
    enc(
      Object.keys(params)
        .sort()
        .map((k) => `${enc(k)}=${enc(params[k])}`)
        .join('&'),
    ),
  ].join('&');

  const key = `${enc(x.apiSecret)}&${enc(x.accessSecret)}`;
  const signature = crypto.createHmac('sha1', key).update(base).digest('base64');

  const header = { ...params, oauth_signature: signature };
  return (
    'OAuth ' +
    Object.keys(header)
      .sort()
      .map((k) => `${enc(k)}="${enc(header[k])}"`)
      .join(', ')
  );
}

async function uploadMedia(imageUrl) {
  const img = await fetch(imageUrl);
  if (!img.ok) throw new Error(`x media fetch ${img.status}`);
  const buf = Buffer.from(await img.arrayBuffer());
  const url = 'https://upload.twitter.com/1.1/media/upload.json';
  const body = `media_data=${encodeURIComponent(buf.toString('base64'))}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: oauthHeader('POST', url),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`x media upload: ${data.errors?.[0]?.message || res.status}`);
  return data.media_id_string;
}

export async function post(article, pack, card) {
  if (!x.enabled) return { skipped: 'x not configured' };

  let mediaId = null;
  if (card) {
    try {
      mediaId = await uploadMedia(card);
    } catch (error) {
      console.warn(`x: continuing without image (${error.message})`);
    }
  }

  const url = 'https://api.twitter.com/2/tweets';
  const payload = { text: pack.x.slice(0, 280) };
  if (mediaId) payload.media = { media_ids: [mediaId] };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: oauthHeader('POST', url),
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`x: ${data.detail || data.title || res.status}`);
  return { ok: true, id: data.data?.id };
}
