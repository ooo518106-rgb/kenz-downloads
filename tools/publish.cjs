// Public binary mirror: fetch only an installer-specific signed GitHub asset.
// No private repository token, application source or accounting data is used.
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
(async () => {
  const event = JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const input = event.inputs || {}, url = new URL(input.download_url);
  if (url.protocol !== 'https:' || url.hostname !== 'release-assets.githubusercontent.com' || url.username || url.password) throw new Error('Only signed GitHub release assets are allowed');
  if (!/^desktop-v\d+\.\d+\.\d+$/.test(input.version) || !/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error('Invalid version or checksum');
  console.log('::add-mask::' + input.download_url);
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok || !response.body) throw new Error('Installer ticket expired or download failed (' + response.status + ')');
  const output = await fs.open('Kenz-Setup.exe', 'w'), hash = crypto.createHash('sha256');
  let size = 0, signature = Buffer.alloc(0);
  try {
    for await (const part of response.body) {
      size += part.length;
      if (size > 250 * 1024 * 1024) throw new Error('Installer exceeds maximum size');
      if (signature.length < 2) signature = Buffer.concat([signature, Buffer.from(part).subarray(0, 2 - signature.length)]);
      hash.update(part); await output.write(part);
    }
  } finally { await output.close(); }
  if (size < 10000000 || signature.toString('ascii') !== 'MZ' || hash.digest('hex') !== input.sha256) throw new Error('Installer checksum or format mismatch; nothing published');
  await fs.writeFile('SHA256SUMS.txt', input.sha256 + '  Kenz-Setup.exe\n');
  const repo = process.env.GITHUB_REPOSITORY;
  let existing = null;
  try { existing = JSON.parse(execFileSync('gh', ['api', 'repos/' + repo + '/releases/tags/' + input.version], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch {}
  if (existing) {
    const asset = existing.assets.find(a => a.name === 'Kenz-Setup.exe');
    if (asset?.digest !== 'sha256:' + input.sha256) throw new Error('Version already exists with a different or missing installer; nothing overwritten');
    console.log('Verified existing public release ' + input.version); return;
  }
  execFileSync('gh', ['release', 'create', input.version, 'Kenz-Setup.exe', 'SHA256SUMS.txt', '--repo', repo, '--title', 'كنز لويندوز ' + input.version.replace('desktop-v', ''), '--notes', 'تحميل كنز لويندوز بدون حساب GitHub. ثبّته فوق النسخة القديمة للمحافظة على بياناتك. المصدر الخاص بالتطوير منفصل عن هذا المستودع. تحقق من بصمة SHA-256 في الملف المرفق. تحديثات الواجهة تصل من موقع كنز عند الاتصال بالإنترنت.'], { stdio: 'inherit' });
  console.log('Published verified Windows installer: ' + input.version + ', bytes=' + size);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
