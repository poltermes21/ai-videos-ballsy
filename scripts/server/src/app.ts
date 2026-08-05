// Ballsy Studio — match selector frontend.
//
// A small client-rendered app with its own History API router (so clicking a
// match opens a real page with working browser back/forward), no framework —
// this tool is simple enough that React/etc. would be pure overhead. Compiled
// to public/app.js by `tsc -p scripts/server/tsconfig.json` (see package.json).

// ---------------------------------------------------------------------------
// Types (mirror the shapes returned by scripts/server/index.mjs)
// ---------------------------------------------------------------------------

type League = {id: number; name: string; category: string | null};
type Season = {id: number; name: string; year: string};
type SeasonsResponse = {seasons: Season[]; defaultSeasonId: number | null};
type Round = {
  key: string;
  round: number;
  name: string | null;
  slug: string | null;
  prefix: string | null;
  label: string;
};
type MatchSummary = {
  id: number;
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  round: number | null;
  date: number;
};
type MatchesResponse = {rounds: Round[]; selectedRound: string | null; matches: MatchSummary[]};
type MatchInfo = {
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  tournament: string | null;
  season: string | null;
  date: number | null;
};
type ReviewStatus = 'pending' | 'approved' | 'rejected';
type LibraryEntry = {
  matchId: string;
  matchInfo: MatchInfo | null;
  reviewStatus: ReviewStatus;
  reviewedAt: string | null;
  hasAudio: boolean;
  hasVideo: boolean;
  updatedAt: string;
};
type ExpressionSegment = {text: string; expression: string};
type TextBlock = {segments: ExpressionSegment[]};
type KeyMomentEvent = {minute: number; event_type: string; outcome: string | null};
type KeyMoment = TextBlock & {events: KeyMomentEvent[]};
type Script = {
  hook: TextBlock;
  key_moments: KeyMoment[];
  controversy: TextBlock | null;
  result: TextBlock;
  outro: TextBlock;
};

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

const app = document.getElementById('app') as HTMLElement;

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

function errorBanner(message: string): HTMLElement {
  return h('div', {class: 'error-banner'}, [message]);
}

// ---------------------------------------------------------------------------
// API client — every call can fail (server down, bad id, SofaScore hiccup);
// callers get a real Error with a readable message instead of a silent no-op.
// ---------------------------------------------------------------------------

async function apiGet<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error(`Could not reach the server (is "npm run selector" still running?)`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((data && (data as {error?: string}).error) || `Request failed (${res.status})`);
  }
  return data as T;
}

async function apiPost<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`Could not reach the server (is "npm run selector" still running?)`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((data && (data as {error?: string}).error) || `Request failed (${res.status})`);
  }
  return data as T;
}

function getFeaturedLeagues(): Promise<League[]> {
  return apiGet('/api/leagues');
}
function searchLeagues(query: string): Promise<League[]> {
  return apiGet(`/api/leagues?q=${encodeURIComponent(query)}`);
}
function getSeasons(tournamentId: number): Promise<SeasonsResponse> {
  return apiGet(`/api/leagues/${tournamentId}/seasons`);
}
function getMatches(tournamentId: number, seasonId: number, round?: string): Promise<MatchesResponse> {
  const roundParam = round ? `&round=${encodeURIComponent(round)}` : '';
  return apiGet(`/api/matches?tournamentId=${tournamentId}&seasonId=${seasonId}${roundParam}`);
}
function getLibrary(): Promise<LibraryEntry[]> {
  return apiGet('/api/library');
}
function getExistingScript(matchId: string): Promise<{script: Script; reviewStatus: ReviewStatus} | null> {
  return fetch(`/api/script/${matchId}`).then(async (res) => {
    if (!res.ok) return null;
    return res.json();
  });
}
function generateScript(matchId: string): Promise<{script: Script}> {
  return apiPost('/api/generate-script', {matchId});
}
function approveScript(matchId: string): Promise<{ok: true}> {
  return apiPost('/api/approve-script', {matchId});
}

