// Ballsy Studio — match selector frontend.
//
// A small client-rendered app with its own History API router (so clicking a
// match opens a real page with working browser back/forward), no framework —
// this tool is simple enough that React/etc. would be pure overhead. Compiled
// to public/app.js by `tsc -p scripts/server/tsconfig.json` (see package.json).
//
// The two publish-UI modules are the one deliberate exception to keeping
// this a single file: each is owned entirely by its own platform's
// integration (see scripts/server/publish-youtube.mjs / publish-tiktok.mjs
// on the server side), so building/reviewing one never touches the other's
// code.
import {renderYoutubePublishBlock} from './youtube-publish-ui.js';
import {renderTiktokPublishBlock} from './tiktok-publish-ui.js';

// ---------------------------------------------------------------------------
// Types (mirror the shapes returned by scripts/server/index.mjs)
// ---------------------------------------------------------------------------

// The run slug a script with no focus prompt is saved/looked-up under —
// mirrors scripts/lib/run-paths.mjs's DEFAULT_RUN_SLUG on the server.
const DEFAULT_RUN_SLUG = 'default';

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

// Publish status persisted alongside the script — null until that platform's
// "Publish" button has actually succeeded once for this match.
type YoutubePublishStatus = {videoId: string; url: string; privacyStatus: string; publishedAt: string} | null;
type TiktokPublishStatus = {publishId: string; privacyLevel: string; publishedAt: string} | null;
type PublishMetadata = {title: string; description: string; hashtags: string[]};

// One RUN of a match's script — 'default' with no focus, otherwise a
// slugified focus prompt (see scripts/lib/run-paths.mjs). A different focus
// than an existing run is its own entry, never overwriting one already
// approved/rendered — mirrors PlayerLibraryEntry's per-date runs below.
type MatchLibraryEntry = {
  kind: 'match';
  matchId: string;
  runSlug: string;
  focusPrompt: string | null;
  // Free-text name the user gave this video (null = show its focus/version),
  // and when it was first generated (null on runs saved before this existed).
  label: string | null;
  createdAt: string | null;
  matchInfo: MatchInfo | null;
  reviewStatus: ReviewStatus;
  reviewedAt: string | null;
  hasAudio: boolean;
  hasVideo: boolean;
  videoUrl: string | null;
  youtube: YoutubePublishStatus;
  tiktok: TiktokPublishStatus;
  updatedAt: string;
};
// One dated (optionally focused) RUN for a player — a player's form changes
// week to week, so each generation is its own entry (playerId + date +
// runSlug), never overwriting an earlier one for the same player/day/focus.
type PlayerLibraryEntry = {
  kind: 'player';
  playerId: string;
  date: string;
  runSlug: string;
  focusPrompt: string | null;
  // Free-text name the user gave this video (null = show its focus/version),
  // and when it was first generated (null on runs saved before this existed).
  label: string | null;
  createdAt: string | null;
  playerInfo: PlayerInfo | null;
  reviewStatus: ReviewStatus;
  reviewedAt: string | null;
  hasAudio: boolean;
  hasVideo: boolean;
  videoUrl: string | null;
  youtube: YoutubePublishStatus;
  tiktok: TiktokPublishStatus;
  updatedAt: string;
};
// One RUN of a fixture PREVIEW — the same match id as an eventual recap of
// that fixture, but a separate id space end to end (fixture id
// "prematch-<matchId>", its own scripts/output/prematch/ and out/prematch/
// trees), so a preview and a recap of one match never overwrite each other.
// See scripts/lib/run-paths.mjs.
type PrematchLibraryEntry = {
  kind: 'prematch';
  matchId: string;
  runSlug: string;
  focusPrompt: string | null;
  // Free-text name the user gave this video (null = show its focus/version),
  // and when it was first generated (null on runs saved before this existed).
  label: string | null;
  createdAt: string | null;
  matchInfo: PrematchMatchInfo | null;
  reviewStatus: ReviewStatus;
  reviewedAt: string | null;
  hasAudio: boolean;
  hasVideo: boolean;
  videoUrl: string | null;
  youtube: YoutubePublishStatus;
  tiktok: TiktokPublishStatus;
  updatedAt: string;
};
// A discriminated union so History can render any kind of video from one
// list — see `entry.kind` everywhere this is consumed.
type LibraryEntry = MatchLibraryEntry | PlayerLibraryEntry | PrematchLibraryEntry;
type ScriptResponse = {
  script: Script;
  publishMetadata: PublishMetadata | null;
  reviewStatus: ReviewStatus;
  matchInfo: MatchInfo | null;
  focusPrompt: string | null;
  label: string | null;
  createdAt: string | null;
  runSlug: string;
  hasAudio: boolean;
  hasVideo: boolean;
  videoUrl: string | null;
  youtube: YoutubePublishStatus;
  tiktok: TiktokPublishStatus;
};

// ---------------------------------------------------------------------------
// Player-video types (mirror scripts/server/player.mjs + generate-player-*)
// ---------------------------------------------------------------------------

type PlayerSearchResult = {
  id: number;
  name: string;
  position: string | null;
  jerseyNumber: number | null;
  country: string | null;
  teamId: number | null;
  team: string | null;
};
type PlayerSeasonOption = {
  tournamentId: number;
  tournament: string;
  seasons: {id: number; name: string; year: string}[];
};
// A single competition-picker choice, and its resolved display names once
// sofascore.py has looked them up — the exact shape getPlayerForm's
// `competitions` param takes (see match-source.mjs), and what's persisted
// as PlayerInfo.competitions so a later re-fetch asks for the same set.
type CompetitionSelection = {tournamentId: number; seasonId: number};
type ResolvedCompetition = CompetitionSelection & {tournament: string | null; seasonName: string | null};
type PlayerAppearance = {date: string; opponent: string; competition: string | null; goals: number; assists: number};
type PlayerSeasonStats = {
  rating: number | null;
  appearances: number | null;
  goals: number | null;
  assists: number | null;
  minutesPlayed: number | null;
};
type PlayerFixtureRef = {date: number | null; opponent: string; competition: string | null} | null;
type PlayerForm = {
  profile: {
    id: number;
    name: string;
    position: string | null;
    jerseyNumber: number | null;
    marketValueEUR: number | null;
    country: string | null;
  };
  team: {id: number; name: string; code: string | null; color: string | null};
  competitions: ResolvedCompetition[];
  competition: string | null;
  appearances: number;
  withGoalOrAssist: number;
  withGoal: number;
  goals: number;
  assists: number;
  consecutiveWithGoalOrAssist: number;
  consecutiveWithGoal: number;
  recent: PlayerAppearance[];
  missedMatchesInWindow: boolean;
  seasonStats: PlayerSeasonStats;
  upcomingFixture: PlayerFixtureRef;
  personalAngle: {type: 'favorite' | 'rival'; team: string} | null;
};
// Compact identity persisted alongside a player script — mirrors MatchInfo's role.
type PlayerInfo = {
  id: number;
  name: string;
  team: string;
  teamId: number;
  competition: string | null;
  competitions: ResolvedCompetition[];
};
type PlayerStatTag = {segmentIndex: number; statType: string};
// `stats` (not `events`) is the one shape difference from KeyMoment.
type PlayerKeyMoment = TextBlock & {stats?: PlayerStatTag[]};
type PlayerScript = {
  hook: TextBlock;
  key_moments: PlayerKeyMoment[];
  controversy: TextBlock | null;
  result: TextBlock;
  outro: TextBlock;
};
type PlayerScriptResponse = {
  script: PlayerScript;
  publishMetadata: PublishMetadata | null;
  reviewStatus: ReviewStatus;
  playerInfo: PlayerInfo | null;
  focusPrompt: string | null;
  label: string | null;
  createdAt: string | null;
  date: string;
  runSlug: string;
  hasAudio: boolean;
  hasVideo: boolean;
  videoUrl: string | null;
  youtube: YoutubePublishStatus;
  tiktok: TiktokPublishStatus;
};
// The per-entity "videos" lists (overview pages) return the same full row the
// library does, so one video row component can render either.
type PlayerRun = PlayerLibraryEntry;
type MatchRun = MatchLibraryEntry;

// ---------------------------------------------------------------------------
// Pre-match preview types (mirror scripts/server/prematch.mjs +
// generate-prematch-*). Everything here describes a fixture that HASN'T been
// played — so there is no score, and no event list, anywhere in these shapes.
// ---------------------------------------------------------------------------

type TeamSearchResult = {
  id: number;
  name: string;
  code: string | null;
  color: string | null;
  country: string | null;
};
// What GET /api/prematch/next-fixture resolves two picked teams into — null
// when they aren't scheduled to meet any time soon.
type NextFixture = {
  matchId: number;
  home: string;
  away: string;
  homeId: number;
  awayId: number;
  tournament: string | null;
  tournamentId: number | null;
  round: number | null;
  status: string;
  date: number | null;
} | null;
type TeamStreak = {
  matchesConsidered: number;
  winStreak: number;
  unbeatenStreak: number;
  lossStreak: number;
  winlessStreak: number;
};
type StandingsRow = {position: number | null; points: number | null; played: number | null};
// The full free preview report (GET /api/prematch/info/:matchId) — exactly
// what generate-prematch-script.mjs sends the model.
type FullPrematchInfo = {
  fixtureId: string;
  home: string;
  away: string;
  homeCode: string | null;
  awayCode: string | null;
  tournament: string | null;
  season: string | null;
  round: number | null;
  date: number | null;
  status: string;
  context: {
    form?: MatchForm;
    h2h?: MatchH2H;
    teamStreaks?: {home: TeamStreak | null; away: TeamStreak | null};
    standings?: {home: StandingsRow | null; away: StandingsRow | null};
    personalAngle?: {type: 'favorite' | 'rival'; team: string};
  };
};
// Compact fixture identity persisted alongside a preview script — the
// preview's own MatchInfo, minus the score that doesn't exist yet.
type PrematchMatchInfo = {
  home: string;
  away: string;
  homeCode: string | null;
  awayCode: string | null;
  tournament: string | null;
  season: string | null;
  round: number | null;
  date: number | null;
};
type PrematchTag = {segmentIndex: number; statType: string};
type PrematchKeyMoment = TextBlock & {stats?: PrematchTag[]};
type PrematchScript = {
  hook: TextBlock;
  key_moments: PrematchKeyMoment[];
  controversy: TextBlock | null;
  // Re-purposed by meaning only: for a preview this block IS the prediction.
  result: TextBlock;
  outro: TextBlock;
};
// Ballsy's own call, saved beside the script (not inside it — see
// generate-prematch-script.mjs) and shown on the review page so the on-screen
// call-out card can be checked against what he actually says.
type Prediction = {pick: 'home' | 'away' | 'draw'; team: string | null};
type PrematchScriptResponse = {
  script: PrematchScript;
  prediction: Prediction | null;
  publishMetadata: PublishMetadata | null;
  reviewStatus: ReviewStatus;
  matchInfo: PrematchMatchInfo | null;
  focusPrompt: string | null;
  label: string | null;
  createdAt: string | null;
  runSlug: string;
  hasAudio: boolean;
  hasVideo: boolean;
  videoUrl: string | null;
  youtube: YoutubePublishStatus;
  tiktok: TiktokPublishStatus;
};
type PrematchRun = PrematchLibraryEntry;

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

// A "generate script" call whose focus already has a video: the server checks
// this before spawning anything (so it costs nothing) and the caller asks the
// user whether to replace it or keep both as a new version.
class GenerateConflictError extends Error {
  runSlug: string;
  date: string | undefined;
  hasVideo: boolean;
  reviewStatus: ReviewStatus | null;
  constructor(info: {runSlug: string; date?: string; hasVideo: boolean; reviewStatus: ReviewStatus | null}) {
    super('A video with this focus already exists');
    this.runSlug = info.runSlug;
    this.date = info.date;
    this.hasVideo = info.hasVideo;
    this.reviewStatus = info.reviewStatus;
  }
}

// Which way to resolve a generation that lands on an existing video.
type GenerateOpts = {mode?: 'overwrite' | 'new-version'; runSlug?: string; date?: string};

