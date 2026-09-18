// Ballsy Studio — TikTok publishing (OAuth + Content Posting API "Direct Post").
//
// Self-contained: index.mjs only mounts this router at /api/publish/tiktok.
// Everything TikTok-specific — the OAuth dance, the token file, the chunked
// upload — lives here and nowhere else.
//
// There is no official Node SDK for TikTok, so this is plain fetch against
// their documented REST endpoints. No new dependency.
//
// Why FILE_UPLOAD and not PULL_FROM_URL: the rendered video only ever exists
// as a local file (out/<matchId>.mp4). PULL_FROM_URL needs a publicly
// reachable, TikTok-verified URL, which a localhost tool doesn't have.

import {open, mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SERVER_DIR, '..', '..');
const OUTPUT_DIR = join(REPO_ROOT, 'scripts', 'output');
const OUT_DIR = join(REPO_ROOT, 'out');
const CREDENTIALS_PATH = join(SERVER_DIR, '.credentials', 'tiktok.json');

// TikTok's documented v2 endpoints. The authorize page is on www.tiktok.com;
// every API call goes to open.tiktokapis.com.
const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const PUBLISH_INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/video/init/';
const PUBLISH_STATUS_URL = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';

// Direct Post (publishing straight to the profile rather than dropping the
// file in the user's TikTok inbox) is gated behind this one scope.
const SCOPE = 'video.publish';

// Must match the redirect URI registered on the TikTok for Developers app
// exactly, character for character — including the trailing path and the
// port. See the README section "Publishing to TikTok (optional)".
const REDIRECT_URI = 'http://localhost:4321/api/publish/tiktok/callback';

// HARD REQUIREMENT while the TikTok app is unaudited: an app that has not
// passed TikTok's own manual content-posting audit may only create posts with
// SELF_ONLY visibility — anything else is rejected or silently downgraded by
// TikTok. This is deliberately a constant and NOT a user-facing setting: a
// visibility dropdown here would be a dropdown of values that cannot work.
// Once an audit is requested and granted through the TikTok for Developers
// portal (a process on TikTok's timeline, not ours), this should become
// user-configurable — the value would then come from the request the same way
// the title does.
const PRIVACY_LEVEL = 'SELF_ONLY';

// Standing project policy: every Ballsy video is narrated by an AI voice over
// an AI-written script, so it is always disclosed to TikTok as AI-generated
// content. Not a toggle on purpose — there is no Ballsy video for which the
// honest answer is "no".
const IS_AIGC = true;

// TikTok's caption field is capped at 2200 characters. The caption is also
// where hashtags live (TikTok has no separate tags field for Direct Post),
// which is why publishMetadata.hashtags get folded into the title below.
const MAX_TITLE_LENGTH = 2200;

// Chunking rules from the Content Posting API: a chunk must be at least 5MB
// and at most 64MB, and the final chunk absorbs the remainder (so it can be
// bigger than chunk_size). A whole file under the 64MB ceiling is therefore
// simplest — and safest — sent as exactly one chunk, which is what every
// Ballsy render (a 30-90s vertical clip) will actually hit. The multi-chunk
// branch exists so an unusually long render still uploads correctly.
const MAX_SINGLE_CHUNK_BYTES = 64 * 1024 * 1024;
const MULTI_CHUNK_SIZE = 10 * 1024 * 1024;

// How long to wait for TikTok to finish processing an uploaded video before
// giving up. Reporting "done" the moment the bytes land would be a lie: the
// post does not exist until TikTok finishes transcoding it.
const STATUS_POLL_INTERVAL_MS = 3000;
const STATUS_POLL_TIMEOUT_MS = 5 * 60 * 1000;

const router = express.Router();

// Match ids are SofaScore event ids (always numeric) and get joined into file
// paths, so anything else is rejected — same convention as index.mjs.
function isValidMatchId(matchId) {
  return /^\d+$/.test(String(matchId));
}

