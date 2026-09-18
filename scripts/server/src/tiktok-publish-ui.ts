// Ballsy Studio — the TikTok block on the match page.
//
// Owns everything the user sees about TikTok publishing: connecting the
// account, the caption preview, the publish run, and the published state.
// app.ts only decides *when* to draw this (once a rendered video exists) and
// hands over the match id, the saved publish status and the generated
// metadata — it knows nothing about what's inside.
//
// The server half is scripts/server/publish-tiktok.mjs.

// Local mirrors of app.ts's types. Deliberately redeclared rather than
// imported: app.ts imports this module, so importing back would be a cycle.
type TiktokPublishStatus = {publishId: string; privacyLevel: string; publishedAt: string};
type PublishMetadata = {title: string; description: string; hashtags: string[]};

// Same helper app.ts uses — this project has no framework on purpose, and a
// copy is cheaper than a shared module that both sides have to import.
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') el.className = value;
    else el.setAttribute(key, value);
  }
  for (const child of children) {
    el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

// Why every published video says "private": TikTok only lets an app that has
// passed their manual content-posting audit publish at any other visibility.
// Until that audit is requested and granted, SELF_ONLY is the only value the
// API will accept — so this is stated up front rather than discovered after a
// video fails to appear on the profile.
const PRIVACY_EXPLANATION =
  'TikTok only allows public posting from apps that have passed its content-posting audit, ' +
  'so everything published from here lands in your profile as private (visible only to you). ' +
  'Request the audit in the TikTok for Developers portal to lift this — see the README.';

// Mirrors buildTitle() in publish-tiktok.mjs: TikTok has no separate
// description field for a Direct Post, so the hashtags ride along in the
// caption. Kept in sync by hand (two languages, one string) so the preview
// shows exactly what will be posted rather than an approximation.
function captionPreview(metadata: PublishMetadata): string {
  const tags = metadata.hashtags
    .map((tag) => tag.trim().replace(/^#+/, ''))
    .filter(Boolean)
    .map((tag) => `#${tag.replace(/\s+/g, '')}`);
  const base = metadata.title.trim();
  return tags.length ? `${base} ${tags.join(' ')}` : base;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('en-GB');
}

export function renderTiktokPublishBlock(
  matchId: string,
  status: TiktokPublishStatus | null,
  metadata: PublishMetadata | null,
  // Called the moment a publish succeeds, so the caller (app.ts) can update
  // its own status-strip chip without waiting for a page reload — this block
  // owns its own redraw (showPublished above), the callback is purely so
  // state living outside this card can catch up.
  onPublished: (status: TiktokPublishStatus) => void,
): HTMLElement {
  const body = h('div', {class: 'tiktok-publish-body'});
  const card = h('div', {class: 'card tiktok-publish'}, [
    h('div', {class: 'tiktok-publish-header'}, [
      h('span', {class: 'tiktok-publish-name'}, [
        h('span', {class: 'tiktok-publish-mark'}, ['♪']),
        'TikTok',
      ]),
      h('span', {class: 'badge neutral'}, ['Private only']),
    ]),
    body,
  ]);

  const setBody = (...nodes: (Node | string)[]): void => {
    body.innerHTML = '';
    for (const node of nodes) {
      body.appendChild(typeof node === 'string' ? document.createTextNode(node) : node);
    }
  };

  // State 3 — already published for this match.
  const showPublished = (published: TiktokPublishStatus): void => {
    setBody(
      h('p', {class: 'tiktok-publish-done'}, [
        `✓ Published (${published.privacyLevel === 'SELF_ONLY' ? 'private/self-only' : published.privacyLevel})`,
      ]),
      // No watch link on purpose: the Content Posting API doesn't hand back a
      // public URL, and for a self-only post there isn't one to hand back —
      // linking somewhere would just be a guess that 404s.
      h('p', {class: 'hint'}, [PRIVACY_EXPLANATION]),
      h('p', {class: 'hint tiktok-publish-meta'}, [
        `Published ${formatDate(published.publishedAt)} · publish id ${published.publishId}`,
      ]),
      h('p', {class: 'hint'}, ['Open the TikTok app to view it, or change its visibility there.']),
    );
  };

  // State 2 — connected, not published yet.
  const showPublishable = (): void => {
    const caption = metadata ? captionPreview(metadata) : null;
    const preview = caption
      ? h('div', {class: 'tiktok-publish-preview'}, [
          h('div', {class: 'tiktok-publish-caption'}, [caption]),
        ])
      : h('p', {class: 'hint'}, [
          'No publish metadata saved for this match — TikTok will get the match name as the caption. ' +
            'Regenerate the script to get a written title and hashtags.',
        ]);

    const publishBtn = h('button', {type: 'button', class: 'btn primary'}, ['Publish to TikTok']);
    const log = h('div', {class: 'log tiktok-publish-log hidden'});
    let errorEl: HTMLElement | null = null;

    publishBtn.addEventListener('click', () => {
      publishBtn.setAttribute('disabled', 'true');
      publishBtn.textContent = 'Publishing...';
      errorEl?.remove();
      errorEl = null;
      log.textContent = '';
      log.classList.remove('hidden');

      const source = new EventSource(`/api/publish/tiktok?matchId=${encodeURIComponent(matchId)}`);
      let finished = false;
      const stop = (): void => {
        finished = true;
        source.close();
      };

      source.onmessage = (e) => {
        // The match page is rebuilt from scratch on navigation, which detaches
        // this card. Without this the stream would keep writing into DOM
        // nobody is looking at — and EventSource would happily reconnect.
        if (!card.isConnected) {
          stop();
          return;
        }
        const msg = JSON.parse(e.data) as {
          type: string;
          line?: string;
          message?: string;
          publishId?: string;
        };
        if (msg.type === 'log') {
          log.textContent += msg.line ?? '';
          log.scrollTop = log.scrollHeight;
        } else if (msg.type === 'done') {
          stop();
          const published: TiktokPublishStatus = {
            publishId: msg.publishId ?? '',
            privacyLevel: 'SELF_ONLY',
            publishedAt: new Date().toISOString(),
          };
          showPublished(published);
          onPublished(published);
        } else if (msg.type === 'error') {
          stop();
          errorEl = h('div', {class: 'error-banner'}, [msg.message ?? 'Publishing failed.']);
          body.appendChild(errorEl);
          publishBtn.removeAttribute('disabled');
          publishBtn.textContent = 'Try again';
        }
      };
      // A dropped connection would otherwise leave the button stuck on
      // "Publishing..." with no way back, and EventSource would silently retry
      // — which for an upload means starting a second one.
      source.onerror = () => {
        if (finished) return;
        stop();
        errorEl = h('div', {class: 'error-banner'}, [
          'Lost connection to the server while publishing — reload the page to see whether it went through.',
        ]);
        body.appendChild(errorEl);
        publishBtn.removeAttribute('disabled');
        publishBtn.textContent = 'Try again';
      };
    });

    setBody(
      h('p', {class: 'hint'}, [
        'Posts the rendered video straight to your TikTok account, disclosed to TikTok as AI-generated content.',
      ]),
      preview,
      h('p', {class: 'hint'}, [PRIVACY_EXPLANATION]),
      publishBtn,
      log,
    );
  };

  // State 1 — no TikTok account linked yet (or no API credentials at all).
  const showConnect = (configured: boolean): void => {
    if (!configured) {
      setBody(
        h('p', {class: 'hint'}, [
          'TikTok publishing is not set up: add TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET to .env ' +
            'and restart Ballsy Studio. See "Publishing to TikTok" in the README.',
        ]),
      );
      return;
    }
    // A full-page navigation rather than a popup: TikTok's consent screen
    // refuses to render in an iframe, and the callback redirects straight back
    // to this match page anyway.
    const connectBtn = h('button', {type: 'button', class: 'btn primary'}, ['Connect TikTok']);
    connectBtn.addEventListener('click', () => {
      location.href = `/api/publish/tiktok/auth?matchId=${encodeURIComponent(matchId)}`;
    });
    setBody(
      h('p', {class: 'hint'}, [
        'Link your TikTok account once to publish rendered videos from here.',
      ]),
      h('p', {class: 'hint'}, [PRIVACY_EXPLANATION]),
      connectBtn,
    );
  };

  if (status) {
    showPublished(status);
    return card;
  }

  // Connection is account-level, not per-match: a match with no saved publish
  // status says nothing about whether TikTok is linked, so ask the server
  // rather than assuming the worst and showing "Connect" to someone who
  // already connected three matches ago.
  setBody(h('p', {class: 'hint'}, ['Checking TikTok connection...']));
  fetch('/api/publish/tiktok/status')
    .then((res) => (res.ok ? (res.json() as Promise<{connected: boolean; configured: boolean}>) : null))
    .then((data) => {
      if (!card.isConnected) return;
      if (!data) {
        setBody(h('div', {class: 'error-banner'}, ['Could not check the TikTok connection.']));
        return;
      }
      if (data.connected) showPublishable();
      else showConnect(data.configured);
    })
    .catch(() => {
      if (!card.isConnected) return;
      setBody(
        h('div', {class: 'error-banner'}, [
          'Could not reach the server to check the TikTok connection.',
        ]),
      );
    });

  return card;
}