// ---------------------------------------------------------------------------
// Router — pathname-based, using the History API so the back/forward
// buttons work like a normal multi-page site, without full reloads.
// ---------------------------------------------------------------------------

function navigate(path: string): void {
  if (location.pathname !== path) {
    history.pushState({}, '', path);
  }
  render();
}

document.addEventListener('click', (e) => {
  const anchor = (e.target as HTMLElement).closest('a[data-link]') as HTMLAnchorElement | null;
  if (!anchor) return;
  e.preventDefault();
  navigate(anchor.getAttribute('href')!);
});

window.addEventListener('popstate', render);

function setActiveNav(path: string): void {
  document.querySelectorAll('.topnav a').forEach((a) => {
    a.classList.toggle('active', a.getAttribute('href') === path);
  });
}

function render(): void {
  const path = location.pathname;
  setActiveNav(path === '/' ? '/' : path.startsWith('/history') ? '/history' : '');
  app.innerHTML = '';

  const matchDetail = path.match(/^\/match\/([^/]+)$/);
  if (matchDetail) {
    renderMatchDetail(decodeURIComponent(matchDetail[1]));
  } else if (path === '/history') {
    renderHistory();
  } else {
    renderHome();
  }
}

// ---------------------------------------------------------------------------
// Home — pick a league, then a season, then a matchday, then a match.
//
// Leagues are a curated list you browse (the server's leagues.json) rather
// than a search-only box: the ones we actually make videos for are a known,
// short set. The search box is the escape hatch for everything else.
// ---------------------------------------------------------------------------

