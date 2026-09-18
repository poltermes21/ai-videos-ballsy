// YouTube publish block for the match page — the whole frontend half of the
// YouTube integration (see scripts/server/publish-youtube.mjs for the server
// half). app.ts calls renderYoutubePublishBlock() and appends what it returns;
// everything inside is owned here, so nothing about YouTube leaks into the
// main app file.
//
// The block draws one of three states:
//   1. not connected  → "Connect YouTube" (starts the OAuth flow)
//   2. connected      → visibility picker + "Publish to YouTube"
//   3. published      → a link to the video
//
// Which one is right depends on two independent things: whether an account is
// connected (account-level, so it has to be asked for) and whether *this*
// match was already published (passed in). That's why the block renders a
// loading line first and fills itself in once /status answers, rather than
// guessing from the status argument alone.

// Local copies of the shapes app.ts passes in — deliberately not imported from
// app.ts, which imports this module (that would be a circular import).
type YoutubePublishStatus = {
  videoId: string;
  url: string;
  privacyStatus: string;
  publishedAt: string;
};
type PublishMetadata = {title: string; description: string; hashtags: string[]};

type ConnectionStatus = {connected: boolean; configured?: boolean};
type PublishEvent = {
  type: string;
  label?: string;
  percent?: number;
  message?: string;
  videoId?: string;
  url?: string;
  privacyStatus?: string;
  publishedAt?: string;
};

// Same DOM builder app.ts uses — copied rather than shared because this
// project has no framework and no shared module layer on purpose.
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

// Unlisted, always — the first publish of a match is the one click that can't
// be taken back once people have seen it, so the safe option is the default
// and going public is a deliberate choice.
const PRIVACY_OPTIONS: {value: string; label: string}[] = [
  {value: 'unlisted', label: 'Unlisted — anyone with the link'},
  {value: 'public', label: 'Public — listed on your channel'},
  {value: 'private', label: 'Private — only you'},
];
const DEFAULT_PRIVACY = 'unlisted';

// "Unlisted" rather than the full option text — the published line is a
// summary, not a picker.
function privacyLabel(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Unknown visibility';
}

function formatPublishedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('en-GB');
}