function generateKey(id: string, focusPrompt: string | null | undefined, opts?: GenerateOpts): string {
  return `${id}:${focusPrompt?.trim() || 'default'}:${opts?.date ?? ''}:${opts?.runSlug ?? ''}:${opts?.mode ?? ''}`;
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
  if (res.status === 409 && data && (data as {exists?: boolean}).exists) {
    throw new GenerateConflictError(data as ConstructorParameters<typeof GenerateConflictError>[0]);
  }
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
function getExistingScript(matchId: string, runSlug: string): Promise<ScriptResponse | null> {
  return fetch(`/api/script/${matchId}/${runSlug}`).then(async (res) => {
    if (!res.ok) return null;
    return res.json();
  });
}
function getMatchInfo(matchId: string): Promise<FullMatchInfo> {
  return apiGet(`/api/match-info/${matchId}`);
}
// Every run (default or focused) that exists for this match, newest first —
// the match overview page's "past videos" list.
function getMatchRunsApi(matchId: string): Promise<MatchRun[]> {
  return apiGet(`/api/runs/${matchId}`);
}

// ---------------------------------------------------------------------------
// Player-video API client — mirrors the match functions above one for one,
// against scripts/server/player.mjs's routes instead of index.mjs's.
// ---------------------------------------------------------------------------

function searchPlayersApi(query: string): Promise<PlayerSearchResult[]> {
  return apiGet(`/api/player/search?q=${encodeURIComponent(query)}`);
}
function getPlayerSeasonsApi(playerId: number): Promise<PlayerSeasonOption[]> {
  return apiGet(`/api/player/seasons/${playerId}`);
}
function getPlayerFormApi(playerId: string, competitions?: CompetitionSelection[]): Promise<PlayerForm> {
  const params =
    competitions && competitions.length > 0
      ? `?competitions=${encodeURIComponent(JSON.stringify(competitions))}`
      : '';
  return apiGet(`/api/player/form/${playerId}${params}`);
}
// Every dated run that exists for this player, newest first — the overview
// page's "past videos" list.
function getPlayerRunsApi(playerId: string): Promise<PlayerRun[]> {
  return apiGet(`/api/player/runs/${playerId}`);
}
function getExistingPlayerScript(playerId: string, date: string, runSlug: string): Promise<PlayerScriptResponse | null> {
  return fetch(`/api/player/script/${playerId}/${date}/${runSlug}`).then(async (res) => {
    if (!res.ok) return null;
    return res.json();
  });
}
// Keyed on the raw focus text (not a slug — slugify() is server-only) plus
// how the call resolves an existing video, so a "new version" click and the
// original conflicted click never share (or block) one another.
const inFlightPlayerScriptGenerations = new Map<string, Promise<{script: PlayerScript; date: string; runSlug: string}>>();
function isGeneratingPlayerScript(playerId: string, focusPrompt?: string | null, opts?: GenerateOpts): boolean {
  return inFlightPlayerScriptGenerations.has(generateKey(playerId, focusPrompt, opts));
}
// A brand-new video is dated today; regenerating an open run passes its own
// `date` + `runSlug` + `mode: 'overwrite'`. Same focus as a video that already
// exists throws GenerateConflictError (checked server-side before anything is
// spent). `competitions` omitted defaults to the player's current club
// competition alone (see getPlayerForm).
function generatePlayerScript(
  playerId: string,
  focusPrompt?: string,
  competitions?: CompetitionSelection[],
  opts?: GenerateOpts,
): Promise<{script: PlayerScript; date: string; runSlug: string}> {
  const key = generateKey(playerId, focusPrompt, opts);
  const existing = inFlightPlayerScriptGenerations.get(key);
  if (existing) return existing;
  const pending = apiPost<{script: PlayerScript; date: string; runSlug: string}>('/api/player/generate-script', {
    playerId,
    focusPrompt: focusPrompt?.trim() || undefined,
    competitions: competitions && competitions.length > 0 ? competitions : undefined,
    ...opts,
  }).finally(() => {
    inFlightPlayerScriptGenerations.delete(key);
  });
  inFlightPlayerScriptGenerations.set(key, pending);
  return pending;
}
function approvePlayerScript(playerId: string, date: string, runSlug: string): Promise<{ok: true}> {
  return apiPost('/api/player/approve-script', {playerId, date, runSlug});
}
function savePlayerScript(playerId: string, date: string, runSlug: string, script: PlayerScript): Promise<{ok: true}> {
  return apiPost(`/api/player/script/${playerId}/${date}/${runSlug}`, {script});
}

type PlayerPipelineRun = {
  log: string;
  status: 'running' | 'done' | 'error';
  onUpdate: ((run: PlayerPipelineRun) => void) | null;
};
// Own Map, keyed by "playerId:date:runSlug" — kept separate from
// activePipelines (match ids) so a numeric collision between a match id and
// a player id can never cross-wire the two, and separate runs for the same
// player never collide with each other either.
const activePlayerPipelines = new Map<string, PlayerPipelineRun>();

function startPlayerPipeline(playerId: string, date: string, runSlug: string): PlayerPipelineRun {
  const key = `${playerId}:${date}:${runSlug}`;
  const existing = activePlayerPipelines.get(key);
  if (existing) return existing;

  const run: PlayerPipelineRun = {log: '', status: 'running', onUpdate: null};
  activePlayerPipelines.set(key, run);

  const source = new EventSource(
    `/api/player/run-pipeline?playerId=${encodeURIComponent(playerId)}&date=${encodeURIComponent(date)}&runSlug=${encodeURIComponent(runSlug)}`,
  );
  const finish = (status: 'done' | 'error'): void => {
    run.status = status;
    source.close();
    activePlayerPipelines.delete(key);
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
  source.onerror = () => {
    if (run.status !== 'running') return;
    run.log += 'Lost connection to the server — reload to see the current state.\n';
    finish('error');
  };
  return run;
}

// ---------------------------------------------------------------------------
// Pre-match preview API client — mirrors the match/player functions above one
// for one, against scripts/server/prematch.mjs's routes.
// ---------------------------------------------------------------------------

function searchTeamsApi(query: string): Promise<TeamSearchResult[]> {
  return apiGet(`/api/prematch/search-team?q=${encodeURIComponent(query)}`);
}
// Two picked teams -> the actual upcoming event id between them. This is the
// whole "pick a match" step for previews; there's no fixture list to browse.
function getNextFixtureApi(teamAId: number, teamBId: number): Promise<NextFixture> {
  return apiGet(`/api/prematch/next-fixture?teamAId=${teamAId}&teamBId=${teamBId}`);
}
function getPrematchInfo(matchId: string): Promise<FullPrematchInfo> {
  return apiGet(`/api/prematch/info/${matchId}`);
}
function getPrematchRunsApi(matchId: string): Promise<PrematchRun[]> {
  return apiGet(`/api/prematch/runs/${matchId}`);
}
function getExistingPrematchScript(matchId: string, runSlug: string): Promise<PrematchScriptResponse | null> {
  return fetch(`/api/prematch/script/${matchId}/${runSlug}`).then(async (res) => {
    if (!res.ok) return null;
    return res.json();
  });
}
const inFlightPrematchScriptGenerations = new Map<string, Promise<{script: PrematchScript; runSlug: string}>>();
function isGeneratingPrematchScript(matchId: string, focusPrompt?: string | null, opts?: GenerateOpts): boolean {
  return inFlightPrematchScriptGenerations.has(generateKey(matchId, focusPrompt, opts));
}
function generatePrematchScript(
  matchId: string,
  focusPrompt?: string,
  opts?: GenerateOpts,
): Promise<{script: PrematchScript; runSlug: string}> {
  const key = generateKey(matchId, focusPrompt, opts);
  const existing = inFlightPrematchScriptGenerations.get(key);
  if (existing) return existing;
  const pending = apiPost<{script: PrematchScript; runSlug: string}>('/api/prematch/generate-script', {
    matchId,
    focusPrompt: focusPrompt?.trim() || undefined,
    ...opts,
  }).finally(() => {
    inFlightPrematchScriptGenerations.delete(key);
  });
  inFlightPrematchScriptGenerations.set(key, pending);
  return pending;
}
function approvePrematchScript(matchId: string, runSlug: string): Promise<{ok: true}> {
  return apiPost('/api/prematch/approve-script', {matchId, runSlug});
}
function savePrematchScript(matchId: string, runSlug: string, script: PrematchScript): Promise<{ok: true}> {
  return apiPost(`/api/prematch/script/${matchId}/${runSlug}`, {script});
}

type PrematchPipelineRun = {
  log: string;
  status: 'running' | 'done' | 'error';
  onUpdate: ((run: PrematchPipelineRun) => void) | null;
};
// Own Map, keyed by "matchId:runSlug" — kept separate from activePipelines
// (recap runs) even though the ids look identical, since a fixture's preview
// and its recap are two different videos that can legitimately be running at
// the same time.
const activePrematchPipelines = new Map<string, PrematchPipelineRun>();

function startPrematchPipeline(matchId: string, runSlug: string): PrematchPipelineRun {
  const key = `${matchId}:${runSlug}`;
  const existing = activePrematchPipelines.get(key);
  if (existing) return existing;

  const run: PrematchPipelineRun = {log: '', status: 'running', onUpdate: null};
  activePrematchPipelines.set(key, run);

  const source = new EventSource(
    `/api/prematch/run-pipeline?matchId=${encodeURIComponent(matchId)}&runSlug=${encodeURIComponent(runSlug)}`,
  );
  const finish = (status: 'done' | 'error'): void => {
    run.status = status;
    source.close();
    activePrematchPipelines.delete(key);
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
  source.onerror = () => {
    if (run.status !== 'running') return;
    run.log += 'Lost connection to the server — reload to see the current state.\n';
    finish('error');
  };
  return run;
}

// Script generations in flight, keyed by "matchId:runSlug" — module-level
// (not per-page state) because this app never unloads the document;
// navigating away just wipes #app and builds a new page, but the server
// keeps running the generation regardless. Keeping the promise here lets
// coming back to the run re-join it instead of offering a "Generate script"
// button that would spend on Anthropic a second time for a script already
// being written. Keying on the run (not just the match) is what lets a
// different focus start a brand new generation instead of colliding with
// one already in flight for that match.
const inFlightScriptGenerations = new Map<string, Promise<{script: Script; runSlug: string}>>();

function isGeneratingScript(matchId: string, focusPrompt?: string | null, opts?: GenerateOpts): boolean {
  return inFlightScriptGenerations.has(generateKey(matchId, focusPrompt, opts));
}

// `focusPrompt` omitted (or blank) targets the match's 'default' run; a
// different focus text starts a NEW video alongside any existing ones. Landing
// on a video that already exists throws GenerateConflictError unless `opts`
// says how to resolve it (`mode: 'overwrite'` / `'new-version'`). The caller
// finds out which run it landed on from the resolved `runSlug`.
function generateScript(
  matchId: string,
  focusPrompt?: string,
  opts?: GenerateOpts,
): Promise<{script: Script; runSlug: string}> {
  const key = generateKey(matchId, focusPrompt, opts);
  const existing = inFlightScriptGenerations.get(key);
  if (existing) return existing;
  const pending = apiPost<{script: Script; runSlug: string}>('/api/generate-script', {
    matchId,
    focusPrompt: focusPrompt?.trim() || undefined,
    ...opts,
  }).finally(() => {
    inFlightScriptGenerations.delete(key);
  });
  inFlightScriptGenerations.set(key, pending);
  return pending;
}
function approveScript(matchId: string, runSlug: string): Promise<{ok: true}> {
  return apiPost('/api/approve-script', {matchId, runSlug});
}
function saveScript(matchId: string, runSlug: string, script: Script): Promise<{ok: true}> {
  return apiPost(`/api/script/${matchId}/${runSlug}`, {script});
}
function launchStudio(): Promise<{ok: true; alreadyRunning: boolean}> {
  return apiPost('/api/studio/launch', {});
}
const STUDIO_URL = 'http://localhost:3000';

// Pipeline runs in flight, same reason as inFlightScriptGenerations above —
// and higher stakes, since the first step is the paid ElevenLabs call.
// Re-attaching to the live run (rather than losing track of it on navigation)
// keeps this to one run per match.
type PipelineRun = {
  log: string;
  status: 'running' | 'done' | 'error';
  // A single slot, not a list: only the page currently on screen should be
  // painting, and the newest attach is by definition that page.
  onUpdate: ((run: PipelineRun) => void) | null;
};

const activePipelines = new Map<string, PipelineRun>();

function startPipeline(matchId: string, runSlug: string): PipelineRun {
  const key = `${matchId}:${runSlug}`;
  const existing = activePipelines.get(key);
  if (existing) return existing;

  const run: PipelineRun = {log: '', status: 'running', onUpdate: null};
  activePipelines.set(key, run);

  const source = new EventSource(
    `/api/run-pipeline?matchId=${encodeURIComponent(matchId)}&runSlug=${encodeURIComponent(runSlug)}`,
  );
  const finish = (status: 'done' | 'error'): void => {
    run.status = status;
    source.close();
    // Dropped once finished: a page mounted after this point learns the state
    // from /api/script/:matchId/:runSlug (which now reports hasAudio) instead.
    activePipelines.delete(key);
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
  setActiveNav(
    path === '/'
      ? '/'
      : path.startsWith('/player')
        ? '/player'
        : path.startsWith('/prematch')
          ? '/prematch'
          : path.startsWith('/history')
            ? '/history'
            : '',
  );
  app.innerHTML = '';

  const matchRun = path.match(/^\/match\/([^/]+)\/([^/]+)$/);
  const matchOverview = path.match(/^\/match\/([^/]+)$/);
  const playerRun = path.match(/^\/player\/(\d+)\/(\d{4}-\d{2}-\d{2})\/([^/]+)$/);
  const playerOverview = path.match(/^\/player\/(\d+)$/);
  const prematchRun = path.match(/^\/prematch\/(\d+)\/([^/]+)$/);
  const prematchOverview = path.match(/^\/prematch\/(\d+)$/);
  if (prematchRun) {
    renderPrematchDetail(prematchRun[1], decodeURIComponent(prematchRun[2]));
  } else if (prematchOverview) {
    renderPrematchOverview(prematchOverview[1]);
  } else if (path === '/prematch') {
    renderPrematchHome();
  } else if (matchRun) {
    renderMatchDetail(decodeURIComponent(matchRun[1]), decodeURIComponent(matchRun[2]));
  } else if (matchOverview) {
    renderMatchOverview(decodeURIComponent(matchOverview[1]));
  } else if (playerRun) {
    renderPlayerDetail(playerRun[1], playerRun[2], decodeURIComponent(playerRun[3]));
  } else if (playerOverview) {
    renderPlayerOverview(playerOverview[1]);
  } else if (path === '/player') {
    renderPlayerHome();
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
// Player home — search a player by name, pick one, land on their page. A
// single search step instead of the match flow's league/season/matchday
// drill-down, since there's no equivalent hierarchy to browse.
// ---------------------------------------------------------------------------

function renderPlayerHome(): void {
  const searchField = h('div', {class: 'field'});
  const searchInput = h('input', {type: 'text', id: 'player-search', placeholder: 'Search a player by name...'});
  searchField.append(h('label', {}, ['Player']), searchInput);
  const results = h('div', {class: 'list mt-sm'});

  app.append(
    h('div', {class: 'page'}, [
      h('h1', {class: 'page-title'}, ['Find a player']),
      searchField,
      results,
    ]),
  );

  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  function showResults(players: PlayerSearchResult[]): void {
    results.innerHTML = '';
    if (players.length === 0) {
      results.append(h('p', {class: 'hint'}, ['No players found.']));
      return;
    }
    for (const player of players) {
      const sub = [player.team, player.position, player.country].filter(Boolean).join(' · ');
      const row = h('a', {href: `/player/${player.id}`, 'data-link': '', class: 'row'}, [
        h('span', {class: 'row-title'}, [player.name]),
        h('span', {class: 'row-sub'}, [sub]),
      ]);
      results.appendChild(row);
    }
  }

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const query = searchInput.value.trim();
    if (!query) {
      results.innerHTML = '';
      return;
    }
    searchTimer = setTimeout(async () => {
      results.innerHTML = '';
      results.append(h('p', {class: 'hint'}, ['Searching...']));
      try {
        showResults(await searchPlayersApi(query));
      } catch (err) {
        results.innerHTML = '';
        results.append(errorBanner((err as Error).message));
      }
    }, 300);
  });

  searchInput.focus();
}

// ---------------------------------------------------------------------------
// Player overview — one player's current form plus every dated video ever
// made for him, with a button to start today's. A player's form genuinely
// changes week to week, so this is a list of runs, not a single workspace
// the way a match page is — each run opens its own page (renderPlayerDetail)
// via /player/:id/:date.
// ---------------------------------------------------------------------------

function renderPlayerOverview(playerId: string): void {
  const pageEpoch = renderEpoch;
  const isStale = (): boolean => pageEpoch !== renderEpoch;

  const backLink = h('a', {href: '#', class: 'back-link'}, ['← Back']);
  backLink.addEventListener('click', (e) => {
    e.preventDefault();
    history.back();
  });

  const title = h('h1', {class: 'page-title'}, ['Player']);
  const subtitle = h('p', {class: 'hint'});
  const formSection = h('div', {class: 'section'});
  const competitionSection = h('div', {class: 'section'});
  const newRunSection = h('div', {class: 'section'});
  const runsSection = h('div', {class: 'section'});

  app.append(
    h('div', {class: 'page'}, [backLink, title, subtitle, runsSection, formSection, competitionSection, newRunSection]),
  );

  // Which competition(s) the form preview AND the actual generation both use
  // — starts as whatever getPlayerForm resolves as the default (learned once
  // the first free preview loads), overridable via the multi-select below.
  let selectedCompetitions: CompetitionSelection[] = [];

  function renderForm(form: PlayerForm): void {
    title.textContent = form.profile.name;
    subtitle.textContent = [form.team.name, form.competition].filter(Boolean).join(' · ');

    formSection.innerHTML = '';
    const card = h('div', {class: 'card match-report'});
    const headline = [
      `${form.goals}g / ${form.assists}a in his last ${form.appearances}`,
      form.consecutiveWithGoalOrAssist > 0 ? `${form.consecutiveWithGoalOrAssist} straight involved` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    card.append(h('h3', {}, ['Current form']), h('p', {}, [headline]));
    if (form.personalAngle) {
      card.append(
        h('p', {class: 'hint'}, [
          form.personalAngle.type === 'favorite'
            ? `Ballsy's own team — ${form.personalAngle.team}.`
            : `A Ballsy rival — ${form.personalAngle.team}.`,
        ]),
      );
    }
    formSection.append(card);
  }

  // Free preview of the form for whatever's currently selected — re-run on
  // every competition-picker change so you see what a generation would
  // actually use before spending anything on it. `competitions` omitted (the
  // very first call) means "use the default"; once that default comes back,
  // it becomes the picker's own starting selection (syncSelectUI below).
  function loadForm(competitions?: CompetitionSelection[]): void {
    formSection.innerHTML = '';
    formSection.append(h('p', {class: 'hint'}, ['Loading player form...']));
    getPlayerFormApi(playerId, competitions)
      .then((form) => {
        if (isStale()) return;
        renderForm(form);
        if (!competitions || competitions.length === 0) {
          selectedCompetitions = form.competitions.map((c) => ({
            tournamentId: c.tournamentId,
            seasonId: c.seasonId,
          }));
          syncSelectUI();
        }
      })
      .catch((err) => {
        if (isStale()) return;
        formSection.innerHTML = '';
        formSection.append(errorBanner(`Could not load player form: ${(err as Error).message}`));
      });
  }

  // Multi-select (ctrl/cmd-click for more than one) so form/streaks can be
  // pooled across several competitions at once (e.g. league + Champions
  // League together) — see getPlayerForm's own multi-competition merge.
  const competitionSelect = h('select', {multiple: 'true', class: 'competition-select'}) as HTMLSelectElement;
  const competitionField = h('div', {class: 'field'}, [
    h('label', {}, ['Competition(s) — ctrl/cmd-click to select more than one']),
    competitionSelect,
  ]);

  function syncSelectUI(): void {
    const selectedKeys = new Set(selectedCompetitions.map((c) => `${c.tournamentId}:${c.seasonId}`));
    for (const opt of Array.from(competitionSelect.options)) {
      opt.selected = selectedKeys.has(opt.value);
    }
  }

  competitionSelect.addEventListener('change', () => {
    const chosen = Array.from(competitionSelect.selectedOptions).map((opt) => {
      const [tournamentId, seasonId] = opt.value.split(':').map(Number);
      return {tournamentId, seasonId};
    });
    if (chosen.length === 0) return; // never fetch with nothing selected
    selectedCompetitions = chosen;
    loadForm(selectedCompetitions);
  });

  newRunSection.append(
    renderNewVideoForm({
      buttonLabel: 'Generate a form-check video for today',
      placeholder: 'Optional: tell Ballsy what to focus on (e.g. a contract renewal, a specific goal)...',
      generate: (focus, opts) => generatePlayerScript(playerId, focus, selectedCompetitions, opts),
      hrefFor: ({date, runSlug}) => `/player/${playerId}/${date}/${runSlug}`,
      isStale,
    }),
  );

  function renderRuns(runs: PlayerRun[]): void {
    runsSection.innerHTML = '';
    runsSection.append(
      h('h3', {}, [`Videos (${runs.length})`]),
      renderRunsList(runs, 'No videos made for this player yet — generate the first one below.'),
    );
  }

  competitionSection.append(h('p', {class: 'hint'}, ['Loading competitions...']));
  getPlayerSeasonsApi(Number(playerId))
    .then((options) => {
      if (isStale()) return;
      competitionSection.innerHTML = '';
      competitionSelect.innerHTML = '';
      for (const opt of options) {
        const latest = opt.seasons[0]; // getPlayerSeasons: each tournament's own seasons, newest first
        if (!latest) continue;
        competitionSelect.append(
          h('option', {value: `${opt.tournamentId}:${latest.id}`}, [`${opt.tournament} (${latest.name})`]),
        );
      }
      // A single-row native <select> hides that it's multi-choosable — show
      // every option (up to a cap) as visible rows instead, so ctrl/cmd-click
      // is discoverable rather than needing to be told about.
      competitionSelect.size = Math.min(6, Math.max(2, competitionSelect.options.length));
      syncSelectUI();
      competitionSection.append(competitionField);
    })
    .catch((err) => {
      if (isStale()) return;
      competitionSection.innerHTML = '';
      competitionSection.append(errorBanner(`Could not load competitions: ${(err as Error).message}`));
    });

  loadForm();

  getPlayerRunsApi(playerId)
    .then((runs) => {
      if (isStale()) return;
      renderRuns(runs);
    })
    .catch((err) => {
      if (isStale()) return;
      runsSection.append(errorBanner((err as Error).message));
    });
}

// ---------------------------------------------------------------------------
// Pipeline stage — the single place that decides "where did this match stop,
// and what happens next". Both the History cards and the match page read it,
// so a card's promise ("Next: render the video") always matches the button you
// actually land on.
// ---------------------------------------------------------------------------

type PipelineState = {
  reviewStatus: ReviewStatus | null;
  hasAudio: boolean;
  hasVideo: boolean;
  youtube: YoutubePublishStatus;
  tiktok: TiktokPublishStatus;
};
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

// The preview equivalents. Deliberately "A vs B" with no score anywhere —
// the fixture hasn't been played, and a "? - ?" would read like missing data
// rather than a match still to come.
function prematchTitle(info: PrematchMatchInfo | null, matchId: string): string {
  if (!info) return `Fixture ${matchId}`;
  return `${info.home} vs ${info.away}`;
}

function prematchSubtitle(info: PrematchMatchInfo | null): string {
  if (!info) return '';
  const date = info.date ? new Date(info.date * 1000).toLocaleDateString('en-GB') : null;
  const round = info.round != null ? `Matchday ${info.round}` : null;
  return ['Preview', info.tournament, round, date].filter(Boolean).join(' · ');
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

  return h('div', {class: 'chips'}, [
    script,
    presence(state.hasAudio, 'Audio'),
    presence(state.hasVideo, 'Video'),
    presence(state.youtube !== null, 'YouTube'),
    presence(state.tiktok !== null, 'TikTok'),
  ]);
}

// ---------------------------------------------------------------------------
// Videos (runs) — the building blocks every page shares. A match, a player or
// a preview can each have any number of videos (a "run": its own script,
// audio and mp4 — different focus, or the same focus kept as a new version),
// so listing them, switching between them, naming them and deleting them is
// the same problem on every page: solved once here.
// ---------------------------------------------------------------------------

type RunRef =
  | {kind: 'match' | 'prematch'; matchId: string; runSlug: string}
  | {kind: 'player'; playerId: string; date: string; runSlug: string};

const KIND_LABEL: Record<LibraryEntry['kind'], string> = {match: 'Match', player: 'Player', prematch: 'Preview'};

function refOf(entry: LibraryEntry): RunRef {
  return entry.kind === 'player'
    ? {kind: 'player', playerId: entry.playerId, date: entry.date, runSlug: entry.runSlug}
    : {kind: entry.kind, matchId: entry.matchId, runSlug: entry.runSlug};
}

// A video's own workspace page.
function runHref(ref: RunRef): string {
  if (ref.kind === 'player') return `/player/${ref.playerId}/${ref.date}/${ref.runSlug}`;
  return `/${ref.kind}/${ref.matchId}/${ref.runSlug}`;
}

// The entity's overview page (all its videos + the "new video" form).
function entityHref(ref: RunRef): string {
  return ref.kind === 'player' ? `/player/${ref.playerId}` : `/${ref.kind}/${ref.matchId}`;
}

function runParams(ref: RunRef): Record<string, string> {
  return ref.kind === 'player'
    ? {kind: 'player', playerId: ref.playerId, date: ref.date, runSlug: ref.runSlug}
    : {kind: ref.kind, matchId: ref.matchId, runSlug: ref.runSlug};
}

// The same ref as a query string — what the publish routes take.
function runQuery(ref: RunRef): string {
  return new URLSearchParams(runParams(ref)).toString();
}

function entityKeyOf(entry: LibraryEntry): string {
  return entry.kind === 'player' ? `player:${entry.playerId}` : `${entry.kind}:${entry.matchId}`;
}

function entityTitleOf(entry: LibraryEntry): string {
  return entry.kind === 'match'
    ? matchTitle(entry.matchInfo, entry.matchId)
    : entry.kind === 'prematch'
      ? prematchTitle(entry.matchInfo, entry.matchId)
      : (entry.playerInfo?.name ?? `Player ${entry.playerId}`);
}

function entitySubtitleOf(entry: LibraryEntry): string {
  return entry.kind === 'match'
    ? matchSubtitle(entry.matchInfo) || `Match ${entry.matchId}`
    : entry.kind === 'prematch'
      ? prematchSubtitle(entry.matchInfo) || `Fixture ${entry.matchId}`
      : [entry.playerInfo?.team, entry.playerInfo?.competition].filter(Boolean).join(' · ') ||
        `Player ${entry.playerId}`;
}

// "raphinha-v2" / "v3" -> "v2" / "v3"; a plain run has no version tag.
function versionOf(runSlug: string): string | null {
  const m = /(?:^|-)(v\d+)$/.exec(runSlug);
  return m ? m[1] : null;
}

// What a video is called: the user's own name for it, else its focus, else a
// plain "No focus". (Versions and dates are shown as separate pills.)
function runName(run: {label: string | null; focusPrompt: string | null; runSlug: string}): string {
  if (run.label) return run.label;
  if (run.focusPrompt) return run.focusPrompt;
  return run.runSlug === DEFAULT_RUN_SLUG || versionOf(run.runSlug) === run.runSlug ? 'No focus' : run.runSlug;
}

function whenLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('en-GB', {day: 'numeric', month: 'short'})}, ${d.toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit'})}`;
}

// A single answer to "where is this video at" — what the History filter and
// the group summaries speak in.
type StatusBucket = 'review' | 'production' | 'ready' | 'published';
const BUCKET_LABEL: Record<StatusBucket, string> = {
  review: 'Needs review',
  production: 'In production',
  ready: 'Ready to publish',
  published: 'Published',
};
function statusBucket(entry: LibraryEntry): StatusBucket {
  if (entry.youtube || entry.tiktok) return 'published';
  const stage = pipelineStage(entry);
  if (stage === 'done') return 'ready';
  if (stage === 'audio' || stage === 'render') return 'production';
  return 'review';
}

function nextStepText(entry: PipelineState): string {
  const stage = pipelineStage(entry);
  return stage === 'done' ? 'Video ready' : `Next: ${STAGE_ACTION[stage].toLowerCase()} →`;
}

// One video as a row: name + version/date pills, chips, next step, and (when a
// video exists) a Watch toggle that plays it right there — no page hop needed
// to see what a run actually produced.
function renderRunRow(entry: LibraryEntry, opts: {current?: boolean; showEntity?: boolean} = {}): HTMLElement {
  const ref = refOf(entry);
  const stage = pipelineStage(entry);
  const version = versionOf(entry.runSlug);
  const top = h('div', {class: 'run-row-top'});
  if (opts.showEntity) top.append(h('span', {class: `kind-badge ${entry.kind}`}, [KIND_LABEL[entry.kind]]));
  top.append(h('span', {class: 'run-row-name'}, [runName(entry)]));
  if (version) top.append(h('span', {class: 'pill'}, [version]));
  if (entry.kind === 'player') top.append(h('span', {class: 'pill'}, [entry.date]));
  top.append(h('span', {class: `badge ${entry.reviewStatus}`}, [reviewLabel(entry.reviewStatus)]));

  const main = h('a', {href: runHref(ref), 'data-link': '', class: 'run-row-main'}, [
    top,
    h('div', {class: 'run-row-meta'}, [
      entry.createdAt ? `Created ${whenLabel(entry.createdAt)}` : `Updated ${whenLabel(entry.updatedAt)}`,
    ]),
    pipelineChips(entry),
    h('div', {class: `match-card-next ${stage}`}, [nextStepText(entry)]),
  ]);

  const row = h('div', {class: `run-row${opts.current ? ' current' : ''}`}, [main]);
  if (entry.hasVideo && entry.videoUrl) {
    const src = `${entry.videoUrl}?t=${encodeURIComponent(entry.updatedAt)}`;
    const holder = h('div', {class: 'run-row-video hidden'});
    const watch = h('button', {type: 'button', class: 'btn ghost run-row-watch'}, ['▶ Watch']);
    watch.addEventListener('click', () => {
      const opening = holder.classList.contains('hidden');
      holder.classList.toggle('hidden', !opening);
      watch.textContent = opening ? '▼ Hide' : '▶ Watch';
      if (opening && !holder.firstChild) {
        holder.append(h('video', {controls: 'true', class: 'video-player', src, preload: 'metadata'}));
      } else if (!opening) {
        holder.querySelector('video')?.pause();
      }
    });
    row.append(watch, holder);
  }
  return row;
}

function sortedNewestFirst(entries: LibraryEntry[]): LibraryEntry[] {
  return [...entries].sort((a, b) =>
    (a.createdAt ?? a.updatedAt) < (b.createdAt ?? b.updatedAt) ? 1 : -1,
  );
}

// Every video of one entity, newest first.
function renderRunsList(entries: LibraryEntry[], emptyText: string): HTMLElement {
  const list = h('div', {class: 'run-list'});
  if (entries.length === 0) {
    list.append(h('p', {class: 'hint'}, [emptyText]));
    return list;
  }
  for (const entry of sortedNewestFirst(entries)) list.append(renderRunRow(entry));
  return list;
}

// The "make another video" form every overview page shares: an optional focus,
// the paid-step warning, and — when that focus already has a video — a plain
// choice between keeping both (a new version) and replacing the old one,
// instead of a silent overwrite of something already reviewed or rendered.
function renderNewVideoForm(cfg: {
  buttonLabel: string;
  placeholder: string;
  // Extra fields (e.g. the player's competition picker) sit above the button.
  generate: (focus: string, opts?: GenerateOpts) => Promise<{runSlug: string; date?: string}>;
  hrefFor: (resolved: {runSlug: string; date?: string}) => string;
  isStale: () => boolean;
}): HTMLElement {
  const container = h('div', {});
  const focusInput = h('input', {type: 'text', placeholder: cfg.placeholder}) as HTMLInputElement;
  const focusField = h('div', {class: 'field'}, [h('label', {}, ['Focus (optional)']), focusInput]);
  const startBtn = h('button', {type: 'button', class: 'btn primary'}, [cfg.buttonLabel]);
  const feedback = h('div', {});

  function reset(): void {
    startBtn.removeAttribute('disabled');
    startBtn.textContent = cfg.buttonLabel;
  }

  async function run(opts?: GenerateOpts): Promise<void> {
    feedback.innerHTML = '';
    startBtn.setAttribute('disabled', 'true');
    startBtn.textContent = 'Generating script...';
    try {
      const resolved = await cfg.generate(focusInput.value, opts);
      if (cfg.isStale()) return;
      navigate(cfg.hrefFor(resolved));
    } catch (err) {
      if (cfg.isStale()) return;
      reset();
      if (err instanceof GenerateConflictError) {
        showConflict(err);
      } else {
        feedback.append(errorBanner((err as Error).message));
      }
    }
  }

  function showConflict(conflict: GenerateConflictError): void {
    const where = [
      conflict.reviewStatus ? reviewLabel(conflict.reviewStatus).toLowerCase() : null,
      conflict.hasVideo ? 'video already rendered' : null,
    ]
      .filter(Boolean)
      .join(', ');
    const keepBoth = h('button', {type: 'button', class: 'btn primary'}, ['Keep both — create a new version']);
    const replace = h('button', {type: 'button', class: 'btn ghost'}, ['Replace the existing script']);
    const cancel = h('button', {type: 'button', class: 'btn ghost'}, ['Cancel']);
    keepBoth.addEventListener('click', () => void run({mode: 'new-version'}));
    replace.addEventListener('click', () => void run({mode: 'overwrite'}));
    cancel.addEventListener('click', () => {
      feedback.innerHTML = '';
    });
    feedback.append(
      h('div', {class: 'conflict-panel'}, [
        h('p', {}, [
          `You already have a video with this focus${where ? ` (${where})` : ''}. Nothing has been generated or spent yet.`,
        ]),
        h('div', {class: 'actions'}, [keepBoth, replace, cancel]),
        h('p', {class: 'hint'}, [
          'A new version is generated as a separate video and keeps the existing one untouched. Replacing overwrites that video\'s script (its audio and render stay until you redo them).',
        ]),
      ]),
    );
  }

  startBtn.addEventListener('click', () => void run());
  container.append(
    h('p', {class: 'hint'}, ['This calls Anthropic to write the script. This has a cost.']),
    focusField,
    startBtn,
    feedback,
  );
  return container;
}

// The strip under a video's title that lists its siblings — every other video
// of the same match / player / preview — so switching between them (or
// starting another) never needs a trip back to the overview.
function renderSiblingStrip(
  ref: RunRef,
  load: () => Promise<LibraryEntry[]>,
  isStale: () => boolean,
): HTMLElement {
  const strip = h('div', {class: 'sibling-strip hidden'});
  load()
    .then((entries) => {
      if (isStale() || entries.length === 0) return;
      strip.innerHTML = '';
      strip.classList.remove('hidden');
      strip.append(h('span', {class: 'sibling-label'}, [`Videos (${entries.length}):`]));
      for (const entry of sortedNewestFirst(entries)) {
        const sibling = refOf(entry);
        const isCurrent =
          runHref(sibling) === runHref(ref);
        const bucket = statusBucket(entry);
        const version = versionOf(entry.runSlug);
        const text = [runName(entry), version, entry.kind === 'player' ? entry.date : null].filter(Boolean).join(' · ');
        strip.append(
          h('a', {href: runHref(sibling), 'data-link': '', class: `sibling ${isCurrent ? 'current' : ''} ${bucket}`}, [
            h('span', {class: `sibling-dot ${bucket}`}),
            h('span', {class: 'sibling-text', title: text}, [text]),
          ]),
        );
      }
      strip.append(h('a', {href: entityHref(ref), 'data-link': '', class: 'sibling add'}, ['+ New video']));
    })
    .catch(() => {
      // Navigation aid only — the page works without it.
    });
  return strip;
}

// Rename box for one video ("Barça win — Raphinha angle", "v2 shorter").
function renderLabelEditor(ref: RunRef, initial: string | null, placeholder: string, isStale: () => boolean): HTMLElement {
  const input = h('input', {
    type: 'text',
    class: 'label-input',
    placeholder: `Name this video (optional) — currently shown as "${placeholder}"`,
    maxlength: '80',
  }) as HTMLInputElement;
  input.value = initial ?? '';
  const status = h('span', {class: 'hint label-status'});
  let saved = input.value;
  async function save(): Promise<void> {
    if (input.value.trim() === saved.trim()) return;
    status.textContent = 'Saving...';
    try {
      const res = await apiPost<{ok: true; label: string | null}>('/api/run/label', {...runParams(ref), label: input.value});
      if (isStale()) return;
      saved = res.label ?? '';
      input.value = saved;
      status.textContent = 'Saved ✓';
    } catch (err) {
      if (isStale()) return;
      status.textContent = (err as Error).message;
    }
  }
  input.addEventListener('change', () => void save());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
  return h('div', {class: 'label-editor'}, [input, status]);
}

// Fills a detail page's "this video" strip once its data is loaded: the
// header pill, the rename box and when it was made.
function mountRunMeta(
  container: HTMLElement,
  runLabel: HTMLElement,
  ref: RunRef,
  data: {label: string | null; focusPrompt: string | null; runSlug: string; createdAt: string | null},
  isStale: () => boolean,
): void {
  const fullName = [runName(data), versionOf(data.runSlug)].filter(Boolean).join(' · ');
  runLabel.textContent = fullName;
  runLabel.setAttribute('title', fullName);
  container.innerHTML = '';
  container.append(
    renderLabelEditor(ref, data.label, runName({...data, label: null}), isStale),
    ...(data.createdAt ? [h('p', {class: 'hint'}, [`Created ${whenLabel(data.createdAt)}`])] : []),
  );
}

// Delete this one video. Two steps in the page itself (no browser dialog): the
// first click lists exactly which files would go (a free dry run), the second
// confirms. Uploaded YouTube/TikTok copies are never touched — the panel says
// so when the video was published.
function renderDeleteVideo(
  ref: RunRef,
  getPublished: () => {youtube: boolean; tiktok: boolean},
  isStale: () => boolean,
): HTMLElement {
  const box = h('div', {class: 'section delete-video'});
  const openBtn = h('button', {type: 'button', class: 'btn ghost danger'}, ['Delete this video']);
  const panel = h('div', {});
  openBtn.addEventListener('click', async () => {
    panel.innerHTML = '';
    openBtn.setAttribute('disabled', 'true');
    try {
      const preview = await apiPost<{files: {what: string; path: string}[]; published: unknown}>('/api/run/delete', {
        ...runParams(ref),
        dryRun: true,
      });
      if (isStale()) return;
      const published = getPublished();
      const confirmBtn = h('button', {type: 'button', class: 'btn danger'}, ['Yes, delete permanently']);
      const cancelBtn = h('button', {type: 'button', class: 'btn ghost'}, ['Cancel']);
      cancelBtn.addEventListener('click', () => {
        panel.innerHTML = '';
        openBtn.removeAttribute('disabled');
      });
      confirmBtn.addEventListener('click', async () => {
        confirmBtn.setAttribute('disabled', 'true');
        confirmBtn.textContent = 'Deleting...';
        try {
          const res = await apiPost<{deleted: number; remaining: number}>('/api/run/delete', runParams(ref));
          if (isStale()) return;
          navigate(res.remaining > 0 ? entityHref(ref) : '/history');
        } catch (err) {
          if (isStale()) return;
          panel.append(errorBanner((err as Error).message));
          confirmBtn.removeAttribute('disabled');
          confirmBtn.textContent = 'Yes, delete permanently';
        }
      });
      panel.append(
        h('div', {class: 'conflict-panel'}, [
          h('p', {}, [`This permanently removes ${preview.files.length} file${preview.files.length === 1 ? '' : 's'} of this video only:`]),
          h(
            'ul',
            {class: 'delete-files'},
            preview.files.map((f) => h('li', {}, [`${f.path} (${f.what})`])),
          ),
          ...(published.youtube || published.tiktok
            ? [
                h('p', {class: 'hint'}, [
                  `It was already uploaded to ${[published.youtube ? 'YouTube' : null, published.tiktok ? 'TikTok' : null].filter(Boolean).join(' and ')} — that copy stays online; remove it there yourself.`,
                ]),
              ]
            : []),
          h('p', {class: 'hint'}, ['The audio was paid for (ElevenLabs): deleting it means paying again to redo this video.']),
          h('div', {class: 'actions'}, [confirmBtn, cancelBtn]),
        ]),
      );
    } catch (err) {
      if (isStale()) return;
      panel.append(errorBanner((err as Error).message));
      openBtn.removeAttribute('disabled');
    }
  });
  box.append(openBtn, panel);
  return box;
}

// ---------------------------------------------------------------------------
// History — every video ever generated, of every kind. Tabs pick the kind
// (All / Matches / Players / Previews); videos are grouped under the match,
// player or preview they belong to, so "what do I have for this match?" is one
// glance. Filters live in the URL (?kind=&q=&status=&sort=) so a view survives
// a reload and the Back button returns to it exactly as it was.
// ---------------------------------------------------------------------------

type HistoryKind = 'all' | LibraryEntry['kind'];
type HistorySort = 'recent' | 'oldest' | 'alpha';

const HISTORY_KIND_TABS: {value: HistoryKind; label: string; plural: string}[] = [
  {value: 'all', label: 'All', plural: 'videos'},
  {value: 'match', label: 'Matches', plural: 'matches'},
  {value: 'player', label: 'Players', plural: 'players'},
  {value: 'prematch', label: 'Previews', plural: 'previews'},
];
const GROUP_COLLAPSED_VIDEOS = 3;

type EntityGroup = {
  key: string;
  entries: LibraryEntry[]; // newest first
  latest: string; // newest activity among `entries`
};

function renderHistory(): void {
  const params = new URLSearchParams(location.search);
  const initialKind = params.get('kind') as HistoryKind | null;
  const initialStatus = params.get('status') as StatusBucket | null;
  const initialSort = params.get('sort') as HistorySort | null;
  let kind: HistoryKind = HISTORY_KIND_TABS.some((t) => t.value === initialKind) ? initialKind! : 'all';
  let status: StatusBucket | 'all' = initialStatus && initialStatus in BUCKET_LABEL ? initialStatus : 'all';
  let sort: HistorySort = initialSort === 'oldest' || initialSort === 'alpha' ? initialSort : 'recent';

  const tabs = h('div', {class: 'tabs', role: 'tablist'});
  const searchInput = h('input', {type: 'text', placeholder: 'Team, player, league, focus or id...'}) as HTMLInputElement;
  searchInput.value = params.get('q') ?? '';
  const statusSelect = h('select', {}, [
    h('option', {value: 'all'}, ['Any status']),
    ...(Object.keys(BUCKET_LABEL) as StatusBucket[]).map((b) => h('option', {value: b}, [BUCKET_LABEL[b]])),
  ]) as HTMLSelectElement;
  statusSelect.value = status;
  const sortSelect = h('select', {}, [
    h('option', {value: 'recent'}, ['Recent activity']),
    h('option', {value: 'oldest'}, ['Oldest first']),
    h('option', {value: 'alpha'}, ['A – Z']),
  ]) as HTMLSelectElement;
  sortSelect.value = sort;

  const clearBtn = h('button', {type: 'button', class: 'btn ghost hidden'}, ['Clear filters']);
  const toolbar = h('div', {class: 'toolbar'}, [
    h('div', {class: 'field toolbar-search'}, [h('label', {}, ['Search']), searchInput]),
    h('div', {class: 'field toolbar-filter'}, [h('label', {}, ['Status']), statusSelect]),
    h('div', {class: 'field toolbar-filter'}, [h('label', {}, ['Sort']), sortSelect]),
  ]);
  const resultCount = h('p', {class: 'hint result-count'});
  const summaryBar = h('div', {class: 'summary-bar'}, [resultCount, clearBtn]);
  const groupsEl = h('div', {class: 'entity-groups'});

  app.append(h('div', {class: 'page'}, [h('h1', {class: 'page-title'}, ['History']), tabs, toolbar, summaryBar, groupsEl]));

  let entries: LibraryEntry[] = [];
  const expanded = new Set<string>();

  function filtersActive(): boolean {
    return searchInput.value.trim() !== '' || status !== 'all';
  }

  // Keep the address bar in step with the view (replaceState: filtering is
  // not navigation, so Back still leaves History instead of undoing a keystroke).
  function syncUrl(): void {
    const next = new URLSearchParams();
    if (kind !== 'all') next.set('kind', kind);
    if (searchInput.value.trim()) next.set('q', searchInput.value.trim());
    if (status !== 'all') next.set('status', status);
    if (sort !== 'recent') next.set('sort', sort);
    const qs = next.toString();
    history.replaceState(history.state, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
  }

  function searchHaystack(entry: LibraryEntry): string {
    const base =
      entry.kind === 'match' || entry.kind === 'prematch'
        ? [entry.matchId, entry.matchInfo?.home, entry.matchInfo?.away, entry.matchInfo?.tournament, entry.matchInfo?.season]
        : [entry.playerId, entry.playerInfo?.name, entry.playerInfo?.team, entry.playerInfo?.competition];
    return [...base, entry.focusPrompt, entry.label].filter(Boolean).join(' ').toLowerCase();
  }

  function buildGroups(kindFilter: HistoryKind): EntityGroup[] {
    const query = searchInput.value.trim().toLowerCase();
    const byKey = new Map<string, LibraryEntry[]>();
    for (const e of entries) {
      if (kindFilter !== 'all' && e.kind !== kindFilter) continue;
      if (status !== 'all' && statusBucket(e) !== status) continue;
      const list = byKey.get(entityKeyOf(e)) ?? [];
      list.push(e);
      byKey.set(entityKeyOf(e), list);
    }
    const groups: EntityGroup[] = [];
    for (const [key, list] of byKey) {
      // Search matches the entity (teams, player, league, id) OR any of its
      // videos' own focus/name — so typing a focus finds the match it's on.
      if (query && !list.some((e) => searchHaystack(e).includes(query))) continue;
      const sorted = sortedNewestFirst(list);
      groups.push({key, entries: sorted, latest: list.reduce((m, e) => (e.updatedAt > m ? e.updatedAt : m), '')});
    }
    groups.sort((a, b) => {
      if (sort === 'alpha') return entityTitleOf(a.entries[0]).localeCompare(entityTitleOf(b.entries[0]));
      return sort === 'oldest' ? (a.latest < b.latest ? -1 : 1) : a.latest < b.latest ? 1 : -1;
    });
    return groups;
  }

  function renderTabs(): void {
    tabs.innerHTML = '';
    for (const tab of HISTORY_KIND_TABS) {
      const count = buildGroups(tab.value).length;
      const btn = h('button', {type: 'button', class: `tab${tab.value === kind ? ' active' : ''}`, role: 'tab'}, [
        tab.label,
        h('span', {class: 'tab-count'}, [String(count)]),
      ]);
      btn.addEventListener('click', () => {
        kind = tab.value;
        syncUrl();
        renderAll();
      });
      tabs.append(btn);
    }
  }

  function groupCard(group: EntityGroup): HTMLElement {
    const first = group.entries[0];
    const ref = refOf(first);
    const published = group.entries.filter((e) => e.youtube || e.tiktok).length;
    const isOpen = expanded.has(group.key);
    const shown = isOpen ? group.entries : group.entries.slice(0, GROUP_COLLAPSED_VIDEOS);

    const stats = [
      `${group.entries.length} video${group.entries.length === 1 ? '' : 's'}`,
      published > 0 ? `${published} published` : null,
      `last activity ${new Date(group.latest).toLocaleDateString('en-GB', {day: 'numeric', month: 'short'})}`,
    ]
      .filter(Boolean)
      .join(' · ');

    const head = h('div', {class: 'entity-head'}, [
      h('a', {href: entityHref(ref), 'data-link': '', class: 'entity-title'}, [
        h('span', {class: `kind-badge ${first.kind}`}, [KIND_LABEL[first.kind]]),
        h('span', {class: 'entity-name'}, [entityTitleOf(first)]),
      ]),
      h('div', {class: 'entity-sub'}, [entitySubtitleOf(first)]),
      h('div', {class: 'entity-stats'}, [stats]),
    ]);

    const list = h('div', {class: 'run-list'});
    for (const e of shown) list.append(renderRunRow(e));
    const card = h('div', {class: 'entity-group'}, [head, list]);

    if (group.entries.length > GROUP_COLLAPSED_VIDEOS) {
      const more = h('button', {type: 'button', class: 'btn ghost show-more'}, [
        isOpen ? 'Show fewer' : `Show all ${group.entries.length} videos`,
      ]);
      more.addEventListener('click', () => {
        if (isOpen) expanded.delete(group.key);
        else expanded.add(group.key);
        renderList();
      });
      card.append(more);
    }
    card.append(
      h('a', {href: entityHref(ref), 'data-link': '', class: 'entity-new'}, ['+ New video for this ' + KIND_LABEL[first.kind].toLowerCase()]),
    );
    return card;
  }

  function renderList(): void {
    const groups = buildGroups(kind);
    const noun = HISTORY_KIND_TABS.find((t) => t.value === kind)!;
    const videoTotal = groups.reduce((n, g) => n + g.entries.length, 0);
    clearBtn.classList.toggle('hidden', !filtersActive());
    resultCount.textContent =
      entries.length === 0
        ? ''
        : `${groups.length} ${kind === 'all' ? (groups.length === 1 ? 'item' : 'items') : groups.length === 1 ? noun.plural.replace(/(es|s)$/, '') : noun.plural} · ${videoTotal} video${videoTotal === 1 ? '' : 's'}`;

    groupsEl.innerHTML = '';
    if (entries.length === 0) {
      groupsEl.append(
        h('p', {class: 'hint'}, ['No videos generated yet — start one from "New match", "New player" or "New preview".']),
      );
      return;
    }
    if (groups.length === 0) {
      groupsEl.append(h('p', {class: 'hint'}, [`Nothing here matches these filters${kind === 'all' ? '' : ` in ${noun.label}`}.`]));
      return;
    }
    for (const group of groups) groupsEl.append(groupCard(group));
  }

  function renderAll(): void {
    renderTabs();
    renderList();
  }

  searchInput.addEventListener('input', () => {
    syncUrl();
    renderAll();
  });
  statusSelect.addEventListener('change', () => {
    status = statusSelect.value as StatusBucket | 'all';
    syncUrl();
    renderAll();
  });
  sortSelect.addEventListener('change', () => {
    sort = sortSelect.value as HistorySort;
    syncUrl();
    renderAll();
  });
  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    status = 'all';
    statusSelect.value = 'all';
    syncUrl();
    renderAll();
  });

  const pageEpoch = renderEpoch;
  resultCount.textContent = 'Loading...';
  getLibrary()
    .then((data) => {
      if (pageEpoch !== renderEpoch) return;
      entries = data;
      renderAll();
    })
    .catch((err) => {
      if (pageEpoch !== renderEpoch) return;
      resultCount.textContent = '';
      groupsEl.innerHTML = '';
      groupsEl.append(errorBanner((err as Error).message));
    });
}

// What actually happened in the match — score, form, event timeline, match
// stats — so you can judge whether it's worth a script before spending on
// one. Pulled from the same SofaScore data generate-script.mjs uses, so
// there's nothing new to fetch, just somewhere to show it first. Shared
// between the match overview (shown once, before any run exists) and the
// match detail page (kept there too, for context while reviewing a run).
function renderMatchReportCard(container: HTMLElement, info: FullMatchInfo): void {
  container.innerHTML = '';
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

  container.append(card);
}

// Fetches + renders the report above, with loading/error placeholders in
// `container`. `onLoaded` lets a caller do something extra with the raw info
// once it's in (e.g. renderMatchDetail sets the page title/subtitle from it).
function loadMatchReport(
  container: HTMLElement,
  matchId: string,
  isStale: () => boolean,
  onLoaded?: (info: FullMatchInfo) => void,
): void {
  container.innerHTML = '';
  container.append(h('p', {class: 'hint'}, ['Loading match report...']));
  getMatchInfo(matchId)
    .then((info) => {
      if (isStale()) return;
      renderMatchReportCard(container, info);
      onLoaded?.(info);
    })
    .catch((err) => {
      if (isStale()) return;
      container.innerHTML = '';
      container.append(errorBanner(`Could not load match report: ${(err as Error).message}`));
    });
}

// ---------------------------------------------------------------------------
// Match overview — one match's own past runs (default + any focused takes),
// plus starting a new one with an optional focus prompt. Mirrors
// renderPlayerOverview's shape; reached by picking a match from Home or a
// card from History, with each run's own page one level deeper.
// ---------------------------------------------------------------------------

function renderMatchOverview(matchId: string): void {
  const pageEpoch = renderEpoch;
  const isStale = (): boolean => pageEpoch !== renderEpoch;

  const backLink = h('a', {href: '#', class: 'back-link'}, ['← Back']);
  backLink.addEventListener('click', (e) => {
    e.preventDefault();
    history.back();
  });

  const title = h('h1', {class: 'page-title'}, [`Match ${matchId}`]);
  const matchIdLabel = h('span', {class: 'match-id-label'}, [`ID ${matchId}`]);
  const subtitle = h('p', {class: 'hint'});
  const header = h('div', {class: 'workspace-header'}, [title, matchIdLabel]);
  const matchInfoSection = h('div', {class: 'section'});
  const newRunSection = h('div', {class: 'section'});
  const runsSection = h('div', {class: 'section'});

  app.append(
    h('div', {class: 'page'}, [backLink, header, subtitle, runsSection, newRunSection, matchInfoSection]),
  );

  loadMatchReport(matchInfoSection, matchId, isStale, (info) => {
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
  });

  newRunSection.append(
    renderNewVideoForm({
      buttonLabel: 'Generate a script',
      placeholder: "Optional: tell Ballsy what to focus on (e.g. a player's renewal, a specific goal)...",
      generate: (focus, opts) => generateScript(matchId, focus, opts),
      hrefFor: ({runSlug}) => `/match/${matchId}/${runSlug}`,
      isStale,
    }),
  );

  function renderRuns(runs: MatchRun[]): void {
    runsSection.innerHTML = '';
    runsSection.append(
      h('h3', {}, [`Videos (${runs.length})`]),
      renderRunsList(runs, 'No videos made for this match yet — generate the first one below.'),
    );
  }

  runsSection.append(h('p', {class: 'hint'}, ['Loading videos...']));
  getMatchRunsApi(matchId)
    .then((runs) => {
      if (isStale()) return;
      renderRuns(runs);
    })
    .catch((err) => {
      if (isStale()) return;
      runsSection.innerHTML = '';
      runsSection.append(errorBanner((err as Error).message));
    });
}

// ---------------------------------------------------------------------------
// Match detail — view/edit/approve one RUN's script, run the rest of the
// pipeline, then render the final video. One page per (matchId, runSlug),
// reached from the match overview. Starting a brand new run (with or
// without a focus) happens on the overview page, not here — arriving at a
// run URL that has no script yet is an error state (a stale link), mirroring
// renderPlayerDetail's own reasoning.
// ---------------------------------------------------------------------------

function renderMatchDetail(matchId: string, runSlug: string): void {
  // Everything below runs against nodes that only exist while this page is on
  // screen; once the user navigates, they're detached and writing to them is a
  // silent no-op. Every async continuation checks this first.
  const pageEpoch = renderEpoch;
  const isStale = (): boolean => pageEpoch !== renderEpoch;

  const state: PipelineState = {
    reviewStatus: null,
    hasAudio: false,
    hasVideo: false,
    youtube: null,
    tiktok: null,
  };
  // The script currently on screen, mutated in place as the user edits it —
  // Save/Approve both send this exact object back to the server.
  let currentScript: Script | null = null;
  let scriptDirty = false;
  // Title/description/hashtags generated alongside the script — read by both
  // publish blocks, never edited here (regenerate the script to change it).
  let currentPublishMetadata: PublishMetadata | null = null;
  // This run's own focus text (or null for the default run) — read once from
  // the loaded script and reused for "Regenerate script" so regenerating can
  // never silently redirect to a DIFFERENT run than the one this page is
  // showing (see run-paths.mjs's runSlugFor: a different focus text is a
  // different run). Changing the focus is done from the overview page.
  let runFocusPrompt: string | null = null;

  // history.back() (not a static href to the overview page) so this returns
  // wherever the user actually came from — History, search results, or the
  // overview — instead of always forcing a stop at the overview page first.
  const backLink = h('a', {href: '#', class: 'back-link'}, ['← Back']);
  backLink.addEventListener('click', (e) => {
    e.preventDefault();
    history.back();
  });

  const title = h('h1', {class: 'page-title'}, [`Match ${matchId}`]);
  const matchIdLabel = h('span', {class: 'match-id-label'}, [`ID ${matchId}`]);
  const runLabel = h('span', {class: 'match-id-label'}, [runName({label: null, focusPrompt: null, runSlug})]);
  const subtitle = h('p', {class: 'hint'});
  const header = h('div', {class: 'workspace-header'}, [title, matchIdLabel, runLabel]);
  const statusStrip = h('div', {class: 'status-strip hidden'});
  const ref: RunRef = {kind: 'match', matchId, runSlug};
  // How every "regenerate this video" call resolves: replace THIS run in place
  // (its own slug), never re-derive the slug from the focus text.
  const overwriteOpts: GenerateOpts = {mode: 'overwrite', runSlug};
  const siblings = renderSiblingStrip(ref, () => getMatchRunsApi(matchId), isStale);
  const runMeta = h('div', {class: 'run-meta'});
  const deleteSection = renderDeleteVideo(
    ref,
    () => ({youtube: state.youtube !== null, tiktok: state.tiktok !== null}),
    isStale,
  );

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
  const videoSection = h('div', {class: 'section hidden'});
  // Filled by renderYoutubePublishBlock()/renderTiktokPublishBlock() once a
  // video exists — each platform's own module owns everything inside it.
  const publishSection = h('div', {class: 'section hidden'});

  app.append(
    h('div', {class: 'page'}, [
      backLink,
      header,
      subtitle,
      siblings,
      runMeta,
      statusStrip,
      videoSection,
      publishSection,
      matchInfoSection,
      generateSection,
      scriptView,
      saveBar,
      actions,
      costHint,
      pipelineSection,
      renderSection,
      deleteSection,
    ]),
  );

  function loadMatchInfo(): void {
    loadMatchReport(matchInfoSection, matchId, isStale, (info) => {
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
    });
  }

  // The rendered file, playable and downloadable straight from the page.
  // videoUrl comes straight from the server (index.mjs builds the actual
  // nested out/matches/<tournament>/<season>/<round>/ path) — never
  // recomputed here. Cache-busted with the current time so re-rendering the
  // same match shows the new file instead of the browser's cached copy.
  function showVideo(videoUrl: string): void {
    videoSection.innerHTML = '';
    videoSection.classList.remove('hidden');
    const src = `${videoUrl}?t=${Date.now()}`;
    const video = h('video', {controls: 'true', class: 'video-player', src});
    const filename = runSlug === DEFAULT_RUN_SLUG ? `${matchId}.mp4` : `${matchId}-${runSlug}.mp4`;
    const downloadLink = h('a', {href: src, download: filename, class: 'btn ghost mt-sm'}, [
      'Download video',
    ]);
    videoSection.append(h('div', {class: 'card'}, [video, downloadLink]));
  }

  // Each block manages its own connect/publish/published states entirely —
  // this function just decides WHEN to (re)draw them: once a video exists,
  // and again whenever a publish completes so the "published" state shows.
  function showPublishSection(): void {
    publishSection.innerHTML = '';
    publishSection.classList.remove('hidden');
    publishSection.append(
      renderYoutubePublishBlock(runQuery(ref), state.youtube, currentPublishMetadata, (published) => {
        state.youtube = published;
        updateStatusStrip();
      }),
      renderTiktokPublishBlock(runQuery(ref), state.tiktok, currentPublishMetadata, (published) => {
        state.tiktok = published;
        updateStatusStrip();
      }),
    );
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
      await saveScript(matchId, runSlug, currentScript);
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
    const pipelineRunning = activePipelines.has(`${matchId}:${runSlug}`);
    const generating = isGeneratingScript(matchId, runFocusPrompt, overwriteOpts);

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
          await approveScript(matchId, runSlug);
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
    attachPipeline(startPipeline(matchId, runSlug));
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

    const source = new EventSource(
      `/api/render?matchId=${encodeURIComponent(matchId)}&runSlug=${encodeURIComponent(runSlug)}`,
    );
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
      const msg = JSON.parse(e.data) as {
        type: string;
        line?: string;
        path?: string;
        videoUrl?: string;
        message?: string;
      };
      if (msg.type === 'log') {
        log.textContent += msg.line;
        log.scrollTop = log.scrollHeight;
      } else if (msg.type === 'done') {
        state.hasVideo = true;
        updateStatusStrip();
        renderActions();
        if (msg.videoUrl) showVideo(msg.videoUrl);
        showPublishSection();
        renderSection.append(h('p', {class: 'hint mt-md'}, [`Saved to ${msg.path}`]));
        source.close();
      } else if (msg.type === 'error') {
        log.textContent += '\nError: ' + msg.message + '\n';
        source.close();
      }
    };
  }

  // Starts a regeneration, or re-attaches to the one already running for this
  // run (see inFlightScriptGenerations) — the caller can't tell the
  // difference, and neither can the user, which is the point. Only ever
  // called for a run that already exists (see renderActions' "Regenerate
  // script" button) — a brand new run is always started from the overview
  // page, so runFocusPrompt is guaranteed set by the time this can run.
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
    const pending = generateScript(matchId, runFocusPrompt ?? undefined, overwriteOpts);
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
      const data = await getExistingScript(matchId, runSlug);
      if (isStale() || !data) return;
      title.textContent = matchTitle(data.matchInfo, matchId);
      subtitle.textContent = matchSubtitle(data.matchInfo);
    } catch {
      // Cosmetic only — the page already has the script it needs.
    }
  }

  loadMatchInfo();

  // Try to load this run's already-generated script for free. Arriving here
  // with none (a bookmarked or hand-typed URL for a run that never got a
  // script) is an error state, not an offer to generate — generating always
  // happens from the overview page, which would silently create a run this
  // page's URL doesn't name.
  getExistingScript(matchId, runSlug)
    .then((data) => {
      if (isStale()) return;
      if (data) {
        state.reviewStatus = data.reviewStatus;
        state.hasAudio = data.hasAudio;
        state.hasVideo = data.hasVideo;
        state.youtube = data.youtube;
        state.tiktok = data.tiktok;
        currentPublishMetadata = data.publishMetadata;
        runFocusPrompt = data.focusPrompt;
        mountRunMeta(runMeta, runLabel, ref, data, isStale);
        title.textContent = matchTitle(data.matchInfo, matchId);
        subtitle.textContent = matchSubtitle(data.matchInfo);
        renderScriptBlocks(data.script);
        scriptView.classList.remove('hidden');
        updateStatusStrip();
        renderActions();
        if (data.hasVideo && data.videoUrl) {
          showVideo(data.videoUrl);
          showPublishSection();
        }
      }

      // A run started before the user navigated away is still going on the
      // server. Re-attach to it rather than showing a button that would start
      // a second, paid run of the same thing.
      if (isGeneratingScript(matchId, data?.focusPrompt, overwriteOpts)) {
        void runGenerate();
        return;
      }
      const pipelineKey = `${matchId}:${runSlug}`;
      if (activePipelines.has(pipelineKey)) {
        attachPipeline(activePipelines.get(pipelineKey)!);
        return;
      }

      if (!data) {
        generateSection.append(
          errorBanner(`No script found for this run.`),
          h('a', {href: `/match/${matchId}`, 'data-link': '', class: 'btn ghost mt-sm'}, [
            '← Back to match overview',
          ]),
        );
      }
    })
    .catch((err) => {
      if (isStale()) return;
      generateSection.append(errorBanner((err as Error).message));
    });
}