// Same one-liner /api/render uses. Deliberately duplicated rather than
// imported: this module stays standalone so index.mjs only has to mount it.
function sendEvent(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function credentials() {
  return {
    clientKey: process.env.TIKTOK_CLIENT_KEY || '',
    clientSecret: process.env.TIKTOK_CLIENT_SECRET || '',
  };
}

function isConfigured() {
  const {clientKey, clientSecret} = credentials();
  return Boolean(clientKey && clientSecret);
}

// ---------------------------------------------------------------------------
// Token storage — scripts/server/.credentials/tiktok.json (gitignored).
// ---------------------------------------------------------------------------

async function readTokens() {
  try {
    return JSON.parse(await readFile(CREDENTIALS_PATH, 'utf8'));
  } catch {
    // No file (never connected) or unreadable/corrupt: both mean "not
    // connected", and the fix for both is to run the connect flow again.
    return null;
  }
}

async function writeTokens(tokens) {
  await mkdir(dirname(CREDENTIALS_PATH), {recursive: true});
  await writeFile(CREDENTIALS_PATH, JSON.stringify(tokens, null, 2));
}

// Turns a token-endpoint response into what we persist. TikTok rotates the
// refresh token on every refresh, so the new one always has to be written back
// — keeping the original would break the *next* refresh.
function tokensFromResponse(payload, previous) {
  const now = Date.now();
  return {
    accessToken: payload.access_token,
    accessTokenExpiresAt: now + Number(payload.expires_in || 0) * 1000,
    refreshToken: payload.refresh_token || previous?.refreshToken || null,
    refreshTokenExpiresAt: payload.refresh_expires_in
      ? now + Number(payload.refresh_expires_in) * 1000
      : (previous?.refreshTokenExpiresAt ?? null),
    openId: payload.open_id || previous?.openId || null,
    scope: payload.scope || previous?.scope || null,
    connectedAt: previous?.connectedAt ?? new Date(now).toISOString(),
  };
}

async function requestToken(form) {
  const {clientKey, clientSecret} = credentials();
  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    ...form,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // TikTok's token endpoint rejects cached responses on some proxies.
      'Cache-Control': 'no-cache',
    },
    body,
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload || payload.error) {
    const detail =
      payload?.error_description || payload?.error || `HTTP ${res.status}`;
    throw new Error(`TikTok token request failed: ${detail}`);
  }
  return payload;
}

// The access token TikTok hands back is short-lived (24h); the refresh token
// is what actually survives between sessions. Every API call goes through
// here so a stale access token refreshes itself instead of surfacing as a
// mystery 401 mid-upload.
async function getAccessToken() {
  if (!isConfigured()) {
    throw new Error(
      'TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET are not set — add them to .env (see the README).',
    );
  }
  const stored = await readTokens();
  if (!stored?.refreshToken) {
    throw new Error('Not connected to TikTok — click "Connect TikTok" first.');
  }
  // 60s of slack so a token that expires mid-upload is refreshed up front.
  if (stored.accessToken && stored.accessTokenExpiresAt > Date.now() + 60_000) {
    return stored.accessToken;
  }
  const payload = await requestToken({
    grant_type: 'refresh_token',
    refresh_token: stored.refreshToken,
  });
  const tokens = tokensFromResponse(payload, stored);
  await writeTokens(tokens);
  return tokens.accessToken;
}

// ---------------------------------------------------------------------------
// TikTok API helper — every Content Posting call is a JSON POST that answers
// 200 with an {error: {code}} envelope, so a non-"ok" code is the real failure
// signal, not the HTTP status.
// ---------------------------------------------------------------------------

async function tiktokPost(url, accessToken, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => null);
  const code = payload?.error?.code;
  if (!res.ok || (code && code !== 'ok')) {
    const message = payload?.error?.message || `HTTP ${res.status}`;
    const logId = payload?.error?.log_id ? ` (log_id ${payload.error.log_id})` : '';
    throw new Error(`TikTok API error${code ? ` [${code}]` : ''}: ${message}${logId}`);
  }
  return payload?.data ?? {};
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

// CSRF `state` values we've handed out but not yet seen come back. In-memory
// is enough: this is a single-user tool on localhost, and a state that doesn't
// survive a server restart just means re-clicking Connect.
const pendingStates = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;

function rememberState(returnTo) {
  const now = Date.now();
  for (const [value, entry] of pendingStates) {
    if (now - entry.createdAt > STATE_TTL_MS) pendingStates.delete(value);
  }
  const value = randomBytes(16).toString('hex');
  pendingStates.set(value, {createdAt: now, returnTo});
  return value;
}

// Connected == we hold a refresh token. Reported separately from `configured`
// so the UI can tell "you haven't linked an account yet" apart from "there are
// no API credentials in .env at all" — two different fixes. Never throws, even
// with nothing configured: this is the first call the match page makes.
router.get('/status', async (req, res) => {
  const tokens = await readTokens();
  res.json({
    connected: Boolean(tokens?.refreshToken) && isConfigured(),
    configured: isConfigured(),
  });
});

