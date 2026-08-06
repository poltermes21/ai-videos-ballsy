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
type ScriptResponse = {
  script: Script;
  reviewStatus: ReviewStatus;
  matchInfo: MatchInfo | null;
  hasAudio: boolean;
  hasVideo: boolean;
};

// Full match report from the SofaScore sidecar (scripts/sofascore/sofascore.py
// `fetch`) — the same data generate-script.mjs sends the model, shown here so
// you can decide whether a match is worth a script before spending on one.
type Side = 'home' | 'away';
type GoalEvent = {
  type: 'goal';
  minute: number | null;
  team: Side;
  player: string | null;
  penalty: boolean;
  ownGoal: boolean;
  homeScore: number | null;
  awayScore: number | null;
  assist: string | null;
};
type PenaltyMissedEvent = {
  type: 'penalty_missed';
  minute: number | null;
  team: Side;
  player: string | null;
  reason: string | null;
  outcome: 'saved' | 'post' | 'out';
};
type CardEvent = {
  type: 'card';
  minute: number | null;
  team: Side;
  cardType: 'yellow' | 'red';
  secondYellow: boolean;
  player: string | null;
  isManager: boolean;
  reason: string | null;
  rescinded: boolean;
};
type SubstitutionEvent = {
  type: 'substitution';
  minute: number | null;
  team: Side;
  in: {name: string | null; number: number | null};
  out: {name: string | null; number: number | null};
};
type VarEvent = {
  type: 'var';
  minute: number | null;
  team: Side;
  decision: string | null;
  player: string | null;
  confirmed: boolean | null;
};
type MatchEvent = GoalEvent | PenaltyMissedEvent | CardEvent | SubstitutionEvent | VarEvent;
type SideStat = {home: number | null; away: number | null};
type MatchForm = {
  home: {position: number | null; points: number | null; last5: string; rating: number | null} | null;
  away: {position: number | null; points: number | null; last5: string; rating: number | null} | null;
};
type MatchH2H = {homeWins: number | null; draws: number | null; awayWins: number | null};
type FullMatchInfo = {
  fixtureId: string;
  home: string;
  away: string;
  homeCode: string | null;
  awayCode: string | null;
  homeScore: number | null;
  awayScore: number | null;
  status: string | null;
  date: number | null;
  tournament: string | null;
  season: string | null;
  context: {form?: MatchForm; h2h?: MatchH2H; stats?: Record<string, SideStat>};
  events: MatchEvent[];
};
type ExpressionSegment = {text: string; expression: string};
type TextBlock = {segments: ExpressionSegment[]};
type KeyMomentEvent = {minute: number; event_type: string; outcome: string | null};
// `events` is optional: scripts saved before the events array existed carry the
// moment's event on the moment itself, and History can still open those.
type KeyMoment = TextBlock & {events?: KeyMomentEvent[]};
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
function getExistingScript(matchId: string): Promise<ScriptResponse | null> {
  return fetch(`/api/script/${matchId}`).then(async (res) => {
    if (!res.ok) return null;
    return res.json();
  });
}
function getMatchInfo(matchId: string): Promise<FullMatchInfo> {
  return apiGet(`/api/match-info/${matchId}`);
}
// Script generations in flight, keyed by match id, shared across page renders.
//
// This is deliberately module-level rather than per-page state. Generating a
// script takes ~30s, and this app never unloads the document — navigating away
// from /match/:id just wipes #app and builds a new page, leaving the old
// page's `await` resolving into DOM nodes nobody can see any more. The server
// finishes the generation regardless of whether the client is still listening
// (execFileAsync isn't cancelled by a disconnect), so the run really is still
// happening; keeping the promise here means coming back to the match re-joins
// that same run — showing "Generating script..." and then the real result —
// instead of offering a "Generate script" button that would spend on Anthropic
// a second time for a script that is already being written.
const inFlightScriptGenerations = new Map<string, Promise<{script: Script}>>();

function isGeneratingScript(matchId: string): boolean {
  return inFlightScriptGenerations.has(matchId);
}

function generateScript(matchId: string): Promise<{script: Script}> {
  const existing = inFlightScriptGenerations.get(matchId);
  if (existing) return existing;
  const pending = apiPost<{script: Script}>('/api/generate-script', {matchId}).finally(() => {
    inFlightScriptGenerations.delete(matchId);
  });
  inFlightScriptGenerations.set(matchId, pending);
  return pending;
}
function approveScript(matchId: string): Promise<{ok: true}> {
  return apiPost('/api/approve-script', {matchId});
}
function saveScript(matchId: string, script: Script): Promise<{ok: true}> {
  return apiPost(`/api/script/${matchId}`, {script});
}
function launchStudio(): Promise<{ok: true; alreadyRunning: boolean}> {
  return apiPost('/api/studio/launch', {});
}
const STUDIO_URL = 'http://localhost:3000';

