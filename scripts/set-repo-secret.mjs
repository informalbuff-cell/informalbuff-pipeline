import sodium from 'libsodium-wrappers'

/**
 * Put a secret into the pipeline repo without gh CLI.
 * Usage: GH_TOKEN=... node scripts/set-repo-secret.mjs NAME VALUE
 */
const [name, value] = process.argv.slice(2)
const token = process.env.GH_TOKEN
const repo = process.env.REPO || 'informalbuff-cell/informalbuff-pipeline'

if (!name || !value) {
  console.error('usage: NAME VALUE')
  process.exit(1)
}
if (!token) {
  console.error('GH_TOKEN missing')
  process.exit(1)
}

const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' }
const pk = await fetch(`https://api.github.com/repos/${repo}/actions/secrets/public-key`, { headers }).then((r) => r.json())
if (!pk.key) {
  console.error('no public key:', JSON.stringify(pk).slice(0, 200))
  process.exit(1)
}

await sodium.ready
const sealed = sodium.crypto_box_seal(sodium.from_string(value), sodium.from_base64(pk.key, sodium.base64_variants.ORIGINAL))

const res = await fetch(`https://api.github.com/repos/${repo}/actions/secrets/${name}`, {
  method: 'PUT',
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify({ encrypted_value: sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL), key_id: pk.key_id }),
})

console.log(name, '→', res.status, res.status === 201 || res.status === 204 ? 'ok' : await res.text())
