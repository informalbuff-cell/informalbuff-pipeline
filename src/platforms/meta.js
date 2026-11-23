// Facebook Page link post and Instagram single-image publish.
// Instagram uses the container flow: create → poll → publish.

import { meta } from '../config.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

async function graph(path, params, token) {
  const res = await fetch(`${GRAPH}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...params, access_token: token }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(`meta ${path}: ${data.error?.message || res.status}`);
  return data;
}

export async function postFacebook(article, pack, link) {
  if (!meta.enabled) return { skipped: 'facebook not configured' };
  const data = await graph(`${meta.pageId}/feed`, { message: pack.facebook, link }, meta.pageToken);
  return { ok: true, id: data.id };
}

export async function postInstagram(article, pack, card) {
  if (!meta.igEnabled) return { skipped: 'instagram not configured' };
  if (!card) return { skipped: 'instagram needs an image' };

  const container = await graph(`${meta.igUserId}/media`, { image_url: card, caption: pack.instagram }, meta.pageToken);

  // Instagram needs a moment to ingest the image before publishing.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((r) => setTimeout(r, 3000));
    const status = await fetch(
      `${GRAPH}/${container.id}?fields=status_code&access_token=${meta.pageToken}`,
    ).then((r) => r.json());
    if (status.status_code === 'FINISHED') break;
    if (status.status_code === 'ERROR') throw new Error('instagram: container failed');
  }

  const published = await graph(`${meta.igUserId}/media_publish`, { creation_id: container.id }, meta.pageToken);
  return { ok: true, id: published.id };
}