function renderHome(): void {
  const searchField = h('div', {class: 'field'});
  const searchInput = h('input', {type: 'text', id: 'league-search', placeholder: 'Search any other league...'});
  searchField.append(h('label', {}, ['League']), searchInput);
  const leagueResults = h('div', {class: 'list'});
  const selectedLeagueBar = h('div', {class: 'selected-bar hidden'});

  const pickers = h('div', {class: 'pickers hidden mt-lg'});
  const seasonField = h('div', {class: 'field'});
  const seasonSelect = h('select');
  seasonField.append(h('label', {}, ['Season']), seasonSelect);
  const roundField = h('div', {class: 'field'});
  const roundSelect = h('select');
  roundField.append(h('label', {}, ['Matchday']), roundSelect);
  pickers.append(seasonField, roundField);

  const matchResults = h('div', {class: 'list mt-sm'});

  app.append(
    h('div', {class: 'page'}, [
      h('h1', {class: 'page-title'}, ['Find a match']),
      searchField,
      leagueResults,
      selectedLeagueBar,
      pickers,
      matchResults,
    ]),
  );

  let selectedTournament: League | null = null;
  let selectedSeasonId: number | null = null;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  function showLeagues(leagues: League[], emptyMessage: string): void {
    leagueResults.innerHTML = '';
    if (leagues.length === 0) {
      leagueResults.append(h('p', {class: 'hint'}, [emptyMessage]));
      return;
    }
    for (const league of leagues) {
      const row = h('button', {type: 'button', class: 'row'}, [
        h('span', {class: 'row-title'}, [league.name]),
        h('span', {class: 'row-sub'}, [league.category ?? '']),
      ]);
      row.addEventListener('click', () => void selectLeague(league));
      leagueResults.appendChild(row);
    }
  }

  async function loadFeaturedLeagues(): Promise<void> {
    leagueResults.innerHTML = '';
    leagueResults.append(h('p', {class: 'hint'}, ['Loading leagues...']));
    try {
      showLeagues(await getFeaturedLeagues(), 'No leagues configured.');
    } catch (err) {
      leagueResults.innerHTML = '';
      leagueResults.append(errorBanner((err as Error).message));
    }
  }

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const query = searchInput.value.trim();
    if (!query) {
      void loadFeaturedLeagues();
      return;
    }
    searchTimer = setTimeout(async () => {
      leagueResults.innerHTML = '';
      leagueResults.append(h('p', {class: 'hint'}, ['Searching...']));
      try {
        showLeagues(await searchLeagues(query), 'No leagues found.');
      } catch (err) {
        leagueResults.innerHTML = '';
        leagueResults.append(errorBanner((err as Error).message));
      }
    }, 300);
  });

  async function selectLeague(league: League): Promise<void> {
    selectedTournament = league;

    // Collapse the league list into a single summary line once one is picked,
    // instead of leaving dozens of rows expanded above the season/match
    // pickers.
    searchField.classList.add('hidden');
    leagueResults.innerHTML = '';
    selectedLeagueBar.innerHTML = '';
    selectedLeagueBar.classList.remove('hidden');
    const changeBtn = h('button', {type: 'button', class: 'btn ghost'}, ['Change']);
    changeBtn.addEventListener('click', () => {
      selectedTournament = null;
      selectedSeasonId = null;
      selectedLeagueBar.classList.add('hidden');
      searchField.classList.remove('hidden');
      pickers.classList.add('hidden');
      matchResults.innerHTML = '';
      searchInput.value = '';
      void loadFeaturedLeagues();
      searchInput.focus();
    });
    selectedLeagueBar.append(
      h('span', {}, [`${league.name}${league.category ? ' — ' + league.category : ''}`]),
      changeBtn,
    );

    matchResults.innerHTML = '';
    pickers.classList.add('hidden');
    matchResults.append(h('p', {class: 'hint'}, ['Loading seasons...']));

    try {
      const {seasons, defaultSeasonId} = await getSeasons(league.id);
      seasonSelect.innerHTML = '';
      for (const season of seasons) {
        seasonSelect.appendChild(h('option', {value: String(season.id)}, [season.name]));
      }
      // The server already resolved the newest season that actually has
      // finished matches — the newest one is often not under way yet.
      selectedSeasonId = defaultSeasonId ?? seasons[0]?.id ?? null;
      if (selectedSeasonId !== null) seasonSelect.value = String(selectedSeasonId);
      pickers.classList.remove('hidden');
      await loadMatches();
    } catch (err) {
      matchResults.innerHTML = '';
      matchResults.append(errorBanner((err as Error).message));
    }
  }

  seasonSelect.addEventListener('change', () => {
    selectedSeasonId = Number(seasonSelect.value);
    // No round yet for the new season — let the server pick the last played one.
    void loadMatches();
  });

  roundSelect.addEventListener('change', () => void loadMatches(roundSelect.value));

  function fillRounds(rounds: Round[], selected: string | null): void {
    roundSelect.innerHTML = '';
    // Newest matchday first: SofaScore lists them in playing order, and the
    // recent ones are what you'd want to make a video about.
    for (const round of [...rounds].reverse()) {
      roundSelect.appendChild(h('option', {value: round.key}, [round.label]));
    }
    roundField.classList.toggle('hidden', rounds.length === 0);
    if (selected) roundSelect.value = selected;
  }

  async function loadMatches(round?: string): Promise<void> {
    if (!selectedTournament || selectedSeasonId === null) return;
    matchResults.innerHTML = '';
    matchResults.append(h('p', {class: 'hint'}, ['Loading matches...']));
    try {
      const data = await getMatches(selectedTournament.id, selectedSeasonId, round);
      fillRounds(data.rounds, data.selectedRound);
      matchResults.innerHTML = '';
      if (data.matches.length === 0) {
        matchResults.append(h('p', {class: 'hint'}, ['No finished matches in this matchday yet.']));
        return;
      }
      for (const m of data.matches) {
        const date = new Date(m.date * 1000).toLocaleDateString('en-GB');
        const row = h('a', {href: `/match/${m.id}`, 'data-link': '', class: 'row'}, [
          h('span', {}, [
            h('span', {class: 'row-title'}, [`${m.home} ${m.homeScore ?? '?'} - ${m.awayScore ?? '?'} ${m.away}`]),
            h('div', {class: 'row-sub'}, [date]),
          ]),
        ]);
        matchResults.appendChild(row);
      }
    } catch (err) {
      matchResults.innerHTML = '';
      matchResults.append(errorBanner((err as Error).message));
    }
  }

  void loadFeaturedLeagues();
}