// Step 1 of the OAuth flow. `matchId` is carried through the round trip on our
// side of the `state` map (not in the URL TikTok sees) so the callback can
// drop the user back on the match page they started from instead of the home
// page.
router.get('/auth', (req, res) => {
  const {clientKey} = credentials();
  if (!clientKey) {
    res
      .status(500)
      .type('text/plain')
      .send('TIKTOK_CLIENT_KEY is not set. Add it to .env and restart Ballsy Studio (see the README).');
    return;
  }
  const matchId = String(req.query.matchId || '');
  const returnTo = isValidMatchId(matchId) ? `/match/${matchId}` : '/';
  const params = new URLSearchParams({
    client_key: clientKey,
    scope: SCOPE,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    state: rememberState(returnTo),
  });
  res.redirect(`${AUTHORIZE_URL}?${params}`);
});

// Step 2: TikTok bounces the browser back here with ?code=...&state=...
router.get('/callback', async (req, res) => {
  const code = String(req.query.code || '');
  const state = String(req.query.state || '');
  const error = String(req.query.error || '');

  if (error) {
    res
      .status(400)
      .type('text/plain')
      .send(`TikTok authorization failed: ${req.query.error_description || error}`);
    return;
  }
  const pending = pendingStates.get(state);
  if (!pending) {
    res
      .status(400)
      .type('text/plain')
      .send('Invalid or expired state parameter — start the connection again from Ballsy Studio.');
    return;
  }
  pendingStates.delete(state);
  if (!code) {
    res.status(400).type('text/plain').send('No authorization code returned by TikTok.');
    return;
  }

  try {
    const payload = await requestToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    });
    await writeTokens(tokensFromResponse(payload, null));
    res.redirect(pending.returnTo);
  } catch (err) {
    res.status(500).type('text/plain').send(`Could not connect to TikTok: ${err.message}`);
  }
});

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

// TikTok has no separate description field for a Direct Post — the caption
// ("title") is the whole of it, hashtags included. So the generated
// description is left for platforms that do have one, and the hashtags are
// appended here where they'll actually work.
function buildTitle(metadata, matchInfo, matchId) {
  const base =
    metadata?.title?.trim() ||
    (matchInfo
      ? `${matchInfo.home} ${matchInfo.homeScore ?? '?'}-${matchInfo.awayScore ?? '?'} ${matchInfo.away}`
      : `Ballsy match recap ${matchId}`);
  const tags = (metadata?.hashtags ?? [])
    .map((tag) => String(tag).trim().replace(/^#+/, ''))
    .filter(Boolean)
    .map((tag) => `#${tag.replace(/\s+/g, '')}`);
  const full = tags.length ? `${base} ${tags.join(' ')}` : base;
  return full.slice(0, MAX_TITLE_LENGTH);
}

function planChunks(videoSize) {
  if (videoSize <= MAX_SINGLE_CHUNK_BYTES) {
    return {chunkSize: videoSize, totalChunkCount: 1};
  }
  // The last chunk takes the remainder, so the count is a floor division, not
  // a ceiling one — a ceiling would promise TikTok a final chunk of 0 bytes.
  return {
    chunkSize: MULTI_CHUNK_SIZE,
    totalChunkCount: Math.floor(videoSize / MULTI_CHUNK_SIZE),
  };
}

async function uploadChunks(uploadUrl, videoPath, videoSize, plan, onProgress) {
  const handle = await open(videoPath, 'r');
  try {
    for (let index = 0; index < plan.totalChunkCount; index += 1) {
      const start = index * plan.chunkSize;
      const isLast = index === plan.totalChunkCount - 1;
      const end = isLast ? videoSize - 1 : start + plan.chunkSize - 1;
      const length = end - start + 1;

      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, start);

      onProgress(index + 1, plan.totalChunkCount);

      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': String(length),
          'Content-Range': `bytes ${start}-${end}/${videoSize}`,
        },
        body: buffer,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(
          `Chunk ${index + 1}/${plan.totalChunkCount} upload failed (HTTP ${res.status}) ${detail}`.trim(),
        );
      }
    }
  } finally {
    await handle.close();
  }
}

