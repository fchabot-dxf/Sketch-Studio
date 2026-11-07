// packages/core/shaper-cloud.js — direct programmatic upload to ShaperHub / Shaper Origin "My Files".
// PURE, uses standard fetch (Node 18+, Cloudflare Workers, modern runtimes).

export const SHAPER_AUTH_URL = 'https://auth.shapertools.com';
export const SHAPER_API_URL = 'https://api.shapertools.com';
export const SHAPER_HUB_ORIGIN = 'https://hub.shapertools.com';

export const SHAPER_COMMON_HEADERS = {
  'Origin': SHAPER_HUB_ORIGIN,
  'Referer': `${SHAPER_HUB_ORIGIN}/`,
  'X-ApiVersion': '3.0.0',
};

/**
 * Upload an SVG string or buffer directly to ShaperHub "My Files" via the Shaper API.
 * @param {Object} opts
 * @param {string} opts.email - Shaper account email
 * @param {string} opts.password - Shaper account password
 * @param {string} [opts.filename='shaper-export.svg'] - Target filename
 * @param {string|Uint8Array} opts.svg - SVG contents
 * @param {Function} [opts.onProgress] - Optional status progress callback (step: string)
 * @returns {Promise<{ success: true, filename: string, blobId: string, file: any }>}
 */
export async function uploadToShaperHub({ email, password, filename = 'shaper-export.svg', svg, onProgress = () => {} }) {
  if (!email || !String(email).trim()) throw new Error('Shaper account email is required');
  if (!password) throw new Error('Shaper account password is required');
  if (!svg) throw new Error('SVG content is required');

  // Step 1: Authenticate to get access JWT token
  onProgress('authenticating');
  const tokenRes = await fetch(`${SHAPER_AUTH_URL}/token`, {
    method: 'POST',
    headers: {
      ...SHAPER_COMMON_HEADERS,
      'X-ApiVersion': '2.0.0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: '000000000000000000000000',
      grant_type: 'password',
      username: String(email).trim(),
      password: String(password),
      scope: '*',
      acceptTC: false,
    }),
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    let msg = errBody;
    try { msg = JSON.parse(errBody).message || errBody; } catch (_) {}
    throw new Error(`Authentication failed (${tokenRes.status}): ${msg}`);
  }

  const tokenData = await tokenRes.json();
  const token = tokenData?.access_token?.token;
  if (!token) throw new Error('Failed to extract access token from Shaper auth response');

  // Step 2: Upload blob (raw SVG payload)
  onProgress('uploading_blob');
  const rawBytes = typeof svg === 'string' ? new TextEncoder().encode(svg) : svg;
  const blobRes = await fetch(`${SHAPER_API_URL}/blobs/`, {
    method: 'POST',
    headers: {
      ...SHAPER_COMMON_HEADERS,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
    },
    body: rawBytes,
  });

  if (!blobRes.ok) {
    const errBody = await blobRes.text();
    throw new Error(`Blob upload failed (${blobRes.status}): ${errBody}`);
  }

  const blobData = await blobRes.json();
  const blobId = blobData?.blobs?.[0];
  if (!blobId) throw new Error('Failed to retrieve blob ID from Shaper');

  // Step 3: Link blob to My Files entry in userspace tree
  onProgress('linking_tree');
  const cleanName = (filename.trim().replace(/[^a-zA-Z0-9_\-\. ]/g, '_') || 'shaper-export').replace(/(\.svg)?$/i, '.svg');
  const safeRemoteName = encodeURIComponent(cleanName);

  const fileRes = await fetch(`${SHAPER_API_URL}/files/userspace/tree/${safeRemoteName}`, {
    method: 'POST',
    headers: {
      ...SHAPER_COMMON_HEADERS,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'file',
      blobs: [blobId],
    }),
  });

  if (!fileRes.ok) {
    const errBody = await fileRes.text();
    throw new Error(`Creating file in My Files failed (${fileRes.status}): ${errBody}`);
  }

  const fileData = await fileRes.json();
  onProgress('done');
  return { success: true, filename: cleanName, blobId, file: fileData };
}
