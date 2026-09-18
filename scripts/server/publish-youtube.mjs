// YouTube publishing for Ballsy Studio — OAuth + upload of the rendered
// out/<matchId>.mp4, mounted at /api/publish/youtube by index.mjs.
//
// Self-contained on purpose: everything YouTube-specific (the OAuth dance,
// where the refresh token lives, how a video is uploaded and recorded) lives
// in this one file, so index.mjs only ever has to mount it.
//
// Auth model: a single local user authorising their own channel. The refresh
// token is written to scripts/server/.credentials/youtube.json (gitignored) —
// there's no per-session state, no multi-account support, and no server-side
// job queue, because Studio is a single-user app running on localhost.
//
// Nothing here ever uploads on its own: the only path that calls YouTube is
// GET / below, and that only runs when the user has clicked "Publish" for a
// specific match. There is deliberately no auto-publish.

import {createReadStream, existsSync} from 'node:fs';
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import {google} from 'googleapis';

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SERVER_DIR, '..', '..');
const OUTPUT_DIR = join(REPO_ROOT, 'scripts', 'output');
const OUT_DIR = join(REPO_ROOT, 'out');
const CREDENTIALS_PATH = join(SERVER_DIR, '.credentials', 'youtube.json');

// Upload-only scope: lets Ballsy Studio add a video to the authorised channel
// and nothing else — it can't read, edit, or delete anything already there.
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];

// Must match the "Authorized redirect URI" registered on the OAuth client in
// the Google Cloud Console, byte for byte (see README → Publishing to YouTube).
const REDIRECT_URI = 'http://localhost:4321/api/publish/youtube/callback';

const PRIVACY_STATUSES = ['public', 'unlisted', 'private'];
const DEFAULT_PRIVACY = 'unlisted';

// YouTube's own limits — hit them and videos.insert fails with a 400 that
// reads like a schema error, so the metadata is trimmed to fit here instead.
const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_TAGS_TOTAL_LENGTH = 500;

const router = express.Router();

function sendEvent(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Match ids are SofaScore event ids (always numeric) and get joined into file
// paths — same rule as index.mjs's isValidMatchId.
function isValidMatchId(matchId) {
  return /^\d+$/.test(String(matchId));
}

function normalisePrivacyStatus(value) {
  const wanted = String(value || '').toLowerCase();
  // Anything unrecognised falls back to the least irreversible option rather
  // than being rejected — an unlisted video can be made public in two clicks,
  // a public one can't be un-seen.
  return PRIVACY_STATUSES.includes(wanted) ? wanted : DEFAULT_PRIVACY;
}

// ---------------------------------------------------------------------------
// OAuth client + token storage
// ---------------------------------------------------------------------------

// True once YOUTUBE_CLIENT_ID/SECRET are in .env. Checked before building a
// client so that /status still answers on a machine that has never set this
// up, instead of the whole selector server 500ing on a missing env var.
function isConfigured() {
  return Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET);
}

// Built per request rather than once at import time: the server may be started
// before .env is filled in, and a client captured at import would then be
// permanently wrong even after the user adds their credentials and restarts.
function createOAuthClient() {
  if (!isConfigured()) {
    throw new Error(
      'YouTube is not configured — set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env (see README → Publishing to YouTube).',
    );
  }
  return new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    REDIRECT_URI,
  );
}

async function readStoredCredentials() {
  try {
    const parsed = JSON.parse(await readFile(CREDENTIALS_PATH, 'utf8'));
    return parsed?.refreshToken ? parsed : null;
  } catch {
    // Missing file (never connected) or unreadable/corrupt JSON — both mean
    // "not connected", and the fix for both is to connect again.
    return null;
  }
}

async function writeStoredCredentials(refreshToken) {
  await mkdir(dirname(CREDENTIALS_PATH), {recursive: true});
  await writeFile(
    CREDENTIALS_PATH,
    JSON.stringify({refreshToken, scope: SCOPES.join(' '), connectedAt: new Date().toISOString()}, null, 2),
  );
}

// An authorised client for the stored channel, or null if the user hasn't
// connected one yet. Access tokens aren't persisted — googleapis mints a fresh
// one from the refresh token on the first call, which is both simpler and
// means a stale access token can never be the reason an upload fails.
async function getAuthorisedClient() {
  const stored = await readStoredCredentials();
  if (!stored) return null;
  const client = createOAuthClient();
  client.setCredentials({refresh_token: stored.refreshToken});
  // Google occasionally hands back a new refresh token on refresh; persisting
  // it keeps the connection alive instead of silently expiring one day.
  client.on('tokens', (tokens) => {
    if (tokens.refresh_token && tokens.refresh_token !== stored.refreshToken) {
      void writeStoredCredentials(tokens.refresh_token);
    }
  });
  return client;
}

