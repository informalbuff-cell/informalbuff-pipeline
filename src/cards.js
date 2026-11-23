// Social cards are rendered by the site itself at /api/og (Satori at the edge).
// The pipeline only builds URLs, so nothing is rendered or stored locally.

import { SITE } from './config.js';

const SIZES = { link: 'link', square: 'square', portrait: 'portrait', story: 'story' };

/** Cloudinary delivery URL sized for a card background (keeps bandwidth low). */
function backdrop(imageUrl = '', width = 1200) {
  const match = imageUrl.match(/res\.cloudinary\.com\/([^/]+)\/image\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z0-9]+)?$/i);
  if (!match) return '';
  const [, cloud, id] = match;
  return `https://res.cloudinary.com/${cloud}/image/upload/w_${width},c_fill,q_auto,f_jpg/${id}.jpg`;
}

export function cardUrl({ imageUrl, headline, kicker = 'INFORMALBUFF', format = 'link' }) {
  const size = SIZES[format] || 'link';
  const width = size === 'story' || size === 'portrait' || size === 'square' ? 1080 : 1200;
  const params = new URLSearchParams({
    title: headline,
    size,
    kicker,
  });
  const bg = backdrop(imageUrl, width);
  if (bg) params.set('img', bg);
  return `${SITE}/api/og?${params.toString()}`;
}

export const storyCard = ({ imageUrl, headline }) => cardUrl({ imageUrl, headline, format: 'story' });
export const portraitCard = ({ imageUrl, headline }) => cardUrl({ imageUrl, headline, format: 'portrait' });