export function renderYoutubePublishBlock(
  matchId: string,
  status: YoutubePublishStatus | null,
  metadata: PublishMetadata | null,
  // Called the moment a publish succeeds, so the caller (app.ts) can update
  // its own status-strip chip without waiting for a page reload — this block
  // owns its own redraw (showPublished below), the callback is purely so
  // state living outside this card can catch up.
  onPublished: (status: YoutubePublishStatus) => void,
): HTMLElement {
  const body = h('div', {class: 'yt-publish-body'});
  const card = h('div', {class: 'card yt-publish'}, [h('h3', {}, ['YouTube']), body]);

  // Called from async continuations that may land after the user has navigated
  // away — by then this card is detached and every write to it is a silent
  // no-op, so the streams they own have to stop themselves.
  const isDetached = (): boolean => !card.isConnected;

  function setBody(...nodes: (Node | string)[]): void {
    body.innerHTML = '';
    for (const node of nodes) {
      body.appendChild(typeof node === 'string' ? document.createTextNode(node) : node);
    }
  }

  // State 3 — already on YouTube. Terminal on purpose: there's no "publish
  // again" button, since that would upload a second copy of the same video
  // rather than replace the first.
  function showPublished(published: YoutubePublishStatus): void {
    setBody(
      h('p', {class: 'yt-publish-done'}, [
        '✓ Published — ',
        h('a', {href: published.url, target: '_blank', rel: 'noopener noreferrer'}, [published.url]),
      ]),
      h('p', {class: 'hint'}, [
        `${privacyLabel(published.privacyStatus)} · published ${formatPublishedAt(published.publishedAt)}`,
      ]),
    );
  }

  // State 1 — no Google account connected yet. The button is a plain
  // navigation, not a fetch: the OAuth consent screen is a real page the user
  // has to see and approve, and the callback brings them back to this match.
  function showConnect(): void {
    const connectBtn = h('button', {type: 'button', class: 'btn primary'}, ['Connect YouTube']);
    connectBtn.addEventListener('click', () => {
      window.location.href = `/api/publish/youtube/auth?matchId=${encodeURIComponent(matchId)}`;
    });
    setBody(
      h('p', {class: 'hint'}, [
        'Sign in with the Google account that owns the channel. Ballsy Studio only gets permission to upload — it can’t read or change anything already on your channel.',
      ]),
      connectBtn,
    );
  }

  // The OAuth client id/secret aren't in .env, so "Connect" would only lead to
  // a Google error page — say what's missing instead of offering a dead end.
  function showNotConfigured(): void {
    setBody(
      h('p', {class: 'hint'}, [
        'YouTube publishing isn’t set up yet. Add YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET to .env, then restart Ballsy Studio — see “Publishing to YouTube” in the README for the Google Cloud Console steps.',
      ]),
    );
  }

  // What the upload will actually be titled — generated alongside the script,
  // read-only here (regenerate the script to change it), shown so the user
  // isn't approving an upload whose title they've never seen.
  function metadataPreview(): HTMLElement {
    if (!metadata) {
      return h('p', {class: 'hint'}, [
        'No title/description saved for this match — it will be titled after the match itself. Regenerate the script to get a generated title, description and hashtags.',
      ]);
    }
    const preview = h('div', {class: 'yt-publish-preview'}, [
      h('p', {class: 'yt-publish-preview-title'}, [metadata.title]),
      h('p', {class: 'hint'}, [metadata.description]),
    ]);
    if (metadata.hashtags.length) {
      preview.appendChild(
        h('p', {class: 'hint yt-publish-tags'}, [
          metadata.hashtags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).join(' '),
        ]),
      );
    }
    return preview;
  }

  // State 2 — connected, this match not published yet.
  function showPublishForm(): void {
    const select = h('select', {class: 'yt-publish-select'});
    for (const option of PRIVACY_OPTIONS) {
      select.appendChild(h('option', {value: option.value}, [option.label]));
    }
    select.value = DEFAULT_PRIVACY;

    const publishBtn = h('button', {type: 'button', class: 'btn primary'}, ['Publish to YouTube']);
    const statusLine = h('p', {class: 'hint yt-publish-status hidden'});
    const bar = h('span', {class: 'yt-publish-bar-fill', style: 'width:0%'});
    const progress = h('div', {class: 'yt-publish-bar hidden'}, [bar]);
    let errorEl: HTMLElement | null = null;

    publishBtn.addEventListener('click', () => {
      const privacyStatus = select.value;
      // Uploading to a real channel is the one action here the user can't undo
      // from this page, so it always takes an explicit in-the-moment yes —
      // never a silent or automatic publish.
      const confirmed = window.confirm(
        `Upload this video to YouTube as ${privacyStatus}?\n\nIt will be posted to the connected channel right away.`,
      );
      if (!confirmed) return;

      errorEl?.remove();
      errorEl = null;
      publishBtn.setAttribute('disabled', 'true');
      select.setAttribute('disabled', 'true');
      statusLine.classList.remove('hidden');
      statusLine.textContent = 'Starting upload...';
      progress.classList.remove('hidden');
      bar.setAttribute('style', 'width:0%');

      const source = new EventSource(
        `/api/publish/youtube?matchId=${encodeURIComponent(matchId)}&privacyStatus=${encodeURIComponent(privacyStatus)}`,
      );

      const stop = (): void => {
        source.close();
        publishBtn.removeAttribute('disabled');
        select.removeAttribute('disabled');
        progress.classList.add('hidden');
      };

      // EventSource reconnects by default once the server ends the stream —
      // left alone, an error would start a *second* upload of the same file.
      source.onerror = () => {
        source.close();
      };

      source.onmessage = (e: MessageEvent) => {
        if (isDetached()) {
          source.close();
          return;
        }
        const msg = JSON.parse(e.data as string) as PublishEvent;
        if (msg.type === 'step') {
          statusLine.textContent = msg.label ?? 'Uploading...';
        } else if (msg.type === 'progress') {
          const percent = msg.percent ?? 0;
          bar.setAttribute('style', `width:${percent}%`);
          statusLine.textContent = `Uploading... ${percent}%`;
        } else if (msg.type === 'done') {
          source.close();
          const published: YoutubePublishStatus = {
            videoId: msg.videoId ?? '',
            url: msg.url ?? '',
            privacyStatus: msg.privacyStatus ?? privacyStatus,
            publishedAt: msg.publishedAt ?? new Date().toISOString(),
          };
          showPublished(published);
          onPublished(published);
        } else if (msg.type === 'error') {
          stop();
          statusLine.classList.add('hidden');
          errorEl = h('div', {class: 'error-banner'}, [msg.message ?? 'Upload failed.']);
          body.appendChild(errorEl);
        }
      };
    });

    setBody(
      metadataPreview(),
      h('div', {class: 'yt-publish-row'}, [
        h('label', {class: 'yt-publish-label', for: 'yt-publish-privacy'}, ['Visibility']),
        select,
        publishBtn,
      ]),
      statusLine,
      progress,
    );
    select.id = 'yt-publish-privacy';
  }

  if (status) {
    showPublished(status);
    return card;
  }

  // Not published yet: which of states 1/2 applies is an account-level fact
  // this page doesn't have, so ask the server. Painted synchronously first so
  // the card is never empty while that request is in flight.
  setBody(h('p', {class: 'hint'}, ['Checking YouTube connection...']));
  fetch('/api/publish/youtube/status')
    .then((res) => res.json() as Promise<ConnectionStatus>)
    .then((data) => {
      if (data.configured === false) showNotConfigured();
      else if (data.connected) showPublishForm();
      else showConnect();
    })
    .catch(() => {
      setBody(
        h('div', {class: 'error-banner'}, [
          'Could not check the YouTube connection (is "npm run selector" still running?).',
        ]),
      );
    });

  return card;
}
