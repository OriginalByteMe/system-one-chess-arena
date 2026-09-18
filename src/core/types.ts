// The single type surface for the arena. Everything else imports from here.
// No `any`, no assertions through `unknown`: every boundary has a declared
// shape and a parser that narrows into it.

/** A move in UCI notation, e.g. "e2e4" or "e7e8q". */
export type Uci = string;
/** A move in SAN notation, e.g. "Nf3" or "exd8=Q+". */
export type San = string;
/** A full FEN string. */
export type Fen = string;

export type Colour = "white" | "black";

/** Result from white's point of view. */
export type GameResult = "white" | "black" | "draw";

export type TerminalReason =
  | "checkmate"
  | "stalemate"
  | "insufficient-material"
  | "fifty-move"
  | "threefold"
  | "move-limit";

export interface TerminalState {
  readonly result: GameResult;
  readonly reason: TerminalReason;
  /**
   * Material balance in centipawns from white's side, present only when a
   * game with no progress was awarded on material rather than drawn. Absent
   * on a genuine ending, and absent when the rule declined inside its band.
   */
  readonly adjudicatedCp?: number;
}

/** Score awarded to one side for one game. */
export type GameScore = 0 | 0.5 | 1;

// ---------------------------------------------------------------------------
// Computed features. Keys are closed: a manifest may only ask for these.
// ---------------------------------------------------------------------------

export interface FeatureValues {
  /** Material balance in centipawns, positive favours the side to move. */
  readonly materialBalance: number;
  /** Number of legal moves for the side to move. */
  readonly mobility: number;
  /** Number of legal moves the opponent would have after a null move. */
  readonly opponentMobility: number;
  /** Own pieces currently attacked and not defended. */
  readonly hangingOwnPieces: number;
  /** Opponent pieces currently attacked and not defended. */
  readonly hangingOpponentPieces: number;
  /** Rough king-safety score for the side to move; higher is safer. */
  readonly kingSafety: number;
  /** True when the side to move is in check. */
  readonly inCheck: boolean;
  /** True when the opponent has a mate in one available. */
  readonly opponentMateInOne: boolean;
  /** Own pieces the opponent's last move started attacking. */
  readonly lastMoveAttacks: number;
  /** Highest value in centipawns the opponent's last move put under attack. */
  readonly lastMoveThreatValue: number;
  /** True when the opponent's last move was a capture. */
  readonly lastMoveWasCapture: boolean;
  /** Count of own developed minor pieces. */
  readonly development: number;
  /** Ply-derived phase label. */
  readonly phase: GamePhase;
}

export type GamePhase = "opening" | "middlegame" | "endgame";

export type FeatureKey = keyof FeatureValues;

/** All features, always fully populated by the feature computer. */
export type FeatureSet = FeatureValues;

/** The subset a given manifest is allowed to see. */
export type FeatureSubset = { readonly [K in FeatureKey]?: FeatureValues[K] };

export const FEATURE_KEYS = [
  "materialBalance",
  "mobility",
  "opponentMobility",
  "hangingOwnPieces",
  "hangingOpponentPieces",
  "kingSafety",
  "inCheck",
  "opponentMateInOne",
  "lastMoveAttacks",
  "lastMoveThreatValue",
  "lastMoveWasCapture",
  "development",
  "phase",
] as const satisfies readonly FeatureKey[];

// ---------------------------------------------------------------------------
// Strategies. Closed set, declared per manifest.
// ---------------------------------------------------------------------------

export const STRATEGY_LABELS = [
  "direct",
  "attack",
  "defend",
  "develop",
  "simplify",
  "fortify",
  "endgame",
  "trade-down",
  "king-hunt",
] as const;

export type StrategyLabel = (typeof STRATEGY_LABELS)[number];

export type FallbackPolicy = "random-legal" | "greedy" | "first-legal";

