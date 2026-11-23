// Reads the public site: sitemap for slugs, admin API for article bodies.

import { SITE, INGEST_KEY } from './config.js';

async function get(path, init = {}) {
  const res = await fetch(`${SITE}${path}`, {
    ...init,
    headers: { 'x-ingest-key': INGEST_KEY, 'user-agent': 'InformalBuffPipeline/0.1', ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res;
}

export async function listSlugs() {
  const res = await get('/sitemap.xml');
  const xml = await res.text();
  const slugs = [...xml.matchAll(/<loc>[^<]*\/article\/([a-z0-9-]+)<\/loc>/g)].map((m) => m[1]);
  return [...new Set(slugs)];
}

export async function getArticle(slug) {
  const res = await get(`/api/admin/article?slug=${encodeURIComponent(slug)}`);
  const data = await res.json();
  return data.article || null;
}

export async function recentArticles(limit = 30) {
  const slugs = await listSlugs();
  const out = [];
  for (const slug of slugs.slice(0, limit)) {
    try {
      const article = await getArticle(slug);
      if (article?.status === 'published') out.push(article);
    } catch {
      // a single bad record must not stop the run
    }
  }
  return out.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
}

export function plainText(html = '') {
  return html
    .replace(/<h[1-6][^>]*>/gi, ' ')
    .replace(/<\/(p|h[1-6]|li|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function lede(html = '') {
  const text = plainText(html);
  const quick = text.match(/Quick answer:\s*([\s\S]*?)(?:\n|Key facts)/i);
  const source = quick ? quick[1] : text;
  const firstSentence = source.split(/(?<=[.!?])\s/)[0] || source;
  return firstSentence.replace(/\s+/g, ' ').trim();
}
