// Per-platform copy. Templates by default; Gemini rewrites when a key exists,
// and is constrained to rephrasing — never new facts.

import { GEMINI_API_KEY, GEMINI_MODEL, SITE } from './config.js';
import { lede } from './site.js';

const HASHTAGS = {
  tech: '#AI #Tech #OpenAI',
  business: '#Business #Markets #Economy',
  world: '#World #Geopolitics #Europe',
  markets: '#Markets #Investing #Stocks',
  science: '#Science #Research #Space',
};

export function articleUrl(slug) {
  return `${SITE}/article/${slug}`;
}

export function templatePack(article) {
  const url = articleUrl(article.slug);
  const summary = lede(article.content);
  const tags = HASHTAGS[article.category] || '#News';
  const title = article.title || article.meta_title;

  return {
    telegram: `<b>${title}</b>\n\n${summary}\n\n<a href="${url}">Read the full story</a>`,
    x: `${title}\n\n${summary}`.slice(0, 250) + `\n\n${url}`,
    facebook: `${title}\n\n${summary}\n\nFull story: ${url}`,
    instagram: `${title}\n\n${summary}\n\nFull story in bio → informalbuff\n\n${tags}`,
    youtube: {
      title: `${title}`.slice(0, 95),
      description: `${summary}\n\nFull story: ${url}\n\n${tags}\n\nInformalBuff — news that gets to the point.`,
      tags: (article.tags || []).slice(0, 12),
    },
  };
}

/** Ask Gemini for tighter platform copy; falls back to templates on any failure. */
export async function buildPack(article) {
  const base = templatePack(article);
  if (!GEMINI_API_KEY) return base;

  const prompt = `Rewrite this news story for social platforms. Use ONLY facts present in the text.
Return strict JSON with keys: telegram, x, facebook, instagram, youtube_title, youtube_description.
Rules: x under 240 characters including the link; telegram under 700; no hashtag spam; no emojis;
instagram 3-5 relevant hashtags at the end; youtube_title under 95 characters.

Headline: ${article.title || article.meta_title}
Category: ${article.category}
Link: ${articleUrl(article.slug)}
Body: ${article.content.replace(/<[^>]+>/g, ' ').slice(0, 3000)}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
        }),
      },
    );
    if (!res.ok) throw new Error(`gemini ${res.status}`);
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const parsed = JSON.parse(text);
    return {
      ...base,
      telegram: parsed.telegram || base.telegram,
      x: parsed.x || base.x,
      facebook: parsed.facebook || base.facebook,
      instagram: parsed.instagram || base.instagram,
      youtube: {
        ...base.youtube,
        title: parsed.youtube_title || base.youtube.title,
        description: parsed.youtube_description || base.youtube.description,
      },
    };
  } catch (error) {
    console.warn(`copy: falling back to templates (${error.message})`);
    return base;
  }
}