export type FallbackReason =
  | "timeout"
  | "illegal-output"
  | "provider-error"
  | "malformed-response"
  | "malformed-distribution"
  | "unknown-strategy";

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

/** Manifest fields without the derived version, i.e. the hash input. */
export interface ManifestFields {
  readonly name: string;
  readonly model: string;
  readonly playstyle: string;
  readonly strategies: readonly StrategyLabel[];
  readonly features: readonly FeatureKey[];
  /** How many plies of move history the player may see. */
  readonly historyPlies: number;
  readonly fallback: FallbackPolicy;
  readonly budget: Budget;
  /** True when the player picks a strategy before picking a move. */
  readonly hierarchical: boolean;
}

export interface CompetitorManifest extends ManifestFields {
  /** Hash of ManifestFields. Immutable: any field change is a new version. */
  readonly version: string;
}

export interface Budget {
  readonly maxMs: number;
  readonly maxCostUsd?: number;
}

export interface StrategyStats {
  readonly picks: number;
  /** Summed game score over games where this strategy was picked. */
  readonly score: number;
  readonly avgConfidence: number;
}

export interface PlayerRecord {
  readonly competitor: string;
  readonly version: string;
  readonly games: number;
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
  readonly byColour: { readonly white: number; readonly black: number };
  readonly byStrategy: { readonly [key in StrategyLabel]?: StrategyStats };
}

export interface PositionInput {
  readonly seasonId: string;
  readonly gameId: string;
  readonly ply: number;
  readonly colour: Colour;
  readonly fen: Fen;
  /** Recent SAN, most recent last, capped by manifest.historyPlies. */
  readonly history: readonly San[];
  readonly legalMoves: readonly Uci[];
  readonly features: FeatureSubset;
  readonly persona: CompetitorManifest;
  /** Phase 6 only: the player's own past results. */
  readonly record?: PlayerRecord;
  readonly budget: Budget;
}

export interface TokenUsage {
  readonly in: number;
  readonly out: number;
}

export interface MoveDecision {
  readonly move: Uci;
  readonly confidence?: number;
  readonly distribution?: MoveDistribution;
  readonly strategy: StrategyLabel;
  readonly latencyMs: number;
  readonly tokens?: TokenUsage;
  readonly fallback?: FallbackReason;
}

export type MoveDistribution = { readonly [move: string]: number };

export interface Competitor {
  readonly manifest: CompetitorManifest;
  decide(input: PositionInput): Promise<MoveDecision>;
}

// ---------------------------------------------------------------------------
// Injected seams: the only sources of nondeterminism in the system.
// ---------------------------------------------------------------------------

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, boundExclusive). */
  nextInt(boundExclusive: number): number;
  /** Picks one element; throws on an empty list. */
  pick<T>(items: readonly T[]): T;
}

export interface Clock {
  /** Monotonic milliseconds. */
  now(): number;
}

export interface FixedClock extends Clock {
  advance(ms: number): void;
}

// ---------------------------------------------------------------------------
// Provider seam. The only place the network is reachable.
// ---------------------------------------------------------------------------

export type StateValue = string | number | boolean | readonly string[];
export type StateDocument = { readonly [key: string]: StateValue };

export interface ChoiceQuestion {
  readonly type: "choice";
  readonly instructions: string;
  readonly options: readonly string[];
  /**
   * Per-option description. A decision model reads these, so an option named
   * "d8h4" scores far worse than the same option described as "Qh4#". Optional
   * because not every question has anything to add beyond the option name.
   */
  readonly rubric?: { readonly [option: string]: string };
}

export interface SystemOneRequest {
  readonly kind: "systemone";
  readonly model: string;
  readonly state: StateDocument;
  readonly questions: { readonly [id: string]: ChoiceQuestion };
}

export interface ChatMessage {
  readonly role: "system" | "user";
  readonly content: string;
}

export interface ChatRequest {
  readonly kind: "chat";
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  /** Ask the provider for a JSON object rather than prose. */
  readonly jsonOnly: boolean;
}

