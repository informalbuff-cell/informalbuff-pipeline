/**
 * Host reels as GitHub release assets.
 *
 * The repo is public, so release assets are served from GitHub's CDN with no
 * egress bill and no card on file — which is exactly what the video pipeline
 * needs. Cloudinary stays for images; video was burning its credits.
 *
 * In Actions, GITHUB_TOKEN and GITHUB_REPOSITORY are already present. Locally,
 * pass GH_TOKEN.
 */
import { readFile } from 'node:fs/promises'
import { statSync } from 'node:fs'

const API = 'https://api.github.com'

function token() {
  return process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ''
}

export function releaseHostingConfigured() {
  return Boolean(token() && (process.env.GITHUB_REPOSITORY || process.env.REPO))
}

async function gh(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token()}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }
  if (!res.ok) throw new Error(`github ${path} ${res.status}: ${text.slice(0, 160)}`)
  return json
}

/** One rolling release holds every reel, so the releases page stays tidy. */
async function ensureRelease(repo, tag) {
  try {
    return await gh(`/repos/${repo}/releases/tags/${tag}`)
  } catch {
    return gh(`/repos/${repo}/releases`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        name: `Reels ${tag}`,
        body: 'Rendered reels, published automatically by the pipeline.',
        draft: false,
        prerelease: false,
      }),
    })
  }
}

export async function uploadReelToGitHub(file, filename) {
  const repo = process.env.GITHUB_REPOSITORY || process.env.REPO
  const tag = 'reels'

  const release = await ensureRelease(repo, tag)
  const bytes = await readFile(file)

  const base = release.upload_url.split('{')[0]
  const res = await fetch(`${base}?name=${encodeURIComponent(filename)}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token()}`,
      accept: 'application/vnd.github+json',
      'content-type': 'video/mp4',
      'content-length': String(statSync(file).size),
    },
    body: bytes,
  })

  const json = await res.json()
  if (!res.ok || !json.browser_download_url) {
    throw new Error(`upload ${res.status}: ${JSON.stringify(json).slice(0, 160)}`)
  }
  return json.browser_download_url
}