// Pipeline runs in flight, for the same reason as inFlightScriptGenerations
// above — and with more at stake, since the first step of this chain is the
// paid ElevenLabs call. Navigating away mid-run left the SSE stream writing
// into a detached log and the match still looking like it had no audio, so
// coming back offered "Generate audio and data" again. Re-attaching to the
// live run instead keeps one run per match.
type PipelineRun = {
  log: string;
  status: 'running' | 'done' | 'error';
  // A single slot, not a list: only the page currently on screen should be
  // painting, and the newest attach is by definition that page.
  onUpdate: ((run: PipelineRun) => void) | null;
};

const activePipelines = new Map<string, PipelineRun>();

function startPipeline(matchId: string): PipelineRun {
  const existing = activePipelines.get(matchId);
  if (existing) return existing;

  const run: PipelineRun = {log: '', status: 'running', onUpdate: null};
  activePipelines.set(matchId, run);

  const source = new EventSource(`/api/run-pipeline?matchId=${encodeURIComponent(matchId)}`);
  const finish = (status: 'done' | 'error'): void => {
    run.status = status;
    source.close();
    // Dropped once finished: a page mounted after this point learns the state
    // from /api/script/:matchId (which now reports hasAudio) instead.
    activePipelines.delete(matchId);
    run.onUpdate?.(run);
  };
  source.onmessage = (e) => {
    const msg = JSON.parse(e.data) as {type: string; label?: string; message?: string};
    if (msg.type === 'step') {
      run.log += msg.label + '\n';
      run.onUpdate?.(run);
    } else if (msg.type === 'done') {
      run.log += 'Done.\n';
      finish('done');
    } else if (msg.type === 'error') {
      run.log += 'Error: ' + msg.message + '\n';
      finish('error');
    }
  };
  // A dropped connection would otherwise leave the entry stuck "running"
  // forever, permanently disabling the button for this match.
  source.onerror = () => {
    if (run.status !== 'running') return;
    run.log += 'Lost connection to the server — reload to see the current state.\n';
    finish('error');
  };
  return run;
}

const EXPRESSIONS = ['neutral', 'excited', 'angry', 'disappointed', 'surprised'];

const STAT_LABELS: Record<string, string> = {
  possession: 'Possession',
  shots: 'Shots',
  shotsOnTarget: 'Shots on target',
  xg: 'xG',
  corners: 'Corners',
  saves: 'Saves',
};

