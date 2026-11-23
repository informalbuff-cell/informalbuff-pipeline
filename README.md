# InformalBuff pipeline

Automated publishing for [informalbuff.vercel.app](https://informalbuff.vercel.app): one article in, platform-shaped posts out — Telegram, X, and (once keys exist) Facebook, Instagram, YouTube Shorts.

Runs entirely on GitHub Actions. Nothing executes on a local machine, nothing is stored on disk beyond the repo itself.

## How it works

```
RSS / editorial queue
        │
        ▼
  article record (Neon, via the site's admin API)
        │
        ├── copy.js      → per-platform text (Telegram, X, FB, IG, YouTube)
        ├── cards.js     → Cloudinary transformation URLs (1200×630, 1080×1350, 1080×1920)
        └── platforms/*  → one module per network, each guarded by its own secrets
```

Default mode is **dry run**: it prints exactly what it would post and exits. Set `DRY_RUN=false` in the workflow to publish for real.

## Workflows

| File | Purpose |
| --- | --- |
| `.github/workflows/publish.yml` | Every 30 minutes: pick the newest unpublished article, build the pack, post to enabled platforms |
| `.github/workflows/keepalive.yml` | Monthly no-op commit — GitHub disables scheduled workflows after 60 days of repository inactivity |

## Secrets

Add these in Settings → Secrets and variables → Actions. Missing secrets simply disable that platform; the run still succeeds for the others.

| Secret | Required for |
| --- | --- |
| `INGEST_API_KEY` | Reading articles from the site |
| `SITE_URL` | Optional, defaults to the production URL |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL` | Telegram |
| `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` | X |
| `META_PAGE_ID`, `META_PAGE_TOKEN`, `IG_USER_ID` | Facebook Page, Instagram |
| `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN` | YouTube Shorts |
| `CLOUDINARY_CLOUD`, `CLOUDINARY_KEY`, `CLOUDINARY_SECRET` | Signed card URLs (optional; unsigned works for public assets) |
| `GEMINI_API_KEY` | Rewriting copy per platform (falls back to templates without it) |

## Local check

```bash
node src/run.js --dry-run
```

Prints the article it selected and every payload it would send. No network writes.

## Rules the pipeline follows

- Never invent facts. Copy is assembled from the article's own fields; the LLM step may rephrase, never add.
- One post per platform per article, recorded in `state/published.json` so a rerun cannot double-post.
- Every platform call is idempotent-guarded by that state file, and failures are reported, not retried blindly.