// ---------------------------------------------------------------------------
// History — every match a script has ever been generated for. A toolbar
// (search + status filter) below the page title, and matches shown as a
// grid of cards rather than a cramped list.
// ---------------------------------------------------------------------------

function renderHistory(): void {
  const searchInput = h('input', {type: 'text', placeholder: 'Search by team name...'});
  const statusSelect = h('select', {}, [
    h('option', {value: 'all'}, ['All']),
    h('option', {value: 'pending'}, ['Pending review']),
    h('option', {value: 'approved'}, ['Approved']),
    h('option', {value: 'rejected'}, ['Rejected']),
  ]);
  const toolbar = h('div', {class: 'toolbar'});
  toolbar.append(
    h('div', {class: 'field toolbar-search'}, [h('label', {}, ['Search']), searchInput]),
    h('div', {class: 'field toolbar-filter'}, [h('label', {}, ['Status']), statusSelect]),
  );
  const grid = h('div', {class: 'grid mt-lg'});

  app.append(h('div', {class: 'page'}, [h('h1', {class: 'page-title'}, ['History']), toolbar, grid]));

  let entries: LibraryEntry[] = [];

  function statusLabel(status: ReviewStatus): string {
    return status === 'pending' ? 'Pending review' : status === 'approved' ? 'Approved' : 'Rejected';
  }

  function renderGrid(): void {
    const query = searchInput.value.trim().toLowerCase();
    const status = statusSelect.value;
    const filtered = entries.filter((e) => {
      const matchesStatus = status === 'all' || e.reviewStatus === status;
      const label = e.matchInfo ? `${e.matchInfo.home} ${e.matchInfo.away}`.toLowerCase() : e.matchId;
      const matchesQuery = !query || label.includes(query);
      return matchesStatus && matchesQuery;
    });

    grid.innerHTML = '';
    if (filtered.length === 0) {
      grid.append(h('p', {class: 'hint'}, ['Nothing here yet.']));
      return;
    }
    for (const entry of filtered) {
      const title = entry.matchInfo
        ? `${entry.matchInfo.home} ${entry.matchInfo.homeScore ?? '?'} - ${entry.matchInfo.awayScore ?? '?'} ${entry.matchInfo.away}`
        : `Match ${entry.matchId}`;
      const card = h('a', {href: `/match/${entry.matchId}`, 'data-link': '', class: 'match-card'}, [
        h('div', {class: 'match-card-header'}, [
          h('span', {class: `badge ${entry.reviewStatus}`}, [statusLabel(entry.reviewStatus)]),
        ]),
        h('div', {class: 'match-card-title'}, [title]),
        h('div', {class: 'match-card-sub'}, [entry.matchInfo?.tournament ?? '']),
        h('div', {class: 'match-card-status'}, [
          h('span', {class: entry.hasAudio ? 'status-ready' : 'status-pending'}, [
            entry.hasAudio ? 'Audio ready' : 'Audio not generated',
          ]),
          h('span', {class: entry.hasVideo ? 'status-ready' : 'status-pending'}, [
            entry.hasVideo ? 'Video ready' : 'Video not rendered',
          ]),
        ]),
      ]);
      grid.appendChild(card);
    }
  }

  searchInput.addEventListener('input', renderGrid);
  statusSelect.addEventListener('change', renderGrid);

  getLibrary()
    .then((data) => {
      entries = data;
      renderGrid();
    })
    .catch((err) => {
      grid.innerHTML = '';
      grid.append(errorBanner((err as Error).message));
    });
}

// ---------------------------------------------------------------------------
// Match detail — view/generate/approve the script, run the rest of the
// pipeline, then render the final video. One page per match, reached from
// either Home or History, with a real "Back" control.
// ---------------------------------------------------------------------------