// ---------------------------------------------------------------------------
// Video metadata — built from the publishMetadata the script agent wrote
// ---------------------------------------------------------------------------

async function readScriptFile(matchId) {
  return JSON.parse(await readFile(join(OUTPUT_DIR, `${matchId}.json`), 'utf8'));
}

function matchHeadline(saved, matchId) {
  const info = saved?.matchInfo;
  if (!info?.home || !info?.away) return `Ballsy recap — match ${matchId}`;
  return `${info.home} ${info.homeScore ?? '?'}-${info.awayScore ?? '?'} ${info.away} — Ballsy recap`;
}

// "#ManCity" and "ManCity" are the same YouTube tag; the # only means anything
// inside the description. Blank/duplicate entries are dropped, and the list is
// truncated to YouTube's 500-character budget rather than sent over it (which
// fails the whole upload for a cosmetic field).
function hashtagsToTags(hashtags) {
  const seen = new Set();
  const tags = [];
  let total = 0;
  for (const raw of Array.isArray(hashtags) ? hashtags : []) {
    const tag = String(raw).replace(/^#+/, '').trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    // YouTube counts a tag's own length plus the separator between tags.
    if (total + tag.length + 1 > MAX_TAGS_TOTAL_LENGTH) break;
    seen.add(key);
    tags.push(tag);
    total += tag.length + 1;
  }
  return tags;
}

// Hashtags go in the description as well as in tags on purpose: YouTube only
// renders the clickable "#foo" chips above a video's title from the
// description, never from the tags field.
function buildSnippet(saved, matchId) {
  const metadata = saved?.publishMetadata ?? null;
  const rawTitle = String(metadata?.title || '').trim() || matchHeadline(saved, matchId);
  // < and > are rejected outright by videos.insert.
  const title = rawTitle.replace(/[<>]/g, '').slice(0, MAX_TITLE_LENGTH);

  const hashtags = (Array.isArray(metadata?.hashtags) ? metadata.hashtags : [])
    .map((tag) => `#${String(tag).replace(/^#+/, '').trim()}`)
    .filter((tag) => tag.length > 1);
  const description = [String(metadata?.description || '').trim(), hashtags.join(' ')]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, MAX_DESCRIPTION_LENGTH);

  return {title, description, tags: hashtagsToTags(metadata?.hashtags)};
}

// Google's errors arrive nested (response.data.error.message) and the top-level
// message is often just "Request failed with status code 403" — surface the
// useful one so the UI can show something actionable.
function describeApiError(err) {
  const apiMessage = err?.response?.data?.error?.message || err?.errors?.[0]?.message;
  return apiMessage ? `${apiMessage}` : err?.message || 'Unknown error';
}

// ---------------------------------------------------------------------------
// Routes (mounted at /api/publish/youtube)
// ---------------------------------------------------------------------------

// Connection is account-level, not per-match, so the UI polls this on every
// render rather than inferring "not connected" from an unpublished match.
router.get('/status', async (req, res) => {
  try {
    const stored = await readStoredCredentials();
    res.json({connected: Boolean(stored) && isConfigured(), configured: isConfigured()});
  } catch (err) {
    // Deliberately never throws upward: a broken credentials file should read
    // as "not connected" (which the UI can fix by reconnecting), not as a
    // dead publish section.
    res.json({connected: false, configured: isConfigured(), error: err.message});
  }
});

// Sends the user to Google's consent screen. access_type: 'offline' + prompt:
// 'consent' together are what make Google return a *refresh* token — without
// both, a second authorisation of an already-approved app comes back with only
// a short-lived access token and the connection dies within the hour.
router.get('/auth', (req, res) => {
  let oauth2Client;
  try {
    oauth2Client = createOAuthClient();
  } catch (err) {
    res.status(500).type('text/plain').send(`${err.message}`);
    return;
  }
  // Round-trips the match the user started from, so the callback can put them
  // back on that page instead of the Studio home page.
  const matchId = String(req.query.matchId || '');
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    ...(isValidMatchId(matchId) ? {state: matchId} : {}),
  });
  res.redirect(url);
});

