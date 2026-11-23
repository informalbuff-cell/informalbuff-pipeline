// Telegram: sendPhoto with caption, falling back to text if the image fails.

import { telegram } from '../config.js';

const MAX_CAPTION = 1000;

export async function post(article, pack, card) {
  if (!telegram.enabled) return { skipped: 'telegram not configured' };

  const caption = pack.telegram.length > MAX_CAPTION
    ? `${pack.telegram.slice(0, MAX_CAPTION - 1)}…`
    : pack.telegram;

  const method = card ? 'sendPhoto' : 'sendMessage';
  const body = card
    ? { chat_id: telegram.channel, photo: card, caption, parse_mode: 'HTML' }
    : { chat_id: telegram.channel, text: caption, parse_mode: 'HTML', disable_web_page_preview: false };

  const res = await fetch(`https://api.telegram.org/bot${telegram.token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!data.ok) {
    // A rejected photo (size, format) should not lose the story.
    if (method === 'sendPhoto') {
      const retry = await fetch(`https://api.telegram.org/bot${telegram.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: telegram.channel, text: caption, parse_mode: 'HTML' }),
      });
      const retryData = await retry.json();
      if (!retryData.ok) throw new Error(`telegram: ${retryData.description}`);
      return { ok: true, via: 'text', message_id: retryData.result.message_id };
    }
    throw new Error(`telegram: ${data.description}`);
  }

  return { ok: true, message_id: data.result.message_id };
}