// The upload finishing only means TikTok has the bytes. The post itself isn't
// real until processing completes, so this is what "published" is allowed to
// be based on.
async function waitForPublish(accessToken, publishId, onProgress) {
  const deadline = Date.now() + STATUS_POLL_TIMEOUT_MS;
  let lastStatus = null;
  while (Date.now() < deadline) {
    const data = await tiktokPost(PUBLISH_STATUS_URL, accessToken, {publish_id: publishId});
    const status = data.status;
    if (status !== lastStatus) {
      onProgress(status);
      lastStatus = status;
    }
    if (status === 'PUBLISH_COMPLETE' || status === 'SEND_TO_USER_INBOX') return status;
    if (status === 'FAILED') {
      throw new Error(`TikTok rejected the video: ${data.fail_reason || 'unknown reason'}`);
    }
    await sleep(STATUS_POLL_INTERVAL_MS);
  }
  throw new Error(
    `Timed out after ${STATUS_POLL_TIMEOUT_MS / 1000}s waiting for TikTok to finish processing (publish_id ${publishId}). It may still complete — check the TikTok app.`,
  );
}

// Publishes out/<matchId>.mp4, streaming progress as SSE — same shape as
// /api/render in index.mjs, so the frontend consumes both identically.
router.get('/', async (req, res) => {
  const matchId = String(req.query.matchId || '');
  if (!isValidMatchId(matchId)) {
    res.status(400).end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  try {
    const accessToken = await getAccessToken();

    const videoPath = join(OUT_DIR, `${matchId}.mp4`);
    const {size: videoSize} = await stat(videoPath).catch(() => {
      throw new Error(`No rendered video at out/${matchId}.mp4 — render it first.`);
    });
    if (videoSize === 0) throw new Error(`out/${matchId}.mp4 is empty — re-render it.`);

    const scriptPath = join(OUTPUT_DIR, `${matchId}.json`);
    const saved = JSON.parse(await readFile(scriptPath, 'utf8'));
    const title = buildTitle(saved.publishMetadata, saved.matchInfo, matchId);

    const plan = planChunks(videoSize);
    sendEvent(res, {
      type: 'log',
      line: `Video: ${(videoSize / (1024 * 1024)).toFixed(1)} MB in ${plan.totalChunkCount} chunk(s).\n`,
    });
    sendEvent(res, {type: 'log', line: `Caption: ${title}\n`});
    sendEvent(res, {
      type: 'log',
      line: `Privacy: ${PRIVACY_LEVEL} (private) · AI-generated content disclosed.\n`,
    });

    sendEvent(res, {type: 'log', line: 'Initiating upload with TikTok...\n'});
    const init = await tiktokPost(PUBLISH_INIT_URL, accessToken, {
      post_info: {
        title,
        privacy_level: PRIVACY_LEVEL,
        is_aigc: IS_AIGC,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: videoSize,
        chunk_size: plan.chunkSize,
        total_chunk_count: plan.totalChunkCount,
      },
    });

    if (!init.upload_url || !init.publish_id) {
      throw new Error('TikTok did not return an upload URL — nothing was uploaded.');
    }
    const publishId = init.publish_id;

    await uploadChunks(init.upload_url, videoPath, videoSize, plan, (done, total) => {
      sendEvent(res, {type: 'log', line: `Uploading chunk ${done}/${total}...\n`});
    });
    sendEvent(res, {type: 'log', line: 'Upload complete. Waiting for TikTok to process...\n'});

    const finalStatus = await waitForPublish(accessToken, publishId, (status) => {
      sendEvent(res, {type: 'log', line: `TikTok status: ${status}\n`});
    });
    if (finalStatus === 'SEND_TO_USER_INBOX') {
      sendEvent(res, {
        type: 'log',
        line: 'TikTok routed this to your app inbox instead of posting it directly — finish it in the TikTok app.\n',
      });
    }

    // Read-mutate-write, same as the approve-script handler in index.mjs:
    // re-read rather than reuse `saved` above, since the script file may have
    // been rewritten (an edit, a regeneration) while the upload was running.
    const current = JSON.parse(await readFile(scriptPath, 'utf8'));
    current.tiktok = {
      publishId,
      privacyLevel: PRIVACY_LEVEL,
      publishedAt: new Date().toISOString(),
    };
    await writeFile(scriptPath, JSON.stringify(current, null, 2));

    sendEvent(res, {type: 'done', publishId});
  } catch (err) {
    sendEvent(res, {type: 'error', message: err.message});
  } finally {
    res.end();
  }
});

export default router;