// "penaltyNotAwarded" -> "Penalty not awarded".
function humanize(value: string): string {
  const spaced = value.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function describeEvent(event: MatchEvent): {label: string; badge: string; text: string} {
  switch (event.type) {
    case 'goal': {
      const bits = [event.player ?? 'Unknown scorer'];
      if (event.assist) bits.push(`assist: ${event.assist}`);
      if (event.penalty) bits.push('penalty');
      if (event.ownGoal) bits.push('own goal');
      return {label: 'Goal', badge: 'goal', text: bits.join(' — ')};
    }
    case 'penalty_missed': {
      const outcome = {saved: 'saved by the keeper', post: 'hit the post', out: 'off target'}[event.outcome];
      return {label: 'Penalty missed', badge: 'card-red', text: `${event.player ?? 'Unknown player'} — ${outcome}`};
    }
    case 'card': {
      const label = event.cardType === 'red' ? (event.secondYellow ? 'Second yellow' : 'Red card') : 'Yellow card';
      const bits = [event.player ?? 'Unknown'];
      if (event.isManager) bits.push('manager');
      if (event.reason) bits.push(event.reason);
      if (event.rescinded) bits.push('rescinded');
      return {label, badge: event.cardType === 'red' ? 'card-red' : 'card-yellow', text: bits.join(' — ')};
    }
    case 'substitution':
      return {
        label: 'Substitution',
        badge: 'sub',
        text: `${event.in.name ?? '?'} on, ${event.out.name ?? '?'} off`,
      };
    case 'var': {
      const decision = event.decision ? humanize(event.decision) : 'Review';
      const outcome = event.confirmed === false ? 'overturned' : event.confirmed === true ? 'confirmed' : null;
      return {label: 'VAR review', badge: 'var', text: outcome ? `${decision} — ${outcome}` : decision};
    }
  }
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

// Bumped on every render. Async work started by a page (fetches, SSE streams)
// outlives the page that started it — #app is wiped and rebuilt, but the old
// page's closures still hold references to its now-detached nodes. Comparing
// the epoch captured at render time against this tells a late callback that
// its page is gone, so it can bail out instead of writing into DOM nobody is
// looking at (which is what made "generate, navigate away" look like a hang).
let renderEpoch = 0;

function render(): void {
  renderEpoch += 1;
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
// Pipeline stage — the single place that decides "where did this match stop,
// and what happens next". Both the History cards and the match page read it,
// so a card's promise ("Next: render the video") always matches the button you
// actually land on.
// ---------------------------------------------------------------------------

type PipelineState = {reviewStatus: ReviewStatus | null; hasAudio: boolean; hasVideo: boolean};
type Stage = 'review' | 'rejected' | 'audio' | 'render' | 'done';

// Review comes first even when audio/video already exist: if the script was
// regenerated, whatever is on disk was voiced from the *old* script, so the
// next thing to do is still to review the new one.
function pipelineStage(state: PipelineState): Stage {
  if (state.reviewStatus === 'rejected') return 'rejected';
  if (state.reviewStatus !== 'approved') return 'review';
  if (state.hasVideo) return 'done';
  if (state.hasAudio) return 'render';
  return 'audio';
}

const STAGE_ACTION: Record<Stage, string> = {
  review: 'Review the script',
  rejected: 'Regenerate the script',
  audio: 'Generate the audio',
  render: 'Render the video',
  done: 'Nothing left — video is ready',
};

function reviewLabel(status: ReviewStatus): string {
  return status === 'pending' ? 'Pending review' : status === 'approved' ? 'Approved' : 'Rejected';
}

function matchTitle(info: MatchInfo | null, matchId: string): string {
  if (!info) return `Match ${matchId}`;
  return `${info.home} ${info.homeScore ?? '?'} - ${info.awayScore ?? '?'} ${info.away}`;
}

function matchSubtitle(info: MatchInfo | null): string {
  if (!info) return '';
  const date = info.date ? new Date(info.date * 1000).toLocaleDateString('en-GB') : null;
  return [info.tournament, info.season, date].filter(Boolean).join(' · ');
}

// One chip per pipeline artifact. A solid chip means the file exists, a dashed
// muted one means it doesn't — the point being that you can tell at a glance
// whether a script has audio, which reading a status word alone never made
// obvious.
function pipelineChips(state: PipelineState): HTMLElement {
  const chip = (tone: string, text: string): HTMLElement => h('span', {class: `chip ${tone}`}, [text]);
  const presence = (has: boolean, name: string): HTMLElement =>
    has ? chip('done', `✓ ${name}`) : chip('todo', `○ No ${name.toLowerCase()}`);

  const script =
    state.reviewStatus === 'approved'
      ? chip('done', '✓ Script approved')
      : state.reviewStatus === 'rejected'
        ? chip('bad', '✗ Script rejected')
        : chip('warn', '! Script to review');

  return h('div', {class: 'chips'}, [script, presence(state.hasAudio, 'Audio'), presence(state.hasVideo, 'Video')]);
}

// ---------------------------------------------------------------------------
// History — every match a script has ever been generated for. A toolbar
// (search + status/audio/video filters) below the page title, and matches
// shown as a grid of cards that each state their own next step and link
// straight to that match's page.
// ---------------------------------------------------------------------------

function renderHistory(): void {
  const searchInput = h('input', {type: 'text', placeholder: 'Team, league or match id...'});
  const statusSelect = h('select', {}, [
    h('option', {value: 'all'}, ['Any']),
    h('option', {value: 'pending'}, ['Pending review']),
    h('option', {value: 'approved'}, ['Approved']),
    h('option', {value: 'rejected'}, ['Rejected']),
  ]);
  // Deliberately three plain dropdowns rather than clever toggles: "Audio: No
  // audio yet" reads unambiguously, and any combination of the three is
  // reachable without learning what a half-lit toggle means.
  const audioSelect = h('select', {}, [
    h('option', {value: 'all'}, ['Any']),
    h('option', {value: 'yes'}, ['Has audio']),
    h('option', {value: 'no'}, ['No audio yet']),
  ]);
  const videoSelect = h('select', {}, [
    h('option', {value: 'all'}, ['Any']),
    h('option', {value: 'yes'}, ['Has video']),
    h('option', {value: 'no'}, ['No video yet']),
  ]);

  const clearBtn = h('button', {type: 'button', class: 'btn ghost hidden'}, ['Clear filters']);
  const toolbar = h('div', {class: 'toolbar'}, [
    h('div', {class: 'field toolbar-search'}, [h('label', {}, ['Search']), searchInput]),
    h('div', {class: 'field toolbar-filter'}, [h('label', {}, ['Review']), statusSelect]),
    h('div', {class: 'field toolbar-filter'}, [h('label', {}, ['Audio']), audioSelect]),
    h('div', {class: 'field toolbar-filter'}, [h('label', {}, ['Video']), videoSelect]),
  ]);
  const resultCount = h('p', {class: 'hint result-count'});
  const summaryBar = h('div', {class: 'summary-bar'}, [resultCount, clearBtn]);
  const grid = h('div', {class: 'grid'});

  app.append(
    h('div', {class: 'page'}, [
      h('h1', {class: 'page-title'}, ['History']),
      toolbar,
      summaryBar,
      grid,
    ]),
  );

  let entries: LibraryEntry[] = [];

  function filtersActive(): boolean {
    return (
      searchInput.value.trim() !== '' ||
      statusSelect.value !== 'all' ||
      audioSelect.value !== 'all' ||
      videoSelect.value !== 'all'
    );
  }

  function matchesPresence(filter: string, has: boolean): boolean {
    return filter === 'all' || (filter === 'yes') === has;
  }

  function card(entry: LibraryEntry): HTMLElement {
    const stage = pipelineStage(entry);
    return h('a', {href: `/match/${entry.matchId}`, 'data-link': '', class: 'match-card'}, [
      h('div', {class: 'match-card-header'}, [
        h('span', {class: `badge ${entry.reviewStatus}`}, [reviewLabel(entry.reviewStatus)]),
        h('span', {class: 'match-card-date'}, [new Date(entry.updatedAt).toLocaleDateString('en-GB')]),
      ]),
      h('div', {class: 'match-card-title'}, [matchTitle(entry.matchInfo, entry.matchId)]),
      h('div', {class: 'match-card-sub'}, [matchSubtitle(entry.matchInfo) || `Match ${entry.matchId}`]),
      pipelineChips(entry),
      h('div', {class: `match-card-next ${stage}`}, [
        stage === 'done' ? 'Video ready' : `Next: ${STAGE_ACTION[stage].toLowerCase()} →`,
      ]),
    ]);
  }

  function renderGrid(): void {
    const query = searchInput.value.trim().toLowerCase();
    const filtered = entries.filter((e) => {
      if (statusSelect.value !== 'all' && e.reviewStatus !== statusSelect.value) return false;
      if (!matchesPresence(audioSelect.value, e.hasAudio)) return false;
      if (!matchesPresence(videoSelect.value, e.hasVideo)) return false;
      if (!query) return true;
      const haystack = [
        e.matchId,
        e.matchInfo?.home,
        e.matchInfo?.away,
        e.matchInfo?.tournament,
        e.matchInfo?.season,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });

    clearBtn.classList.toggle('hidden', !filtersActive());
    resultCount.textContent =
      entries.length === 0
        ? ''
        : `${filtered.length} of ${entries.length} ${entries.length === 1 ? 'match' : 'matches'}`;

    grid.innerHTML = '';
    if (entries.length === 0) {
      grid.append(
        h('p', {class: 'hint'}, ['No scripts generated yet — start one from "New match".']),
      );
      return;
    }
    if (filtered.length === 0) {
      grid.append(h('p', {class: 'hint'}, ['No saved match matches these filters.']));
      return;
    }
    for (const entry of filtered) grid.appendChild(card(entry));
  }

  searchInput.addEventListener('input', renderGrid);
  for (const select of [statusSelect, audioSelect, videoSelect]) {
    select.addEventListener('change', renderGrid);
  }
  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    statusSelect.value = 'all';
    audioSelect.value = 'all';
    videoSelect.value = 'all';
    renderGrid();
  });

  resultCount.textContent = 'Loading...';
  getLibrary()
    .then((data) => {
      entries = data;
      renderGrid();
    })
    .catch((err) => {
      resultCount.textContent = '';
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
  // Everything below runs against nodes that only exist while this page is on
  // screen; once the user navigates, they're detached and writing to them is a
  // silent no-op. Every async continuation checks this first.
  const pageEpoch = renderEpoch;
  const isStale = (): boolean => pageEpoch !== renderEpoch;

  const state: PipelineState = {reviewStatus: null, hasAudio: false, hasVideo: false};
  // The script currently on screen, mutated in place as the user edits it —
  // Save/Approve both send this exact object back to the server.
  let currentScript: Script | null = null;
  let scriptDirty = false;

  const backLink = h('a', {href: '#', class: 'back-link'}, ['← Back']);
  backLink.addEventListener('click', (e) => {
    e.preventDefault();
    history.back();
  });

  const title = h('h1', {class: 'page-title'}, [`Match ${matchId}`]);
  const subtitle = h('p', {class: 'hint'});
  const header = h('div', {class: 'workspace-header'}, [title]);
  const statusStrip = h('div', {class: 'status-strip hidden'});

  const matchInfoSection = h('div', {class: 'section'});
  const generateSection = h('div', {class: 'section'});
  const scriptView = h('div', {class: 'card hidden'});
  const saveBar = h('div', {class: 'save-bar hidden'});
  const saveBtn = h('button', {type: 'button', class: 'btn primary'}, ['Save changes']);
  saveBtn.addEventListener('click', () => void saveEdits());
  saveBar.append(h('span', {class: 'hint'}, ['Unsaved edits']), saveBtn);
  const actions = h('div', {class: 'actions hidden'});
  const costHint = h('p', {class: 'hint hidden'}, [
    'Regenerating the script (Anthropic) and generating audio (ElevenLabs) are paid steps.',
  ]);
  const pipelineSection = h('div', {class: 'section hidden'});
  const renderSection = h('div', {class: 'section hidden'});

  app.append(
    h('div', {class: 'page'}, [
      backLink,
      header,
      subtitle,
      statusStrip,
      matchInfoSection,
      generateSection,
      scriptView,
      saveBar,
      actions,
      costHint,
      pipelineSection,
      renderSection,
    ]),
  );

  // What actually happened in the match — score, form, event timeline, match
  // stats — so you can judge whether it's worth a script before spending on
  // one. Pulled from the same SofaScore data generate-script.mjs uses, so
  // there's nothing new to fetch, just somewhere to show it first.
  function renderMatchInfo(info: FullMatchInfo): void {
    // The page title used to only update once a script existed (inside the
    // getExistingScript branch below) — fine coming from History, where a
    // script always exists, but coming from the match picker (no script yet)
    // it was stuck on "Match 14081810" the whole time. This call succeeds for
    // any valid match regardless of script status, so set it from here too.
    const compactInfo: MatchInfo = {
      home: info.home,
      away: info.away,
      homeScore: info.homeScore,
      awayScore: info.awayScore,
      tournament: info.tournament,
      season: info.season,
      date: info.date,
    };
    title.textContent = matchTitle(compactInfo, matchId);
    subtitle.textContent = matchSubtitle(compactInfo);

    matchInfoSection.innerHTML = '';
    const card = h('div', {class: 'card match-report'});

    const formBadges = (last5: string): HTMLElement => {
      const wrap = h('div', {class: 'form-strip'});
      for (const letter of last5) {
        const cls = letter === 'W' ? 'win' : letter === 'D' ? 'draw' : letter === 'L' ? 'loss' : 'unknown';
        wrap.append(h('span', {class: `form-badge ${cls}`}, [letter]));
      }
      return wrap;
    };

    const homeForm = info.context.form?.home;
    const awayForm = info.context.form?.away;
    card.append(
      h('div', {class: 'scoreboard'}, [
        h('div', {class: 'scoreboard-side'}, [
          h('div', {class: 'scoreboard-code'}, [info.homeCode ?? info.home]),
          h('div', {class: 'scoreboard-name'}, [info.home]),
          ...(homeForm?.last5 ? [formBadges(homeForm.last5)] : []),
        ]),
        h('div', {class: 'scoreboard-score'}, [`${info.homeScore ?? '-'} : ${info.awayScore ?? '-'}`]),
        h('div', {class: 'scoreboard-side'}, [
          h('div', {class: 'scoreboard-code'}, [info.awayCode ?? info.away]),
          h('div', {class: 'scoreboard-name'}, [info.away]),
          ...(awayForm?.last5 ? [formBadges(awayForm.last5)] : []),
        ]),
      ]),
    );
    const metaBits = [info.tournament, info.season, info.date ? new Date(info.date * 1000).toLocaleDateString('en-GB') : null]
      .filter(Boolean);
    if (metaBits.length) card.append(h('p', {class: 'hint scoreboard-meta'}, [metaBits.join(' · ')]));

    const h2h = info.context.h2h;
    if (h2h && (h2h.homeWins !== null || h2h.draws !== null || h2h.awayWins !== null)) {
      card.append(
        h('p', {class: 'hint'}, [
          `Head-to-head: ${h2h.homeWins ?? 0}W ${h2h.draws ?? 0}D ${h2h.awayWins ?? 0}L (from ${info.home}'s side)`,
        ]),
      );
    }

    const stats = info.context.stats;
    if (stats && Object.keys(stats).length) {
      card.append(h('h3', {}, ['Match stats']));
      const statsList = h('div', {class: 'stats-list'});
      for (const [key, {home, away}] of Object.entries(stats)) {
        if (home === null && away === null) continue;
        const total = (home ?? 0) + (away ?? 0);
        const homePct = total > 0 ? ((home ?? 0) / total) * 100 : 50;
        statsList.append(
          h('div', {class: 'stat-row'}, [
            h('span', {class: 'stat-value'}, [String(home ?? '-')]),
            h('span', {class: 'stat-label'}, [STAT_LABELS[key] ?? key]),
            h('span', {class: 'stat-value'}, [String(away ?? '-')]),
          ]),
          h('div', {class: 'stat-bar'}, [
            h('span', {class: 'stat-bar-home', style: `width:${homePct}%`}),
            h('span', {class: 'stat-bar-away', style: `width:${100 - homePct}%`}),
          ]),
        );
      }
      card.append(statsList);
    }

    if (info.events.length) {
      card.append(h('h3', {}, ['Match timeline']));
      const timeline = h('div', {class: 'timeline'});
      for (const event of [...info.events].sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0))) {
        const {label, badge, text} = describeEvent(event);
        const content = h('div', {class: 'timeline-content'}, [
          h('span', {class: `badge ${badge}`}, [label]),
          h('span', {}, [text]),
        ]);
        const row = h('div', {class: `timeline-row ${event.team}`}, [
          event.team === 'home' ? content : h('div', {class: 'timeline-content'}),
          h('div', {class: 'timeline-minute'}, [
            event.minute === null ? '' : event.minute < 0 ? 'Pre-match' : `${event.minute}'`,
          ]),
          event.team === 'away' ? content : h('div', {class: 'timeline-content'}),
        ]);
        timeline.append(row);
      }
      card.append(timeline);
    } else {
      card.append(h('p', {class: 'hint'}, ['No event details available for this match.']));
    }

    matchInfoSection.append(card);
  }

  function loadMatchInfo(): void {
    matchInfoSection.innerHTML = '';
    matchInfoSection.append(h('p', {class: 'hint'}, ['Loading match report...']));
    getMatchInfo(matchId)
      .then((info) => {
        if (isStale()) return;
        renderMatchInfo(info);
      })
      .catch((err) => {
        if (isStale()) return;
        matchInfoSection.innerHTML = '';
        matchInfoSection.append(errorBanner(`Could not load match report: ${(err as Error).message}`));
      });
  }

  // Same chips + "next step" wording as the History cards, so arriving from a
  // card that said "Next: render the video" shows exactly that here.
  function updateStatusStrip(): void {
    if (state.reviewStatus === null) return;
    const stage = pipelineStage(state);
    statusStrip.innerHTML = '';
    statusStrip.classList.remove('hidden');
    statusStrip.append(
      pipelineChips(state),
      h('p', {class: `match-card-next ${stage}`}, [
        stage === 'done' ? 'Video ready' : `Next: ${STAGE_ACTION[stage].toLowerCase()}`,
      ]),
    );
  }

  function setDirty(dirty: boolean): void {
    scriptDirty = dirty;
    saveBar.classList.toggle('hidden', !dirty);
  }

  // Edits text/expression on existing lines only — never adds, removes, or
  // reorders segments, since key_moments[].events[].segmentIndex points at a
  // segment by position, and the audio/graphics pipeline assumes the same
  // segment count the script was tagged against.
  function renderScriptBlocks(script: Script): void {
    currentScript = script;
    setDirty(false);
    scriptView.innerHTML = '';

    const addBlock = (label: string, block: TextBlock): void => {
      scriptView.append(h('h3', {}, [label]));
      for (const seg of block.segments) {
        const textArea = h('textarea', {class: 'segment-text', rows: '2'});
        textArea.value = seg.text;
        textArea.addEventListener('input', () => {
          seg.text = textArea.value;
          setDirty(true);
        });

        const expressionSelect = h('select', {class: 'segment-expression'});
        for (const exp of EXPRESSIONS) {
          expressionSelect.appendChild(h('option', {value: exp}, [exp]));
        }
        expressionSelect.value = seg.expression;
        expressionSelect.addEventListener('change', () => {
          seg.expression = expressionSelect.value;
          setDirty(true);
        });

        scriptView.append(h('div', {class: 'segment-row'}, [expressionSelect, textArea]));
      }
    };
    addBlock('Hook', script.hook);
    script.key_moments.forEach((m, i) => {
      const events = (m.events ?? [])
        .map((e) => `${e.minute}' ${e.event_type}${e.outcome ? '/' + e.outcome : ''}`)
        .join(', ');
      addBlock(`Key moment ${i + 1} (${events || 'no graphic'})`, m);
    });
    if (script.controversy) addBlock('Controversy', script.controversy);
    addBlock('Result', script.result);
    addBlock('Outro', script.outro);
  }

  let saveErrorEl: HTMLElement | null = null;

  // Returns whether the save actually landed, so callers that only make sense
  // on a saved script (Approve) can stop instead of carrying on over an edit
  // the server rejected.
  async function saveEdits(): Promise<boolean> {
    if (!currentScript) return false;
    saveBtn.setAttribute('disabled', 'true');
    saveErrorEl?.remove();
    try {
      await saveScript(matchId, currentScript);
      if (isStale()) return true;
      setDirty(false);
      return true;
    } catch (err) {
      if (isStale()) return false;
      saveErrorEl = errorBanner((err as Error).message);
      saveBar.append(saveErrorEl);
      return false;
    } finally {
      saveBtn.removeAttribute('disabled');
    }
  }

  // Exactly one primary button — whatever this match's next pipeline step is —
  // plus the re-runs as ghosts. Before this knew about existing audio, an
  // already-voiced match still offered "Continue pipeline" as its main action,
  // which would have re-spent on ElevenLabs instead of rendering.
  function renderActions(): void {
    actions.innerHTML = '';
    actions.classList.remove('hidden');
    costHint.classList.remove('hidden');
    const stage = pipelineStage(state);
    const pipelineRunning = activePipelines.has(matchId);
    const generating = isGeneratingScript(matchId);

    if (stage === 'review' || stage === 'rejected') {
      // A rejected script's next step is a rewrite, so approving it is the
      // override here, not the headline action.
      const cls = stage === 'rejected' ? 'btn ghost' : 'btn primary';
      // Approval and the paid audio run are two clicks, not one: approving is
      // free and reversible, generating audio spends on ElevenLabs, and
      // chaining them meant the only way to record "this script is good" was
      // to also commit to paying. Re-rendering the actions after approving
      // lands on the 'audio' stage on its own (pipelineStage: approved without
      // audio), so the "Generate audio and data" button appears right here.
      const approveBtn = h('button', {type: 'button', class: cls}, ['Approve']);
      // Approving mid-regeneration would approve the script that is about to
      // be overwritten.
      if (generating) approveBtn.setAttribute('disabled', 'true');
      approveBtn.addEventListener('click', async () => {
        approveBtn.setAttribute('disabled', 'true');
        try {
          // Never approve over an edit still sitting unsaved in the textareas.
          if (scriptDirty && !(await saveEdits())) {
            approveBtn.removeAttribute('disabled');
            return;
          }
          await approveScript(matchId);
          if (isStale()) return;
          state.reviewStatus = 'approved';
          updateStatusStrip();
          renderActions();
        } catch (err) {
          if (isStale()) return;
          actions.append(errorBanner((err as Error).message));
          approveBtn.removeAttribute('disabled');
        }
      });
      actions.appendChild(approveBtn);
    }

    if (stage === 'audio') {
      const continueBtn = h('button', {type: 'button', class: 'btn primary'}, [
        pipelineRunning ? 'Generating audio...' : 'Generate audio and data',
      ]);
      if (pipelineRunning) continueBtn.setAttribute('disabled', 'true');
      else continueBtn.addEventListener('click', runPipeline);
      actions.appendChild(continueBtn);
    }

    if (stage === 'render' || stage === 'done') {
      const renderBtn = h('button', {type: 'button', class: 'btn primary'}, [
        stage === 'done' ? 'Render again' : 'Render video',
      ]);
      renderBtn.addEventListener('click', runRender);
      actions.appendChild(renderBtn);

      // The audio/graphics/captions data is all in place at this stage — this
      // opens the real composition in Remotion Studio (scrubbable, exactly
      // what a final render would produce) so you can judge it before
      // spending the render time, not just after.
      const previewBtn = h('button', {type: 'button', class: 'btn ghost'}, ['Preview in Remotion Studio']);
      previewBtn.addEventListener('click', async () => {
        previewBtn.setAttribute('disabled', 'true');
        previewBtn.textContent = 'Starting Remotion Studio...';
        try {
          await launchStudio();
          window.open(`${STUDIO_URL}/Ballsy`, '_blank');
        } catch (err) {
          actions.append(errorBanner((err as Error).message));
        } finally {
          previewBtn.removeAttribute('disabled');
          previewBtn.textContent = 'Preview in Remotion Studio';
        }
      });
      actions.appendChild(previewBtn);
    }

    const regenerateBtn = h(
      'button',
      {type: 'button', class: stage === 'rejected' ? 'btn primary' : 'btn ghost'},
      [generating ? 'Generating script...' : 'Regenerate script'],
    );
    if (generating) regenerateBtn.setAttribute('disabled', 'true');
    else regenerateBtn.addEventListener('click', () => void runGenerate());
    if (stage === 'rejected') actions.prepend(regenerateBtn);
    else actions.appendChild(regenerateBtn);

    if (state.hasAudio) {
      const rerunBtn = h('button', {type: 'button', class: 'btn ghost'}, ['Re-run audio and data']);
      if (pipelineRunning) rerunBtn.setAttribute('disabled', 'true');
      else rerunBtn.addEventListener('click', runPipeline);
      actions.appendChild(rerunBtn);
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

  // Paints a pipeline run into this page — whether it was just started here or
  // was already running when the page mounted (started before the user
  // navigated away and back).
  function attachPipeline(run: PipelineRun): void {
    pipelineSection.innerHTML = '';
    pipelineSection.classList.remove('hidden');
    pipelineSection.append(
      h('p', {class: 'hint'}, ['Running the rest of the pipeline (audio, lip-sync, graphics, captions).']),
    );
    const log = h('div', {class: 'log'});
    pipelineSection.appendChild(log);

    const paint = (r: PipelineRun): void => {
      if (isStale()) return;
      log.textContent = r.log;
      log.scrollTop = log.scrollHeight;
      if (r.status === 'done') {
        state.hasAudio = true;
        updateStatusStrip();
        renderActions();
        showPipelineDone();
      } else if (r.status === 'error') {
        renderActions();
      }
    };
    run.onUpdate = paint;
    paint(run);
  }

  function runPipeline(): void {
    attachPipeline(startPipeline(matchId));
    // The button that triggered this becomes "Generating audio..." until the
    // run finishes, so it can't be clicked into a second paid run.
    renderActions();
  }

  function runRender(): void {
    renderSection.innerHTML = '';
    renderSection.classList.remove('hidden');
    renderSection.append(h('p', {class: 'hint'}, ['Rendering — this can take a few minutes.']));
    const log = h('div', {class: 'log'});
    renderSection.appendChild(log);

    const source = new EventSource(`/api/render?matchId=${encodeURIComponent(matchId)}`);
    // Rendering is local and free, so an abandoned render is only wasted CPU,
    // not money — but the stream still has to be closed on navigation, or
    // EventSource would reconnect after the server ends it and start a whole
    // second render.
    source.onerror = () => source.close();
    source.onmessage = (e) => {
      if (isStale()) {
        source.close();
        return;
      }
      const msg = JSON.parse(e.data) as {type: string; line?: string; path?: string; message?: string};
      if (msg.type === 'log') {
        log.textContent += msg.line;
        log.scrollTop = log.scrollHeight;
      } else if (msg.type === 'done') {
        state.hasVideo = true;
        updateStatusStrip();
        renderActions();
        renderSection.append(h('p', {class: 'hint mt-md'}, [`Video saved to ${msg.path}`]));
        source.close();
      } else if (msg.type === 'error') {
        log.textContent += '\nError: ' + msg.message + '\n';
        source.close();
      }
    };
  }

  // Starts a generation, or re-attaches to the one already running for this
  // match (see inFlightScriptGenerations) — the caller can't tell the
  // difference, and neither can the user, which is the point.
  async function runGenerate(): Promise<void> {
    scriptView.classList.add('hidden');
    saveBar.classList.add('hidden');
    generateSection.innerHTML = '';
    generateSection.append(
      h('p', {class: 'hint'}, ['Generating script... this takes about half a minute.']),
    );
    // Register the run *before* re-rendering the actions: renderActions reads
    // isGeneratingScript() to disable Approve/Regenerate, and generateScript
    // only fills that map when it's called.
    const pending = generateScript(matchId);
    // Re-render rather than hide, so "Regenerate script" shows as disabled
    // ("Generating script...") instead of the actions vanishing entirely.
    if (state.reviewStatus !== null) renderActions();
    try {
      const data = await pending;
      if (isStale()) return;
      // hasAudio/hasVideo are left alone: those files still exist on disk (now
      // stale), and pipelineStage sends an unreviewed script back to review
      // regardless.
      state.reviewStatus = 'pending';
      renderScriptBlocks(data.script);
      scriptView.classList.remove('hidden');
      generateSection.innerHTML = '';
      updateStatusStrip();
      renderActions();
      // Free follow-up: a first generation is the point at which matchInfo
      // (team names, competition, date) becomes readable from disk, so the
      // header stops saying "Match 14200873".
      void refreshHeader();
    } catch (err) {
      if (isStale()) return;
      generateSection.innerHTML = '';
      generateSection.append(errorBanner((err as Error).message));
      const retryBtn = h('button', {type: 'button', class: 'btn primary mt-sm'}, ['Try again']);
      retryBtn.addEventListener('click', () => void runGenerate());
      generateSection.appendChild(retryBtn);
      if (state.reviewStatus !== null) renderActions();
    }
  }

  async function refreshHeader(): Promise<void> {
    try {
      const data = await getExistingScript(matchId);
      if (isStale() || !data) return;
      title.textContent = matchTitle(data.matchInfo, matchId);
      subtitle.textContent = matchSubtitle(data.matchInfo);
    } catch {
      // Cosmetic only — the page already has the script it needs.
    }
  }

  loadMatchInfo();

  // Try to load an already-generated script for free before offering to
  // spend on a new one.
  getExistingScript(matchId)
    .then((data) => {
      if (isStale()) return;
      if (data) {
        state.reviewStatus = data.reviewStatus;
        state.hasAudio = data.hasAudio;
        state.hasVideo = data.hasVideo;
        title.textContent = matchTitle(data.matchInfo, matchId);
        subtitle.textContent = matchSubtitle(data.matchInfo);
        renderScriptBlocks(data.script);
        scriptView.classList.remove('hidden');
        updateStatusStrip();
        renderActions();
      }

      // A run started before the user navigated away is still going on the
      // server. Re-attach to it rather than showing a button that would start
      // a second, paid run of the same thing.
      if (isGeneratingScript(matchId)) {
        void runGenerate();
        return;
      }
      if (activePipelines.has(matchId)) {
        attachPipeline(activePipelines.get(matchId)!);
        return;
      }

      if (!data) {
        const generateBtn = h('button', {type: 'button', class: 'btn primary'}, ['Generate script']);
        generateBtn.addEventListener('click', () => void runGenerate());
        generateSection.append(
          h('p', {class: 'hint'}, ['This calls Anthropic to write the script. This has a cost.']),
          generateBtn,
        );
      }
    })
    .catch((err) => {
      if (isStale()) return;
      generateSection.append(errorBanner((err as Error).message));
    });
}

render();