function renderMatchDetail(matchId: string): void {
  const state = {reviewStatus: null as ReviewStatus | null, hasAudio: false, hasVideo: false};

  const backLink = h('a', {href: '#', class: 'back-link'}, ['← Back']);
  backLink.addEventListener('click', (e) => {
    e.preventDefault();
    history.back();
  });

  const title = h('h1', {class: 'page-title'}, [`Match ${matchId}`]);
  const statusBadge = h('span', {class: 'badge neutral hidden'});
  const header = h('div', {class: 'workspace-header'}, [title, statusBadge]);

  const generateSection = h('div', {class: 'section'});
  const scriptView = h('div', {class: 'card hidden'});
  const actions = h('div', {class: 'actions hidden'});
  const pipelineSection = h('div', {class: 'section hidden'});
  const renderSection = h('div', {class: 'section hidden'});

  app.append(h('div', {class: 'page'}, [backLink, header, generateSection, scriptView, actions, pipelineSection, renderSection]));

  function updateBadge(): void {
    const label = state.hasVideo ? 'Video ready' : state.hasAudio ? 'Audio ready' : state.reviewStatus ?? '';
    statusBadge.textContent = label;
    statusBadge.className = `badge ${state.hasVideo || state.hasAudio ? 'approved' : state.reviewStatus ?? 'neutral'}`;
    statusBadge.classList.remove('hidden');
  }

  function renderScriptBlocks(script: Script): void {
    scriptView.innerHTML = '';
    const addBlock = (label: string, block: TextBlock): void => {
      scriptView.append(h('h3', {}, [label]));
      for (const seg of block.segments) {
        scriptView.append(h('p', {}, [`(${seg.expression}) ${seg.text}`]));
      }
    };
    addBlock('Hook', script.hook);
    script.key_moments.forEach((m, i) => {
      const events = m.events.map((e) => `${e.minute}' ${e.event_type}${e.outcome ? '/' + e.outcome : ''}`).join(', ');
      addBlock(`Key moment ${i + 1} (${events || 'no graphic'})`, m);
    });
    if (script.controversy) addBlock('Controversy', script.controversy);
    addBlock('Result', script.result);
    addBlock('Outro', script.outro);
  }

  function renderActions(): void {
    actions.innerHTML = '';
    actions.classList.remove('hidden');
    const approved = state.reviewStatus === 'approved';

    if (!approved) {
      const approveBtn = h('button', {type: 'button', class: 'btn primary'}, ['Approve and continue']);
      approveBtn.addEventListener('click', async () => {
        approveBtn.setAttribute('disabled', 'true');
        try {
          await approveScript(matchId);
          state.reviewStatus = 'approved';
          updateBadge();
          runPipeline();
        } catch (err) {
          actions.append(errorBanner((err as Error).message));
          approveBtn.removeAttribute('disabled');
        }
      });
      actions.appendChild(approveBtn);
    }

    const regenerateBtn = h('button', {type: 'button', class: 'btn ghost'}, ['Regenerate script']);
    regenerateBtn.addEventListener('click', () => void runGenerate());
    actions.appendChild(regenerateBtn);

    if (approved && !state.hasAudio) {
      const continueBtn = h('button', {type: 'button', class: 'btn primary'}, ['Continue pipeline']);
      continueBtn.addEventListener('click', runPipeline);
      actions.appendChild(continueBtn);
    }
    if (state.hasAudio) {
      const goRenderBtn = h('button', {type: 'button', class: 'btn primary'}, ['Go to render']);
      goRenderBtn.addEventListener('click', () => {
        pipelineSection.classList.remove('hidden');
        showPipelineDone();
      });
      actions.appendChild(goRenderBtn);
    }
  }

  let pipelineDoneEl: HTMLElement | null = null;
  function showPipelineDone(): void {
    pipelineDoneEl?.remove();
    pipelineDoneEl = h('div', {class: 'mt-md'}, [
      h('p', {class: 'hint'}, [
        'Audio and data ready. FIXTURE_ID updated in src/ballsy.tsx.',
      ]),
    ]);
    const renderBtn = h('button', {type: 'button', class: 'btn primary'}, ['Render video']);
    renderBtn.addEventListener('click', runRender);
    pipelineDoneEl.appendChild(renderBtn);
    pipelineSection.appendChild(pipelineDoneEl);
  }

  function runPipeline(): void {
    pipelineSection.innerHTML = '';
    pipelineSection.classList.remove('hidden');
    pipelineSection.append(
      h('p', {class: 'hint'}, ['Running the rest of the pipeline (audio, lip-sync, graphics, captions).']),
    );
    const log = h('div', {class: 'log'});
    pipelineSection.appendChild(log);

    const source = new EventSource(`/api/run-pipeline?matchId=${encodeURIComponent(matchId)}`);
    source.onmessage = (e) => {
      const msg = JSON.parse(e.data) as {type: string; label?: string; message?: string};
      if (msg.type === 'step') {
        log.textContent += msg.label + '\n';
      } else if (msg.type === 'done') {
        log.textContent += 'Done.\n';
        state.hasAudio = true;
        updateBadge();
        showPipelineDone();
        source.close();
      } else if (msg.type === 'error') {
        log.textContent += 'Error: ' + msg.message + '\n';
        source.close();
      }
    };
  }

  function runRender(): void {
    renderSection.innerHTML = '';
    renderSection.classList.remove('hidden');
    renderSection.append(h('p', {class: 'hint'}, ['Rendering — this can take a few minutes.']));
    const log = h('div', {class: 'log'});
    renderSection.appendChild(log);

    const source = new EventSource(`/api/render?matchId=${encodeURIComponent(matchId)}`);
    source.onmessage = (e) => {
      const msg = JSON.parse(e.data) as {type: string; line?: string; path?: string; message?: string};
      if (msg.type === 'log') {
        log.textContent += msg.line;
        log.scrollTop = log.scrollHeight;
      } else if (msg.type === 'done') {
        state.hasVideo = true;
        updateBadge();
        renderSection.append(h('p', {class: 'hint mt-md'}, [`Video saved to ${msg.path}`]));
        source.close();
      } else if (msg.type === 'error') {
        log.textContent += '\nError: ' + msg.message + '\n';
        source.close();
      }
    };
  }

  async function runGenerate(): Promise<void> {
    scriptView.classList.add('hidden');
    actions.classList.add('hidden');
    generateSection.innerHTML = '';
    generateSection.append(h('p', {class: 'hint'}, ['Generating script...']));
    try {
      const data = await generateScript(matchId);
      state.reviewStatus = 'pending';
      state.hasAudio = false;
      state.hasVideo = false;
      renderScriptBlocks(data.script);
      scriptView.classList.remove('hidden');
      generateSection.innerHTML = '';
      updateBadge();
      renderActions();
    } catch (err) {
      generateSection.innerHTML = '';
      generateSection.append(errorBanner((err as Error).message));
      const retryBtn = h('button', {type: 'button', class: 'btn primary mt-sm'}, ['Try again']);
      retryBtn.addEventListener('click', () => void runGenerate());
      generateSection.appendChild(retryBtn);
    }
  }

  // Try to load an already-generated script for free before offering to
  // spend on a new one.
  getExistingScript(matchId)
    .then((data) => {
      if (data) {
        state.reviewStatus = data.reviewStatus;
        renderScriptBlocks(data.script);
        scriptView.classList.remove('hidden');
        updateBadge();
        renderActions();
      } else {
        const generateBtn = h('button', {type: 'button', class: 'btn primary'}, ['Generate script']);
        generateBtn.addEventListener('click', () => void runGenerate());
        generateSection.append(
          h('p', {class: 'hint'}, ['This calls Anthropic to write the script. This has a cost.']),
          generateBtn,
        );
      }
    })
    .catch((err) => {
      generateSection.append(errorBanner((err as Error).message));
    });
}

render();
