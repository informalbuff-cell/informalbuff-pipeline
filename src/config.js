// Shared configuration. Everything comes from environment variables so the
// same code runs in Actions and locally without edits.

export const SITE = (process.env.SITE_URL || 'https://informalbuff.vercel.app').replace(/\/$/, '');
export const INGEST_KEY = process.env.INGEST_API_KEY || '';
export const DRY_RUN = process.env.DRY_RUN !== 'false';
export const LIMIT = Number(process.env.MAX_POSTS || 1);

export const CLOUDINARY_CLOUD = process.env.CLOUDINARY_CLOUD || 'sq9i1aty';
export const CLOUDINARY_KEY = process.env.CLOUDINARY_KEY || '';
export const CLOUDINARY_SECRET = process.env.CLOUDINARY_SECRET || '';

export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

export const telegram = {
  token: process.env.TELEGRAM_BOT_TOKEN || '',
  channel: process.env.TELEGRAM_CHANNEL || '',
  get enabled() { return Boolean(this.token && this.channel); },
};

export const x = {
  apiKey: process.env.X_API_KEY || '',
  apiSecret: process.env.X_API_SECRET || '',
  accessToken: process.env.X_ACCESS_TOKEN || '',
  accessSecret: process.env.X_ACCESS_SECRET || '',
  get enabled() { return Boolean(this.apiKey && this.apiSecret && this.accessToken && this.accessSecret); },
};

export const meta = {
  pageId: process.env.META_PAGE_ID || '',
  pageToken: process.env.META_PAGE_TOKEN || '',
  igUserId: process.env.IG_USER_ID || '',
  get enabled() { return Boolean(this.pageId && this.pageToken); },
  get igEnabled() { return Boolean(this.igUserId && this.pageToken); },
};

export const youtube = {
  clientId: process.env.YT_CLIENT_ID || '',
  clientSecret: process.env.YT_CLIENT_SECRET || '',
  refreshToken: process.env.YT_REFRESH_TOKEN || '',
  get enabled() { return Boolean(this.clientId && this.clientSecret && this.refreshToken); },
};

export function requireKey(value, name) {
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}