// ---------------------------------------------------------------------------
// Player detail — one dated run's workspace (review/approve/run-pipeline/
// render), reached from the overview page (renderPlayerOverview) via
// /player/:id/:date. Mirrors renderMatchDetail step for step from "review
// the script" onward; the player-form preview and "start a new run" step
// live on the overview page instead, since those are about the PLAYER, not
// this one dated video. Publishing works exactly like a match's: the same
// YouTube/TikTok blocks, driven by the run's ref (see runQuery).
// ---------------------------------------------------------------------------

function renderPlayerDetail(playerId: string, date: string, runSlug: string): void {
  const pageEpoch = renderEpoch;
  const isStale = (): boolean => pageEpoch !== renderEpoch;
  // Regenerating only makes sense for today's own still-unapproved draft — an
  // older run is a historical record of that day's form, not a draft to redo
  // (see player.mjs's /generate-script comment). Editing lines in place is
  // still fine on any date.
  const isToday = date === new Date().toISOString().slice(0, 10);

  const state: PipelineState = {
    reviewStatus: null,
    hasAudio: false,
    hasVideo: false,
    youtube: null,
    tiktok: null,
  };
  let currentScript: PlayerScript | null = null;
  let scriptDirty = false;
  // This run's own focus text (or null for the default run) — read once from
  // the loaded script and reused for "Regenerate script" so regenerating can
  // never silently redirect to a DIFFERENT run than the one this page is
  // showing. Changing the focus is done from the overview page (a new run).
  let runFocusPrompt: string | null = null;

  // history.back() (not a static href to the overview page) so this returns
  // wherever the user actually came from — History, search results, or the
  // overview — instead of always forcing a stop at the overview page first.
  const backLink = h('a', {href: '#', class: 'back-link'}, ['← Back']);
  backLink.addEventListener('click', (e) => {
    e.preventDefault();
    history.back();
  });

  const title = h('h1', {class: 'page-title'}, [`Player ${playerId}`]);
  const dateLabel = h('span', {class: 'match-id-label'}, [date]);
  const runLabel = h('span', {class: 'match-id-label'}, [runName({label: null, focusPrompt: null, runSlug})]);
  const subtitle = h('p', {class: 'hint'});
  const header = h('div', {class: 'workspace-header'}, [title, dateLabel, runLabel]);
  const statusStrip = h('div', {class: 'status-strip hidden'});
  const ref: RunRef = {kind: 'player', playerId, date, runSlug};
  // Regenerating replaces THIS run in place (its own date + slug), never a
  // slug re-derived from the focus text.
  const overwriteOpts: GenerateOpts = {mode: 'overwrite', runSlug, date};
  const siblings = renderSiblingStrip(ref, () => getPlayerRunsApi(playerId), isStale);
  const runMeta = h('div', {class: 'run-meta'});
  const deleteSection = renderDeleteVideo(
    ref,
    () => ({youtube: state.youtube !== null, tiktok: state.tiktok !== null}),
    isStale,
  );
  // Title/description/hashtags generated with the script — read by the publish blocks.
  let currentPublishMetadata: PublishMetadata | null = null;
  // The competitions this run was built from, reused if its script is regenerated.
  let runCompetitions: CompetitionSelection[] | undefined;
  const publishSection = h('div', {class: 'section hidden'});

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
  const videoSection = h('div', {class: 'section hidden'});

  app.append(
    h('div', {class: 'page'}, [
      backLink,
      header,
      subtitle,
      siblings,
      runMeta,
      statusStrip,
      videoSection,
      publishSection,
      generateSection,
      scriptView,
      saveBar,
      actions,
      costHint,
      pipelineSection,
      renderSection,
      deleteSection,
    ]),
  );

  // videoUrl comes straight from the server (index.mjs/player.mjs build the
  // actual on-disk path) — never recomputed here, so this page can never
  // drift from where the file really is.
  function showVideo(videoUrl: string): void {
    videoSection.innerHTML = '';
    videoSection.classList.remove('hidden');
    const src = `${videoUrl}?t=${Date.now()}`;
    const video = h('video', {controls: 'true', class: 'video-player', src});
    const filename =
      runSlug === DEFAULT_RUN_SLUG ? `player-${playerId}-${date}.mp4` : `player-${playerId}-${date}-${runSlug}.mp4`;
    const downloadLink = h('a', {href: src, download: filename, class: 'btn ghost mt-sm'}, [
      'Download video',
    ]);
    videoSection.append(h('div', {class: 'card'}, [video, downloadLink]));
  }

  // Once a video exists, both publish blocks (each owns its own connect /
  // publish / published states) — redrawn when a publish completes so the
  // status chips catch up.
  function showPublishSection(): void {
    publishSection.innerHTML = '';
    publishSection.classList.remove('hidden');
    publishSection.append(
      renderYoutubePublishBlock(runQuery(ref), state.youtube, currentPublishMetadata, (published) => {
        state.youtube = published;
        updateStatusStrip();
      }),
      renderTiktokPublishBlock(runQuery(ref), state.tiktok, currentPublishMetadata, (published) => {
        state.tiktok = published;
        updateStatusStrip();
      }),
    );
  }

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

  // Same "edit existing lines only" contract as renderScriptBlocks — a
  // PlayerMoment's TaggedStat.segmentIndex points at a segment by position,
  // same as a match's TaggedEvent does.
  function renderPlayerScriptBlocks(script: PlayerScript): void {
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
      const stats = (m.stats ?? []).map((s) => s.statType).join(', ');
      addBlock(`Moment ${i + 1} (${stats || 'no graphic'})`, m);
    });
    if (script.controversy) addBlock('Take', script.controversy);
    addBlock('Result', script.result);
    addBlock('Outro', script.outro);
  }

  let saveErrorEl: HTMLElement | null = null;

  async function saveEdits(): Promise<boolean> {
    if (!currentScript) return false;
    saveBtn.setAttribute('disabled', 'true');
    saveErrorEl?.remove();
    try {
      await savePlayerScript(playerId, date, runSlug, currentScript);
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

  function renderActions(): void {
    actions.innerHTML = '';
    actions.classList.remove('hidden');
    costHint.classList.remove('hidden');
    const stage = pipelineStage(state);
    const pipelineRunning = activePlayerPipelines.has(`${playerId}:${date}:${runSlug}`);
    // A regeneration always targets TODAY (see player.mjs) — only relevant
    // (and only ever true) when this page IS today's run.
    const generating = isToday && isGeneratingPlayerScript(playerId, runFocusPrompt, overwriteOpts);

    if (stage === 'review' || stage === 'rejected') {
      const cls = stage === 'rejected' ? 'btn ghost' : 'btn primary';
      const approveBtn = h('button', {type: 'button', class: cls}, ['Approve']);
      if (generating) approveBtn.setAttribute('disabled', 'true');
      approveBtn.addEventListener('click', async () => {
        approveBtn.setAttribute('disabled', 'true');
        try {
          if (scriptDirty && !(await saveEdits())) {
            approveBtn.removeAttribute('disabled');
            return;
          }
          await approvePlayerScript(playerId, date, runSlug);
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

      const previewBtn = h('button', {type: 'button', class: 'btn ghost'}, ['Preview in Remotion Studio']);
      previewBtn.addEventListener('click', async () => {
        previewBtn.setAttribute('disabled', 'true');
        previewBtn.textContent = 'Starting Remotion Studio...';
        try {
          await launchStudio();
          window.open(`${STUDIO_URL}/PlayerBallsy`, '_blank');
        } catch (err) {
          actions.append(errorBanner((err as Error).message));
        } finally {
          previewBtn.removeAttribute('disabled');
          previewBtn.textContent = 'Preview in Remotion Studio';
        }
      });
      actions.appendChild(previewBtn);
    }

    // Regenerating always targets TODAY (see player.mjs) — offering it on a
    // past run's page would silently create a DIFFERENT (today's) run while
    // looking like it redid this one, so it's only ever shown here.
    if (isToday) {
      const regenerateBtn = h(
        'button',
        {type: 'button', class: stage === 'rejected' ? 'btn primary' : 'btn ghost'},
        [generating ? 'Generating script...' : 'Regenerate script'],
      );
      if (generating) regenerateBtn.setAttribute('disabled', 'true');
      else regenerateBtn.addEventListener('click', () => void runGenerate());
      if (stage === 'rejected') actions.prepend(regenerateBtn);
      else actions.appendChild(regenerateBtn);
    }

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
      h('p', {class: 'hint'}, ['Audio and data ready. PLAYER_FIXTURE_ID updated in src/ballsyPlayer.tsx.']),
    ]);
    const renderBtn = h('button', {type: 'button', class: 'btn primary'}, ['Render video']);
    renderBtn.addEventListener('click', runRender);
    pipelineDoneEl.appendChild(renderBtn);
    pipelineSection.appendChild(pipelineDoneEl);
  }

  function attachPipeline(run: PlayerPipelineRun): void {
    pipelineSection.innerHTML = '';
    pipelineSection.classList.remove('hidden');
    pipelineSection.append(
      h('p', {class: 'hint'}, ['Running the rest of the pipeline (audio, lip-sync, stat cards, captions).']),
    );
    const log = h('div', {class: 'log'});
    pipelineSection.appendChild(log);

    const paint = (r: PlayerPipelineRun): void => {
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
    attachPipeline(startPlayerPipeline(playerId, date, runSlug));
    renderActions();
  }

  function runRender(): void {
    renderSection.innerHTML = '';
    renderSection.classList.remove('hidden');
    renderSection.append(h('p', {class: 'hint'}, ['Rendering — this can take a few minutes.']));
    const log = h('div', {class: 'log'});
    renderSection.appendChild(log);

    const source = new EventSource(
      `/api/player/render?playerId=${encodeURIComponent(playerId)}&date=${encodeURIComponent(date)}&runSlug=${encodeURIComponent(runSlug)}`,
    );
    source.onerror = () => source.close();
    source.onmessage = (e) => {
      if (isStale()) {
        source.close();
        return;
      }
      const msg = JSON.parse(e.data) as {
        type: string;
        line?: string;
        path?: string;
        videoUrl?: string;
        message?: string;
      };
      if (msg.type === 'log') {
        log.textContent += msg.line;
        log.scrollTop = log.scrollHeight;
      } else if (msg.type === 'done') {
        state.hasVideo = true;
        updateStatusStrip();
        renderActions();
        if (msg.videoUrl) showVideo(msg.videoUrl);
        showPublishSection();
        renderSection.append(h('p', {class: 'hint mt-md'}, [`Saved to ${msg.path}`]));
        source.close();
      } else if (msg.type === 'error') {
        log.textContent += '\nError: ' + msg.message + '\n';
        source.close();
      }
    };
  }

  // Only ever called when isToday (gated at the one call site in
  // renderActions, plus the in-flight-reattach case below, which is also
  // always today by construction — see isGeneratingPlayerScript). Reuses
  // this run's own focus text so regenerating can't drift to a different run
  // than the one this page is showing — see runFocusPrompt's own comment.
  async function runGenerate(): Promise<void> {
    scriptView.classList.add('hidden');
    saveBar.classList.add('hidden');
    generateSection.innerHTML = '';
    generateSection.append(h('p', {class: 'hint'}, ['Generating script... this takes about half a minute.']));
    const pending = generatePlayerScript(playerId, runFocusPrompt ?? undefined, runCompetitions, overwriteOpts);
    if (state.reviewStatus !== null) renderActions();
    try {
      const data = await pending;
      if (isStale()) return;
      state.reviewStatus = 'pending';
      renderPlayerScriptBlocks(data.script);
      scriptView.classList.remove('hidden');
      generateSection.innerHTML = '';
      updateStatusStrip();
      renderActions();
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

  // Try to load this run's already-generated script for free. Arriving here
  // with none (a bookmarked or hand-typed URL for a run that never got a
  // script) is an error state, not an offer to generate — generating always
  // happens from the overview page, which would silently create a DIFFERENT
  // run than the one this page's URL names.
  getExistingPlayerScript(playerId, date, runSlug)
    .then((data) => {
      if (isStale()) return;
      if (data) {
        state.reviewStatus = data.reviewStatus;
        state.hasAudio = data.hasAudio;
        state.hasVideo = data.hasVideo;
        state.youtube = data.youtube;
        state.tiktok = data.tiktok;
        runFocusPrompt = data.focusPrompt;
        currentPublishMetadata = data.publishMetadata;
        runCompetitions = data.playerInfo?.competitions?.map((c) => ({
          tournamentId: c.tournamentId,
          seasonId: c.seasonId,
        }));
        mountRunMeta(runMeta, runLabel, ref, data, isStale);
        title.textContent = data.playerInfo?.name ?? `Player ${playerId}`;
        subtitle.textContent = [data.playerInfo?.team, data.playerInfo?.competition, date]
          .filter(Boolean)
          .join(' · ');
        renderPlayerScriptBlocks(data.script);
        scriptView.classList.remove('hidden');
        updateStatusStrip();
        renderActions();
        if (data.hasVideo && data.videoUrl) {
          showVideo(data.videoUrl);
          showPublishSection();
        }
      }

      if (isToday && isGeneratingPlayerScript(playerId, data?.focusPrompt, overwriteOpts)) {
        void runGenerate();
        return;
      }
      const pipelineKey = `${playerId}:${date}:${runSlug}`;
      if (activePlayerPipelines.has(pipelineKey)) {
        attachPipeline(activePlayerPipelines.get(pipelineKey)!);
        return;
      }

      if (!data) {
        generateSection.append(
          errorBanner(`No script found for this run.`),
          h('a', {href: `/player/${playerId}`, 'data-link': '', class: 'btn ghost mt-sm'}, [
            '← Back to player overview',
          ]),
        );
      }
    })
    .catch((err) => {
      if (isStale()) return;
      generateSection.append(errorBanner((err as Error).message));
    });
}

// ---------------------------------------------------------------------------
// Pre-match preview home — type the two teams, and the server resolves the
// actual fixture between them. Deliberately two copies of renderPlayerHome's
// single-debounced-search-box pattern rather than the match flow's
// league/season/matchday drill-down: for a preview you already know which
// game you mean, so naming both teams is the shortest path to it.
// ---------------------------------------------------------------------------

function renderPrematchHome(): void {
  const pageEpoch = renderEpoch;
  const isStale = (): boolean => pageEpoch !== renderEpoch;

  const picked: {a: TeamSearchResult | null; b: TeamSearchResult | null} = {a: null, b: null};
  const resolveSection = h('div', {class: 'section'});

  // One team picker. `slot` is which side of `picked` it fills; everything
  // else (debounce, result rows, the "change" affordance once picked) is the
  // same as renderPlayerHome's single box.
  function teamPicker(slot: 'a' | 'b', label: string): HTMLElement {
    const input = h('input', {type: 'text', placeholder: 'Search a team by name...'}) as HTMLInputElement;
    const results = h('div', {class: 'list mt-sm'});
    const chosen = h('div', {class: 'selected-bar hidden'});
    const field = h('div', {class: 'field'}, [h('label', {}, [label]), input, chosen, results]);

    let searchTimer: ReturnType<typeof setTimeout> | undefined;

    const clearChoice = (): void => {
      picked[slot] = null;
      chosen.classList.add('hidden');
      chosen.innerHTML = '';
      input.classList.remove('hidden');
      input.value = '';
      input.focus();
      tryResolve();
    };

    const choose = (team: TeamSearchResult): void => {
      picked[slot] = team;
      results.innerHTML = '';
      input.classList.add('hidden');
      chosen.innerHTML = '';
      chosen.classList.remove('hidden');
      const changeBtn = h('button', {type: 'button', class: 'btn ghost'}, ['Change']);
      changeBtn.addEventListener('click', clearChoice);
      chosen.append(h('span', {}, [[team.name, team.country].filter(Boolean).join(' · ')]), changeBtn);
      tryResolve();
    };

    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const query = input.value.trim();
      if (!query) {
        results.innerHTML = '';
        return;
      }
      searchTimer = setTimeout(async () => {
        results.innerHTML = '';
        results.append(h('p', {class: 'hint'}, ['Searching...']));
        try {
          const teams = await searchTeamsApi(query);
          if (isStale()) return;
          results.innerHTML = '';
          if (teams.length === 0) {
            results.append(h('p', {class: 'hint'}, ['No teams found.']));
            return;
          }
          for (const team of teams) {
            const row = h('a', {href: '#', class: 'row'}, [
              h('span', {class: 'row-title'}, [team.name]),
              h('span', {class: 'row-sub'}, [[team.code, team.country].filter(Boolean).join(' · ')]),
            ]);
            row.addEventListener('click', (e) => {
              e.preventDefault();
              choose(team);
            });
            results.appendChild(row);
          }
        } catch (err) {
          if (isStale()) return;
          results.innerHTML = '';
          results.append(errorBanner((err as Error).message));
        }
      }, 300);
    });

    return field;
  }

  // Both teams picked -> ask the server for the real fixture between them and
  // offer to open its page. Nothing is spent here; this is one free
  // SofaScore lookup.
  function tryResolve(): void {
    resolveSection.innerHTML = '';
    const teamA = picked.a;
    const teamB = picked.b;
    if (!teamA || !teamB) return;
    if (teamA.id === teamB.id) {
      resolveSection.append(errorBanner('Pick two different teams.'));
      return;
    }
    resolveSection.append(h('p', {class: 'hint'}, ['Finding the next fixture between these two...']));
    getNextFixtureApi(teamA.id, teamB.id)
      .then((fixture) => {
        if (isStale()) return;
        resolveSection.innerHTML = '';
        if (!fixture) {
          resolveSection.append(
            h('p', {class: 'hint'}, [`No upcoming fixture found between ${teamA.name} and ${teamB.name}.`]),
          );
          return;
        }
        const when = fixture.date ? new Date(fixture.date * 1000).toLocaleDateString('en-GB') : 'date TBC';
        const card = h('div', {class: 'card'}, [
          h('h3', {}, [`${fixture.home} vs ${fixture.away}`]),
          h('p', {class: 'hint'}, [
            [fixture.tournament, fixture.round != null ? `Matchday ${fixture.round}` : null, when]
              .filter(Boolean)
              .join(' · '),
          ]),
        ]);
        const openBtn = h('button', {type: 'button', class: 'btn primary'}, ['Preview this fixture']);
        openBtn.addEventListener('click', () => navigate(`/prematch/${fixture.matchId}`));
        card.append(openBtn);
        resolveSection.append(card);
      })
      .catch((err) => {
        if (isStale()) return;
        resolveSection.innerHTML = '';
        resolveSection.append(errorBanner((err as Error).message));
      });
  }

  app.append(
    h('div', {class: 'page'}, [
      h('h1', {class: 'page-title'}, ['Preview a fixture']),
      h('p', {class: 'hint'}, ['Name both teams and Ballsy will find their next meeting.']),
      teamPicker('a', 'Team A'),
      teamPicker('b', 'Team B'),
      resolveSection,
    ]),
  );
}

// What the two teams are bringing into the fixture — form, table, head-to-
// head, current runs — so you can judge whether a preview is worth making
// before spending on one. Pulled from the same SofaScore data
// generate-prematch-script.mjs uses, so there's nothing new to fetch.
// Deliberately shows no score and no event list: there aren't any yet.
function renderPrematchReportCard(container: HTMLElement, info: FullPrematchInfo): void {
  container.innerHTML = '';
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
  const standings = info.context.standings;
  const tableLine = (row: StandingsRow | null | undefined): HTMLElement[] =>
    row?.position != null
      ? [h('div', {class: 'scoreboard-name'}, [`${row.position}${row.points != null ? ` · ${row.points} pts` : ''}`])]
      : [];

  card.append(
    h('div', {class: 'scoreboard'}, [
      h('div', {class: 'scoreboard-side'}, [
        h('div', {class: 'scoreboard-code'}, [info.homeCode ?? info.home]),
        h('div', {class: 'scoreboard-name'}, [info.home]),
        ...tableLine(standings?.home),
        ...(homeForm?.last5 ? [formBadges(homeForm.last5)] : []),
      ]),
      h('div', {class: 'scoreboard-score'}, ['vs']),
      h('div', {class: 'scoreboard-side'}, [
        h('div', {class: 'scoreboard-code'}, [info.awayCode ?? info.away]),
        h('div', {class: 'scoreboard-name'}, [info.away]),
        ...tableLine(standings?.away),
        ...(awayForm?.last5 ? [formBadges(awayForm.last5)] : []),
      ]),
    ]),
  );

  const metaBits = [
    info.tournament,
    info.season,
    info.round != null ? `Matchday ${info.round}` : null,
    info.date ? new Date(info.date * 1000).toLocaleString('en-GB') : null,
  ].filter(Boolean);
  if (metaBits.length) card.append(h('p', {class: 'hint scoreboard-meta'}, [metaBits.join(' · ')]));

  const h2h = info.context.h2h;
  if (h2h && (h2h.homeWins !== null || h2h.draws !== null || h2h.awayWins !== null)) {
    card.append(
      h('p', {class: 'hint'}, [
        `Head-to-head: ${h2h.homeWins ?? 0}W ${h2h.draws ?? 0}D ${h2h.awayWins ?? 0}L (from ${info.home}'s side)`,
      ]),
    );
  }

  // Both directions of each team's run, exactly as the sidecar reports them
  // — a bad run is shown as plainly as a good one.
  const streaks = info.context.teamStreaks;
  const describe = (s: TeamStreak | null | undefined): string => {
    if (!s) return 'no results counted yet';
    if (s.winStreak > 0) return `${s.winStreak} straight wins`;
    if (s.unbeatenStreak > 0) return `${s.unbeatenStreak} unbeaten`;
    if (s.lossStreak > 0) return `${s.lossStreak} straight defeats`;
    if (s.winlessStreak > 0) return `${s.winlessStreak} without a win`;
    return 'no run either way';
  };
  if (streaks) {
    card.append(
      h('h3', {}, ['Form going in']),
      h('p', {class: 'hint'}, [`${info.home}: ${describe(streaks.home)}`]),
      h('p', {class: 'hint'}, [`${info.away}: ${describe(streaks.away)}`]),
    );
  }

  if (info.context.personalAngle) {
    card.append(
      h('p', {class: 'hint'}, [
        info.context.personalAngle.type === 'favorite'
          ? `Ballsy's own team — ${info.context.personalAngle.team}.`
          : `A Ballsy rival — ${info.context.personalAngle.team}.`,
      ]),
    );
  }

  container.append(card);
}

// ---------------------------------------------------------------------------
// Pre-match overview — one fixture's free report plus every preview ever made
// for it, with a button to start a new one. Mirrors renderMatchOverview;
// each run opens its own page (renderPrematchDetail) via /prematch/:id/:run.
// ---------------------------------------------------------------------------

function renderPrematchOverview(matchId: string): void {
  const pageEpoch = renderEpoch;
  const isStale = (): boolean => pageEpoch !== renderEpoch;

  const backLink = h('a', {href: '#', class: 'back-link'}, ['← Back']);
  backLink.addEventListener('click', (e) => {
    e.preventDefault();
    history.back();
  });

  const title = h('h1', {class: 'page-title'}, [`Fixture ${matchId}`]);
  const matchIdLabel = h('span', {class: 'match-id-label'}, [`ID ${matchId}`]);
  const subtitle = h('p', {class: 'hint'});
  const header = h('div', {class: 'workspace-header'}, [title, matchIdLabel]);
  const infoSection = h('div', {class: 'section'});
  const newRunSection = h('div', {class: 'section'});
  const runsSection = h('div', {class: 'section'});

  app.append(h('div', {class: 'page'}, [backLink, header, subtitle, runsSection, newRunSection, infoSection]));

  infoSection.append(h('p', {class: 'hint'}, ['Loading the pre-match report...']));
  getPrematchInfo(matchId)
    .then((info) => {
      if (isStale()) return;
      renderPrematchReportCard(infoSection, info);
      title.textContent = `${info.home} vs ${info.away}`;
      subtitle.textContent = prematchSubtitle({
        home: info.home,
        away: info.away,
        homeCode: info.homeCode,
        awayCode: info.awayCode,
        tournament: info.tournament,
        season: info.season,
        round: info.round,
        date: info.date,
      });
    })
    .catch((err) => {
      if (isStale()) return;
      infoSection.innerHTML = '';
      // The sidecar refuses a fixture that has already kicked off — surfaced
      // as-is, since "this one has been played, make a recap instead" is
      // exactly the right thing to tell someone here.
      infoSection.append(errorBanner(`Could not load the pre-match report: ${(err as Error).message}`));
    });

  newRunSection.append(
    renderNewVideoForm({
      buttonLabel: 'Generate a preview',
      placeholder: 'Optional: tell Ballsy what to focus on (e.g. the injury news, the title race)...',
      generate: (focus, opts) => generatePrematchScript(matchId, focus, opts),
      hrefFor: ({runSlug}) => `/prematch/${matchId}/${runSlug}`,
      isStale,
    }),
  );

  function renderRuns(runs: PrematchRun[]): void {
    runsSection.innerHTML = '';
    runsSection.append(
      h('h3', {}, [`Videos (${runs.length})`]),
      renderRunsList(runs, 'No previews made for this fixture yet — generate the first one below.'),
    );
  }

  runsSection.append(h('p', {class: 'hint'}, ['Loading videos...']));
  getPrematchRunsApi(matchId)
    .then((runs) => {
      if (isStale()) return;
      renderRuns(runs);
    })
    .catch((err) => {
      if (isStale()) return;
      runsSection.innerHTML = '';
      runsSection.append(errorBanner((err as Error).message));
    });
}

// ---------------------------------------------------------------------------
// Pre-match detail — one preview run's workspace (review/approve/
// run-pipeline/render), reached from the overview page. Mirrors
// renderPlayerDetail step for step; starting a brand new run (with or
// without a focus) happens on the overview page, not here. Publishing works
// exactly like a match's: the same YouTube/TikTok blocks, driven by the run's
// ref (see runQuery).
// ---------------------------------------------------------------------------

function renderPrematchDetail(matchId: string, runSlug: string): void {
  const pageEpoch = renderEpoch;
  const isStale = (): boolean => pageEpoch !== renderEpoch;

  const state: PipelineState = {
    reviewStatus: null,
    hasAudio: false,
    hasVideo: false,
    youtube: null,
    tiktok: null,
  };
  let currentScript: PrematchScript | null = null;
  let scriptDirty = false;
  // This run's own focus text (or null for the default run) — reused for
  // "Regenerate script" so regenerating can never silently redirect to a
  // DIFFERENT run than the one this page is showing.
  let runFocusPrompt: string | null = null;

  // history.back() (not a static href to the overview page) so this returns
  // wherever the user actually came from — History, search results, or the
  // overview — instead of always forcing a stop at the overview page first.
  const backLink = h('a', {href: '#', class: 'back-link'}, ['← Back']);
  backLink.addEventListener('click', (e) => {
    e.preventDefault();
    history.back();
  });

  const title = h('h1', {class: 'page-title'}, [`Fixture ${matchId}`]);
  const matchIdLabel = h('span', {class: 'match-id-label'}, [`ID ${matchId}`]);
  const runLabel = h('span', {class: 'match-id-label'}, [runName({label: null, focusPrompt: null, runSlug})]);
  const subtitle = h('p', {class: 'hint'});
  const header = h('div', {class: 'workspace-header'}, [title, matchIdLabel, runLabel]);
  const statusStrip = h('div', {class: 'status-strip hidden'});
  const ref: RunRef = {kind: 'prematch', matchId, runSlug};
  // Regenerating replaces THIS run in place (its own slug), never a slug
  // re-derived from the focus text.
  const overwriteOpts: GenerateOpts = {mode: 'overwrite', runSlug};
  const siblings = renderSiblingStrip(ref, () => getPrematchRunsApi(matchId), isStale);
  const runMeta = h('div', {class: 'run-meta'});
  const deleteSection = renderDeleteVideo(
    ref,
    () => ({youtube: state.youtube !== null, tiktok: state.tiktok !== null}),
    isStale,
  );
  // Title/description/hashtags generated with the script — read by the publish blocks.
  let currentPublishMetadata: PublishMetadata | null = null;
  const publishSection = h('div', {class: 'section hidden'});

  const generateSection = h('div', {class: 'section'});
  const predictionSection = h('div', {class: 'section hidden'});
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
  const videoSection = h('div', {class: 'section hidden'});

  app.append(
    h('div', {class: 'page'}, [
      backLink,
      header,
      subtitle,
      siblings,
      runMeta,
      statusStrip,
      videoSection,
      publishSection,
      generateSection,
      predictionSection,
      scriptView,
      saveBar,
      actions,
      costHint,
      pipelineSection,
      renderSection,
      deleteSection,
    ]),
  );

  // videoUrl comes straight from the server (prematch.mjs builds the actual
  // on-disk path) — never recomputed here.
  function showVideo(videoUrl: string): void {
    videoSection.innerHTML = '';
    videoSection.classList.remove('hidden');
    const src = `${videoUrl}?t=${Date.now()}`;
    const video = h('video', {controls: 'true', class: 'video-player', src});
    const filename = runSlug === DEFAULT_RUN_SLUG ? `prematch-${matchId}.mp4` : `prematch-${matchId}-${runSlug}.mp4`;
    const downloadLink = h('a', {href: src, download: filename, class: 'btn ghost mt-sm'}, ['Download video']);
    videoSection.append(h('div', {class: 'card'}, [video, downloadLink]));
  }

  // Once a video exists, both publish blocks (each owns its own connect /
  // publish / published states) — redrawn when a publish completes so the
  // status chips catch up.
  function showPublishSection(): void {
    publishSection.innerHTML = '';
    publishSection.classList.remove('hidden');
    publishSection.append(
      renderYoutubePublishBlock(runQuery(ref), state.youtube, currentPublishMetadata, (published) => {
        state.youtube = published;
        updateStatusStrip();
      }),
      renderTiktokPublishBlock(runQuery(ref), state.tiktok, currentPublishMetadata, (published) => {
        state.tiktok = published;
        updateStatusStrip();
      }),
    );
  }

  // Ballsy's own call, shown next to the script so a reviewer can check the
  // on-screen call-out card against what the prediction block actually says
  // — it has to read as his opinion in both places.
  function showPrediction(prediction: Prediction | null, info: PrematchMatchInfo | null): void {
    predictionSection.innerHTML = '';
    if (!prediction) return;
    predictionSection.classList.remove('hidden');
    const fallback = prediction.pick === 'home' ? (info?.home ?? 'the home side') : (info?.away ?? 'the away side');
    const who = prediction.pick === 'draw' ? 'a draw' : (prediction.team ?? fallback);
    predictionSection.append(
      h('div', {class: 'card'}, [
        h('h3', {}, ["Ballsy's call"]),
        h('p', {}, [`He's backing ${who}.`]),
        h('p', {class: 'hint'}, [
          'Shown on screen as his opinion, never as a statement of fact — check the prediction block below says the same thing.',
        ]),
      ]),
    );
  }

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

  // Same "edit existing lines only" contract as the other two detail pages —
  // a TaggedPreview.segmentIndex points at a segment by position.
  function renderPrematchScriptBlocks(script: PrematchScript): void {
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
      const stats = (m.stats ?? []).map((s) => s.statType).join(', ');
      addBlock(`Moment ${i + 1} (${stats || 'no graphic'})`, m);
    });
    if (script.controversy) addBlock('Take', script.controversy);
    // Named for what it actually is in a preview — the block schema is
    // shared with the other two video types, its meaning here is not.
    addBlock('Prediction', script.result);
    addBlock('Outro', script.outro);
  }

  let saveErrorEl: HTMLElement | null = null;

  async function saveEdits(): Promise<boolean> {
    if (!currentScript) return false;
    saveBtn.setAttribute('disabled', 'true');
    saveErrorEl?.remove();
    try {
      await savePrematchScript(matchId, runSlug, currentScript);
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

  function renderActions(): void {
    actions.innerHTML = '';
    actions.classList.remove('hidden');
    costHint.classList.remove('hidden');
    const stage = pipelineStage(state);
    const pipelineRunning = activePrematchPipelines.has(`${matchId}:${runSlug}`);
    const generating = isGeneratingPrematchScript(matchId, runFocusPrompt, overwriteOpts);

    if (stage === 'review' || stage === 'rejected') {
      const cls = stage === 'rejected' ? 'btn ghost' : 'btn primary';
      const approveBtn = h('button', {type: 'button', class: cls}, ['Approve']);
      if (generating) approveBtn.setAttribute('disabled', 'true');
      approveBtn.addEventListener('click', async () => {
        approveBtn.setAttribute('disabled', 'true');
        try {
          if (scriptDirty && !(await saveEdits())) {
            approveBtn.removeAttribute('disabled');
            return;
          }
          await approvePrematchScript(matchId, runSlug);
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

      const previewBtn = h('button', {type: 'button', class: 'btn ghost'}, ['Preview in Remotion Studio']);
      previewBtn.addEventListener('click', async () => {
        previewBtn.setAttribute('disabled', 'true');
        previewBtn.textContent = 'Starting Remotion Studio...';
        try {
          await launchStudio();
          window.open(`${STUDIO_URL}/PrematchBallsy`, '_blank');
        } catch (err) {
          actions.append(errorBanner((err as Error).message));
        } finally {
          previewBtn.removeAttribute('disabled');
          previewBtn.textContent = 'Preview in Remotion Studio';
        }
      });
      actions.appendChild(previewBtn);
    }

    const regenerateBtn = h('button', {type: 'button', class: stage === 'rejected' ? 'btn primary' : 'btn ghost'}, [
      generating ? 'Generating script...' : 'Regenerate script',
    ]);
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
      h('p', {class: 'hint'}, ['Audio and data ready. PREMATCH_FIXTURE_ID updated in src/ballsyPrematch.tsx.']),
    ]);
    const renderBtn = h('button', {type: 'button', class: 'btn primary'}, ['Render video']);
    renderBtn.addEventListener('click', runRender);
    pipelineDoneEl.appendChild(renderBtn);
    pipelineSection.appendChild(pipelineDoneEl);
  }

  function attachPipeline(run: PrematchPipelineRun): void {
    pipelineSection.innerHTML = '';
    pipelineSection.classList.remove('hidden');
    pipelineSection.append(
      h('p', {class: 'hint'}, ['Running the rest of the pipeline (audio, lip-sync, preview cards, captions).']),
    );
    const log = h('div', {class: 'log'});
    pipelineSection.appendChild(log);

    const paint = (r: PrematchPipelineRun): void => {
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
    attachPipeline(startPrematchPipeline(matchId, runSlug));
    renderActions();
  }

  function runRender(): void {
    renderSection.innerHTML = '';
    renderSection.classList.remove('hidden');
    renderSection.append(h('p', {class: 'hint'}, ['Rendering — this can take a few minutes.']));
    const log = h('div', {class: 'log'});
    renderSection.appendChild(log);

    const source = new EventSource(
      `/api/prematch/render?matchId=${encodeURIComponent(matchId)}&runSlug=${encodeURIComponent(runSlug)}`,
    );
    source.onerror = () => source.close();
    source.onmessage = (e) => {
      if (isStale()) {
        source.close();
        return;
      }
      const msg = JSON.parse(e.data) as {
        type: string;
        line?: string;
        path?: string;
        videoUrl?: string;
        message?: string;
      };
      if (msg.type === 'log') {
        log.textContent += msg.line;
        log.scrollTop = log.scrollHeight;
      } else if (msg.type === 'done') {
        state.hasVideo = true;
        updateStatusStrip();
        renderActions();
        if (msg.videoUrl) showVideo(msg.videoUrl);
        showPublishSection();
        renderSection.append(h('p', {class: 'hint mt-md'}, [`Saved to ${msg.path}`]));
        source.close();
      } else if (msg.type === 'error') {
        log.textContent += '\nError: ' + msg.message + '\n';
        source.close();
      }
    };
  }

  // Reuses this run's own focus text so regenerating can't drift to a
  // different run than the one this page is showing.
  async function runGenerate(): Promise<void> {
    scriptView.classList.add('hidden');
    saveBar.classList.add('hidden');
    predictionSection.classList.add('hidden');
    generateSection.innerHTML = '';
    generateSection.append(h('p', {class: 'hint'}, ['Generating script... this takes about half a minute.']));
    const pending = generatePrematchScript(matchId, runFocusPrompt ?? undefined, overwriteOpts);
    if (state.reviewStatus !== null) renderActions();
    try {
      const data = await pending;
      if (isStale()) return;
      state.reviewStatus = 'pending';
      renderPrematchScriptBlocks(data.script);
      scriptView.classList.remove('hidden');
      generateSection.innerHTML = '';
      updateStatusStrip();
      renderActions();
      // The freshly-written call isn't in that response — re-read the saved
      // run (free) so the prediction card matches the new script.
      const saved = await getExistingPrematchScript(matchId, runSlug);
      if (!isStale() && saved) showPrediction(saved.prediction, saved.matchInfo);
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

  // Try to load this run's already-generated script for free. Arriving here
  // with none (a bookmarked or hand-typed URL for a run that never got a
  // script) is an error state, not an offer to generate — generating always
  // happens from the overview page, which would silently create a DIFFERENT
  // run than the one this page's URL names.
  getExistingPrematchScript(matchId, runSlug)
    .then((data) => {
      if (isStale()) return;
      if (data) {
        state.reviewStatus = data.reviewStatus;
        state.hasAudio = data.hasAudio;
        state.hasVideo = data.hasVideo;
        state.youtube = data.youtube;
        state.tiktok = data.tiktok;
        runFocusPrompt = data.focusPrompt;
        currentPublishMetadata = data.publishMetadata;
        mountRunMeta(runMeta, runLabel, ref, data, isStale);
        title.textContent = prematchTitle(data.matchInfo, matchId);
        subtitle.textContent = prematchSubtitle(data.matchInfo);
        showPrediction(data.prediction, data.matchInfo);
        renderPrematchScriptBlocks(data.script);
        scriptView.classList.remove('hidden');
        updateStatusStrip();
        renderActions();
        if (data.hasVideo && data.videoUrl) {
          showVideo(data.videoUrl);
          showPublishSection();
        }
      }

      if (isGeneratingPrematchScript(matchId, data?.focusPrompt, overwriteOpts)) {
        void runGenerate();
        return;
      }
      const pipelineKey = `${matchId}:${runSlug}`;
      if (activePrematchPipelines.has(pipelineKey)) {
        attachPipeline(activePrematchPipelines.get(pipelineKey)!);
        return;
      }

      if (!data) {
        generateSection.append(
          errorBanner('No script found for this run.'),
          h('a', {href: `/prematch/${matchId}`, 'data-link': '', class: 'btn ghost mt-sm'}, [
            '← Back to fixture overview',
          ]),
        );
      }
    })
    .catch((err) => {
      if (isStale()) return;
      generateSection.append(errorBanner((err as Error).message));
    });
}

render();