router.get('/callback', async (req, res) => {
  const error = String(req.query.error || '');
  if (error) {
    // The user pressed "Cancel" on Google's consent screen (or Google refused).
    res.status(400).type('text/plain').send(`YouTube authorisation was not completed (${error}). Nothing was changed.`);
    return;
  }
  const code = String(req.query.code || '');
  if (!code) {
    res.status(400).type('text/plain').send('Missing authorisation code.');
    return;
  }
  try {
    const oauth2Client = createOAuthClient();
    const {tokens} = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      throw new Error(
        'Google did not return a refresh token. Remove Ballsy Studio from your Google account permissions and connect again.',
      );
    }
    await writeStoredCredentials(tokens.refresh_token);
    const state = String(req.query.state || '');
    res.redirect(isValidMatchId(state) ? `/match/${state}` : '/');
  } catch (err) {
    res.status(500).type('text/plain').send(`Could not complete YouTube authorisation: ${describeApiError(err)}`);
  }
});

// The upload itself, streamed over Server-Sent Events like /api/render — an
// upload is slow enough that a silent blocking request is bad UX, and the
// progress events are the only way to tell "still uploading" from "hung".
//
// Only ever reached from an explicit click on "Publish to YouTube" for one
// specific match; there is no batch or automatic path into it by design.
router.get('/', async (req, res) => {
  const matchId = String(req.query.matchId || '');
  if (!isValidMatchId(matchId)) {
    res.status(400).end();
    return;
  }
  const privacyStatus = normalisePrivacyStatus(req.query.privacyStatus);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  try {
    const videoPath = join(OUT_DIR, `${matchId}.mp4`);
    if (!existsSync(videoPath)) {
      throw new Error(`No rendered video at out/${matchId}.mp4 — render the video before publishing.`);
    }

    const auth = await getAuthorisedClient();
    if (!auth) {
      throw new Error('Not connected to YouTube. Click "Connect YouTube" first.');
    }

    // publishMetadata is written by generate-script.mjs; scripts generated
    // before that existed simply don't have it, so the title/description fall
    // back to the match itself rather than failing the upload.
    let saved = null;
    try {
      saved = await readScriptFile(matchId);
    } catch {
      saved = null;
    }
    const snippet = buildSnippet(saved, matchId);

    sendEvent(res, {type: 'step', label: `Uploading "${snippet.title}" as ${privacyStatus}...`});

    const {size} = await stat(videoPath);
    let lastPercent = -1;

    const youtube = google.youtube({version: 'v3', auth});
    const response = await youtube.videos.insert(
      {
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: snippet.title,
            description: snippet.description,
            tags: snippet.tags,
          },
          status: {
            privacyStatus,
            // Always set, never a toggle: Ballsy's voiceover is TTS, so every
            // video Studio produces carries AI-generated content and YouTube
            // requires it to be disclosed. This is the project's standing
            // policy — do not make it conditional.
            containsSyntheticMedia: true,
          },
        },
        media: {
          mimeType: 'video/mp4',
          // googleapis does the resumable-upload chunking itself; handing it a
          // stream is all that's needed (don't hand-roll chunked uploads).
          body: createReadStream(videoPath),
        },
      },
      {
        onUploadProgress: (event) => {
          const percent = size > 0 ? Math.min(99, Math.round((event.bytesRead / size) * 100)) : 0;
          // One event per whole percent — a raw progress feed would flood the
          // SSE stream with hundreds of near-identical messages.
          if (percent === lastPercent) return;
          lastPercent = percent;
          sendEvent(res, {type: 'progress', percent});
        },
      },
    );

    const videoId = response.data.id;
    if (!videoId) {
      throw new Error('YouTube accepted the upload but returned no video id.');
    }
    const url = `https://youtu.be/${videoId}`;
    const published = {videoId, url, privacyStatus, publishedAt: new Date().toISOString()};

    // Recorded next to the script (same read-mutate-write as the approve
    // handler in index.mjs) so re-opening the match shows "Published" instead
    // of offering to upload the same video a second time.
    if (saved) {
      const filePath = join(OUTPUT_DIR, `${matchId}.json`);
      const parsed = JSON.parse(await readFile(filePath, 'utf8'));
      parsed.youtube = published;
      await writeFile(filePath, JSON.stringify(parsed, null, 2));
    }

    sendEvent(res, {type: 'done', ...published});
  } catch (err) {
    sendEvent(res, {type: 'error', message: describeApiError(err)});
  } finally {
    res.end();
  }
});

export default router;