export type ProviderRequest = SystemOneRequest | ChatRequest;

export interface ChoiceAnswer {
  readonly choice: string;
  readonly probabilities: { readonly [option: string]: number };
  readonly confidence: number;
}

export interface SystemOneResponse {
  readonly kind: "systemone";
  readonly answers: { readonly [id: string]: ChoiceAnswer };
  readonly tokens?: TokenUsage;
}

export interface ChatResponse {
  readonly kind: "chat";
  readonly text: string;
  readonly tokens?: TokenUsage;
}

export interface ProviderFailure {
  readonly kind: "error";
  readonly status?: number;
  readonly message: string;
}

export type ProviderResponse = SystemOneResponse | ChatResponse | ProviderFailure;

export interface Provider {
  ask(request: ProviderRequest): Promise<ProviderResponse>;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** What a player returned before the server has vetted it. */
export interface RawDecision {
  readonly move: string;
  readonly strategy?: string;
  readonly confidence?: number;
  readonly distribution?: MoveDistribution;
  readonly tokens?: TokenUsage;
  readonly latencyMs: number;
}

export type ValidationResult =
  | { readonly ok: true; readonly decision: MoveDecision }
  | { readonly ok: false; readonly reason: FallbackReason; readonly detail: string };

// ---------------------------------------------------------------------------
// Persistence shapes
// ---------------------------------------------------------------------------

/** One JSONL row per decision. Append-only; records are rebuilt from these. */
export interface DecisionRecord {
  readonly seasonId: string;
  readonly gameId: string;
  readonly ply: number;
  readonly competitor: string;
  readonly version: string;
  readonly colour: Colour;
  readonly fen: Fen;
  readonly legalMoveCount: number;
  readonly move: Uci;
  readonly strategy: StrategyLabel;
  readonly confidence?: number;
  readonly distribution?: MoveDistribution;
  readonly latencyMs: number;
  readonly tokens?: TokenUsage;
  readonly fallback?: FallbackReason;
  /** Feature keys the player actually received, for the fairness audit. */
  readonly featuresSeen: readonly FeatureKey[];
  /** (gameId, ply, version): dedupes at-least-once alarm retries. */
  readonly idempotencyKey: string;
}

export interface GameSummary {
  readonly seasonId: string;
  readonly gameId: string;
  readonly white: CompetitorRef;
  readonly black: CompetitorRef;
  readonly openingId: string;
  readonly result: GameResult;
  readonly reason: TerminalReason;
  /**
   * Set when the result came from the material rule rather than the board, so
   * the site can explain why a repetition was a win. See `TerminalState`.
   */
  readonly adjudicatedCp?: number;
  readonly plies: number;
  readonly pgn: string;
}

export interface CompetitorRef {
  readonly name: string;
  readonly version: string;
}

export interface Opening {
  readonly id: string;
  readonly name: string;
  /** Moves played from the initial position to reach the opening position. */
  readonly moves: readonly San[];
  readonly fen: Fen;
}

export interface Pairing {
  readonly gameId: string;
  readonly white: CompetitorRef;
  readonly black: CompetitorRef;
  readonly openingId: string;
}

export interface SeasonConfig {
  readonly seasonId: string;
  readonly seed: string;
  readonly competitors: readonly CompetitorManifest[];
  readonly openings: readonly Opening[];
  /** Games per ordered pair, so colour reversal is covered. */
  readonly roundsPerPair: number;
  readonly maxPlies: number;
}

export interface SeasonStandings {
  readonly seasonId: string;
  readonly rows: readonly StandingsRow[];
}

export interface StandingsRow {
  readonly competitor: string;
  readonly version: string;
  readonly games: number;
  readonly score: number;
  readonly elo: number;
}

export interface EloRating {
  readonly competitor: string;
  readonly version: string;
  readonly rating: number;
  readonly games: number;
}

// ---------------------------------------------------------------------------
// Live spectator stream (Phase 5)
// ---------------------------------------------------------------------------

export interface MoveEvent {
  readonly type: "move";
  readonly gameId: string;
  readonly ply: number;
  readonly move: Uci;
  readonly fen: Fen;
  readonly competitor: CompetitorRef;
  readonly strategy: StrategyLabel;
  readonly confidence?: number;
  readonly latencyMs: number;
}

export interface ResultEvent {
  readonly type: "result";
  readonly gameId: string;
  readonly ply: number;
  readonly result: GameResult;
  readonly reason: TerminalReason;
  readonly adjudicatedCp?: number;
}

export type LiveEvent = MoveEvent | ResultEvent;

export interface SpectatorState {
  readonly gameId: string;
  readonly fen: Fen;
  /** Highest applied ply; the resubscribe cursor. */
  readonly cursor: number;
  readonly lastMove?: MoveEvent;
  readonly finished?: ResultEvent;
}

// ---------------------------------------------------------------------------
// Self-revision (Phase 6)
// ---------------------------------------------------------------------------

export interface RevisionProposal {
  readonly competitor: string;
  readonly fromVersion: string;
  readonly strategies: readonly StrategyLabel[];
  readonly rationale: string;
}

export type RevisionOutcome =
  | { readonly kind: "kept"; readonly version: string }
  | { readonly kind: "revised"; readonly manifest: CompetitorManifest }
  | { readonly kind: "blocked"; readonly reason: "insufficient-samples"; readonly needed: number };

// ---------------------------------------------------------------------------
// Phase 2: broadcast clock and spoiler gate
// ---------------------------------------------------------------------------

/** Milliseconds since the Unix epoch. */
export type EpochMs = number;

/**
 * When a recorded game goes on air and how fast it plays. Stored per game; the
 * status is always derived from the clock, never written down.
 */
export interface BroadcastSchedule {
  readonly startAt: EpochMs;
  readonly msPerPly: number;
}

export type BroadcastStatus = "scheduled" | "on-air" | "finished";

/**
 * What a viewer is allowed to see right now. Carries no total ply count: the
 * length of a game in progress is itself a spoiler.
 */
export interface RevealWindow {
  readonly status: BroadcastStatus;
  /** Decisions with `ply < revealedPlies` may be served. */
  readonly revealedPlies: number;
  /** When `revealedPlies` next increases. Absent once the broadcast is over. */
  readonly nextBoundaryAt?: EpochMs;
}

/** A game as recorded: the full truth, never served to a viewer unsliced. */
export interface RecordedGame {
  readonly summary: GameSummary;
  readonly schedule: BroadcastSchedule;
  readonly matchId?: string;
}

/** A game as served: sliced to the revealed prefix by the gate. */
export interface RevealedGame {
  readonly gameId: string;
  readonly seasonId: string;
  readonly white: CompetitorRef;
  readonly black: CompetitorRef;
  readonly openingId: string;
  readonly window: RevealWindow;
  /** Position after the revealed decisions, so the client needs no engine. */
  readonly fen: Fen;
  readonly decisions: readonly DecisionRecord[];
  /** Present only once the whole broadcast has played out. */
  readonly outcome?: TerminalState;
  /** True when the game may be watched from ply 1 on demand. */
  readonly catchUp: boolean;
}

/** Legal moves at the revealed position, for guess-the-move. */
export interface RevealedMoves {
  readonly gameId: string;
  readonly ply: number;
  readonly fen: Fen;
  readonly legalMoves: readonly Uci[];
}

// ---------------------------------------------------------------------------
// Phase 2: identity and lineage
// ---------------------------------------------------------------------------

/**
 * One row per (competitor, version). The competitor name is the stable
 * cross-season identity, so it must be unique and immutable; the version chain
 * hangs off it through `parentVersion`.
 */
export interface CompetitorVersionRow {
  readonly competitor: string;
  readonly version: string;
  readonly seasonId: string;
  readonly manifest: CompetitorManifest;
  readonly parentVersion?: string;
  readonly traits: readonly Trait[];
  readonly rationale?: string;
}

export type NameViolationReason =
  | "duplicate-in-season"
  | "reserved-name"
  | "version-not-derived";

export interface NameViolation {
  readonly competitor: string;
  readonly reason: NameViolationReason;
  readonly detail: string;
}

// ---------------------------------------------------------------------------
// Phase 2: leaderboard, rolled up by competitor name
// ---------------------------------------------------------------------------

export interface LeaderboardRow {
  readonly competitor: string;
  /** Every version that played, oldest first. */
  readonly versions: readonly string[];
  readonly games: number;
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
  readonly score: number;
  readonly elo: number;
  readonly meanConfidence: number;
  /** Brier score of stated confidence against the game's outcome. */
  readonly calibrationError: number;
  readonly fallbackRate: number;
  readonly meanLatencyMs: number;
  readonly costUsd: number;
}

export interface Leaderboard {
  readonly rows: readonly LeaderboardRow[];
  /** Reveal boundary this was computed at, and the cache expiry. */
  readonly asOf: EpochMs;
}

export interface CalibrationBucket {
  readonly lower: number;
  readonly upper: number;
  readonly decisions: number;
  readonly meanConfidence: number;
  /** Mean game score of the games those decisions were played in. */
  readonly meanScore: number;
}

export interface CalibrationCurve {
  readonly competitor: string;
  readonly buckets: readonly CalibrationBucket[];
  readonly error: number;
}

export interface ModelPricing {
  readonly inputUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
}

// ---------------------------------------------------------------------------
// Phase 2: matches and brackets
// ---------------------------------------------------------------------------

/**
 * A bracket slot. `winner-of` is what a spoiler-gated future round returns
 * instead of a name.
 */
export type MatchSlot =
  | { readonly kind: "competitor"; readonly competitor: string }
  | { readonly kind: "winner-of"; readonly matchId: string }
  | { readonly kind: "bye" };

export interface Match {
  readonly matchId: string;
  readonly bracketId: string;
  readonly round: number;
  /** Position within the round, from the top of the bracket. */
  readonly slot: number;
  readonly a: MatchSlot;
  readonly b: MatchSlot;
  readonly bestOf: number;
  readonly gameIds: readonly string[];
  readonly winner?: string;
}

export interface Bracket {
  readonly bracketId: string;
  readonly seasonId: string;
  /** Round 0 first. Every round is a full power of two after byes. */
  readonly rounds: readonly (readonly Match[])[];
}

export type MatchDecidedBy = "score" | "seed";

export interface MatchOutcome {
  readonly matchId: string;
  readonly winner: string;
  readonly loser: string;
  readonly scoreA: number;
  readonly scoreB: number;
  readonly decidedBy: MatchDecidedBy;
}

// ---------------------------------------------------------------------------
// Phase 2: rivalries
// ---------------------------------------------------------------------------

export type HeadToHeadResult = "win" | "loss" | "draw";

/** One direction of a pair's history: `competitor` against `opponent`. */
export interface HeadToHead {
  readonly competitor: string;
  readonly opponent: string;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  /** Oldest first, capped by the aggregator. Traits read only this. */
  readonly recent: readonly HeadToHeadResult[];
  /** Game ids behind `recent`, same order. */
  readonly gameIds: readonly string[];
  /** Run of identical most recent results; 0 when there is no history. */
  readonly streak: number;
}

export type TraitCondition =
  | { readonly kind: "loss-streak"; readonly atLeast: number }
  | { readonly kind: "broke-loss-streak"; readonly atLeast: number };

/**
 * A trait rule is configuration, not code. It may only append to the playstyle
 * sentence and reorder strategies; budget, features and fallback are off limits
 * so the league keeps measuring decision quality rather than handicaps.
 */
export interface TraitRule {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly when: TraitCondition;
  readonly playstyleSuffix: string;
  /** Declared strategies pulled to the front, in this order. */
  readonly promote: readonly StrategyLabel[];
  /** Higher wins when the cap forces a choice. */
  readonly priority: number;
}

export interface Trait {
  readonly rule: string;
  readonly opponent: string;
  readonly reason: string;
  readonly gameIds: readonly string[];
}

/** A base manifest resolved against one opponent. Its version is a real hash. */
export interface ResolvedManifest {
  readonly manifest: CompetitorManifest;
  readonly baseVersion: string;
  readonly traits: readonly Trait[];
}

// ---------------------------------------------------------------------------
// Phase 2: adaptation between seasons
// ---------------------------------------------------------------------------

export interface PlaystyleChange {
  readonly from: string;
  readonly to: string;
}

export interface AdaptationResult {
  readonly competitor: string;
  /** The version the competitor went into the round with. */
  readonly fromVersion: string;
  readonly outcome: RevisionOutcome;
  readonly playstyle?: PlaystyleChange;
  readonly rationale: string;
}

// ---------------------------------------------------------------------------
// Phase 2: read views
// ---------------------------------------------------------------------------

export interface DashboardEntry {
  readonly gameId: string;
  readonly seasonId: string;
  readonly white: CompetitorRef;
  readonly black: CompetitorRef;
  readonly fen: Fen;
  readonly ply: number;
  readonly status: BroadcastStatus;
  readonly lastMove?: Uci;
  readonly strategy?: StrategyLabel;
  readonly confidence?: number;
  /** Trait ids active in this pairing, for the rivalry banner. */
  readonly rivalry: readonly string[];
  /** Ordering key: recent material swing, rivalry, and low confidence. */
  readonly interest: number;
}

export interface RivalrySummary {
  readonly headToHead: HeadToHead;
  readonly traits: readonly Trait[];
  /** Revealed games between the pair, oldest first. */
  readonly gameIds: readonly string[];
}

export interface CompetitorProfile {
  readonly competitor: string;
  readonly row: LeaderboardRow;
  readonly lineage: readonly CompetitorVersionRow[];
  readonly strategyMix: { readonly [key in StrategyLabel]?: StrategyStats };
  readonly calibration: CalibrationCurve;
  readonly rivals: readonly RivalrySummary[];
}

/**
 * Everything the read API needs, so handlers stay pure and the tests need no
 * database. The D1-backed implementation is the only thing that knows SQL.
 */
export interface ArenaStore {
  readonly game: (
    seasonId: string,
    gameId: string,
  ) => Promise<RecordedGame | undefined>;
  readonly games: (seasonId: string) => Promise<readonly RecordedGame[]>;
  readonly decisions: (
    seasonId: string,
    gameId: string,
  ) => Promise<readonly DecisionRecord[]>;
  readonly competitorDecisions: (
    competitor: string,
  ) => Promise<readonly DecisionRecord[]>;
  readonly versions: (
    competitor: string,
  ) => Promise<readonly CompetitorVersionRow[]>;
  readonly matches: (bracketId: string) => Promise<readonly Match[]>;
  readonly bracketSeason: (bracketId: string) => Promise<string | undefined>;
}

/** Body of the admin record request: a season plus when it goes on air. */
export interface RecordRequest {
  readonly config: SeasonConfig;
  readonly broadcast: BroadcastSchedule;
  /** Games recorded at once. Bounded by the provider's rate limit. */
  readonly concurrency: number;
  /**
   * Competitor name to the version its manifest descends from. Required for
   * any name already known with a different version, because a name is the
   * cross-season identity and may not be reused by an unrelated lineage. This
   * is how `lineageFrom` output reaches registration after adaptation.
   */
  readonly parents?: { readonly [competitor: string]: string };
  readonly rationales?: { readonly [competitor: string]: string };
}
