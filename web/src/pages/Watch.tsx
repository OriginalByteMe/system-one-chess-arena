// The broadcast: a season game shown either from the live socket, one ply as
// it lands, or - once it has been filed - from the recorded endpoint's
// spoiler-gated replay. Both sources feed the exact same UI: the walkout
// opens it, the board carries the currently-examined decision as weighted
// arrows, both minds sit on their own side of the screen with the moves they
// have played, and the aired scoresheet on the right is clickable, so a
// spectator can jump to any revealed decision instead of only watching it
// arrive.
import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { AnimatePresence, useReducedMotion } from "motion/react";

import { apiPath, useJson } from "../api.ts";
import { titleCase } from "../format.ts";
import { classifyStatus, viewFromLive, type BroadcastView } from "../live-model.ts";
import { href } from "../route.ts";
import { accentFor } from "../ui/accent.ts";
import { arrowsFor } from "../ui/board/arrows.ts";
import { BoardStage } from "../ui/board/BoardStage.tsx";
import { LivePill } from "../ui/chrome.tsx";
import { useSpectator } from "../use-spectator.ts";
import { useChessSound } from "../use-chess-sound.ts";
import { SITE } from "../site.ts";
import { BoardMark } from "./home/TopNav.tsx";
import {
  computeMoments,
  decisionAtIndex,
  latestForColour,
  replayDecisions,
  replayOpening,
  type Moment,
  type OpeningReplay,
} from "../watch-model.ts";
import { MindPanel, type PlayedMove } from "./watch/MindPanel.tsx";
import { TurnInspector } from "./watch/TurnInspector.tsx";
import { MoveHistory } from "./watch/MoveHistory.tsx";
import { StatusScreen } from "./watch/StatusScreen.tsx";
import { useCompetitorProfile } from "./watch/useCompetitorProfile.ts";
import { formatCountdown, useCountdown } from "./watch/useCountdown.ts";
import { WalkoutCard, type WalkoutPersona } from "./watch/WalkoutCard.tsx";
import type {
  CompetitorManifest,
  CompetitorProfile,
  CompetitorRef,
  RevealedGame,
} from "../../../src/core/types.ts";

/** The server caches every reveal to the next ply boundary, so this only ever wakes a cache hit until a boundary passes. */
const POLL_MS = 1_000;
const WALKOUT_MS = 3_800;
const WALKOUT_MS_REDUCED = 900;
const REPLAY_STEP_MS = 2_000;
const OPENING_NOTES: Readonly<Record<string, string>> = {
  "italian-game": "Both sides claim the centre, develop a knight, then bring out a bishop.",
  "queens-gambit": "White challenges Black’s central pawn. Black supports it, and both sides develop knights.",
  "sicilian-najdorf": "Black answers on the c-file. The centre opens, and both sides develop knights.",
  "kings-indian": "White builds a pawn centre while Black develops a bishop behind the g-pawn.",
  "london-system": "White brings the bishop out early, then supports the centre with pawns.",
};

function OpeningPanel({ name, colour, opening, bookPly, playstyle }: {
  readonly name: string;
  readonly colour: "white" | "black";
  readonly opening: OpeningReplay;
  readonly bookPly: number;
  readonly playstyle: string | undefined;
}): JSX.Element {
  return (
    <aside aria-label={`${titleCase(name)} opening`} className="rounded-xl border border-rail/60 bg-deck/70 p-3 lg:mt-16 lg:p-4">
      <h2 className="text-sm font-bold text-chalk lg:text-base">{titleCase(name)}</h2>
      <p className="mt-1 text-xs text-mist">{titleCase(colour)} · {opening.name}</p>
      {playstyle !== undefined && <p className="mt-2 text-xs leading-normal text-mist"><span className="sr-only lg:not-sr-only lg:font-semibold lg:text-chalk">Agent style: </span>{playstyle}</p>}
      <p className="mt-3 text-xs font-semibold text-brand">Prepared book moves</p>
      <ol aria-label={`${titleCase(colour)} opening moves`} className="mt-2 flex flex-wrap gap-1.5">
        {opening.moves.map((move, index) => index % 2 === (colour === "white" ? 0 : 1) ? (
          <li key={index} aria-current={index === bookPly - 1 ? "step" : undefined} aria-label={`${move.san}, ${index < bookPly ? "played" : "upcoming"}`} className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs ${index < bookPly ? "border-brand/60 bg-brand/15 text-chalk" : "border-rail text-mist"}`}>
            <span className="hidden lg:inline">{Math.floor(index / 2) + 1}.</span><strong>{move.san}</strong>
          </li>
        ) : null)}
      </ol>
    </aside>
  );
}

function manifestFor(profile: CompetitorProfile | undefined, version: string): CompetitorManifest | undefined {
  if (profile === undefined) return undefined;
  return profile.lineage.find((entry) => entry.version === version)?.manifest ?? profile.lineage.at(-1)?.manifest;
}

function personaFor(ref: CompetitorRef, profile: CompetitorProfile | undefined): WalkoutPersona {
  return {
    name: ref.name,
    accent: accentFor(ref.name),
    elo: profile?.row.elo,
    playstyle: manifestFor(profile, ref.version)?.playstyle,
  };
}

function Broadcast({
  seasonId: knownSeasonId,
  gameId,
}: {
  readonly seasonId: string | undefined;
  readonly gameId: string;
}): JSX.Element {
  const reduced = useReducedMotion() ?? false;

  const [finished, setFinished] = useState(false);
  const recordedPath = knownSeasonId === undefined ? undefined : apiPath("seasons", knownSeasonId, "games", gameId);
  const game = useJson<RevealedGame>(recordedPath, finished ? undefined : POLL_MS);

  useEffect(() => {
    if (game.data?.window.status === "finished") setFinished(true);
  }, [game.data?.window.status]);

  // A recorded row only exists once a game has been filed, which only
  // happens after it finishes, so the socket is only needed until one shows
  // up - and never at all once it has.
  const recorded = game.data;
  const liveSource = recorded === undefined && (knownSeasonId === undefined || !game.loading);
  const spectator = useSpectator(liveSource ? gameId : undefined);

  // Sticky once true: a drop after the board has shown a real position must
  // not blank the screen, even though `connection` itself can flap.
  const [everLive, setEverLive] = useState(false);
  useEffect(() => {
    if (spectator.connection === "live") setEverLive(true);
  }, [spectator.connection]);
  const hasLiveView = everLive || spectator.state.decisions.length > 0 || spectator.state.finished !== undefined;

  const view: BroadcastView | undefined = recorded ?? (hasLiveView ? viewFromLive(spectator.state, gameId) : undefined);
  // A live broadcast reaching its result must not restart as an archived replay.
  const [replayMode, setReplayMode] = useState<boolean | undefined>(undefined);
  const isReplay = replayMode ?? (recorded?.window.status === "finished" && !hasLiveView);
  useEffect(() => {
    if (view !== undefined && replayMode === undefined) setReplayMode(isReplay);
  }, [view, replayMode, isReplay]);

  const whiteProfile = useCompetitorProfile(view?.white?.name);
  const blackProfile = useCompetitorProfile(view?.black?.name);

  // Where a viewer without catch-up joined: the reveal count at first load.
  // A finished broadcast has catch-up, so it never needs one - and neither
  // does a live one, whose socket replays in full on every join.
  const [joinIndex, setJoinIndex] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (view !== undefined && joinIndex === undefined) {
      setJoinIndex(view.catchUp ? 0 : view.decisions.length);
    }
  }, [view, joinIndex]);

  const [explicitIndex, setExplicitIndex] = useState<number | undefined>(undefined);
  const [playing, setPlaying] = useState(true);
  const [hoveredMove, setHoveredMove] = useState<string | null>(null);
  const [walkoutDismissed, setWalkoutDismissed] = useState(false);
  const [resultDismissed, setResultDismissed] = useState(false);

  useEffect(() => {
    if (walkoutDismissed) return undefined;
    const id = window.setTimeout(() => setWalkoutDismissed(true), reduced ? WALKOUT_MS_REDUCED : WALKOUT_MS);
    return () => window.clearTimeout(id);
  }, [walkoutDismissed, reduced]);

  const decisions = view?.decisions ?? [];
  const aired = decisions.length;
  const catchUp = view?.catchUp ?? false;
  // The lower bound on rewinding, not on the live edge: a viewer always sees
  // the current position, they just cannot scrub earlier than this without
  // catch-up.
  const historyStart = catchUp || joinIndex === undefined ? 0 : Math.min(joinIndex, aired);

  const opening = useMemo(
    () => isReplay ? replayOpening(view?.openingId, decisions[0]?.fen) : undefined,
    [isReplay, view?.openingId, decisions[0]?.fen],
  );
  const bookLength = opening?.moves.length ?? 0;
  // Negative cursors are book frames; zero begins the saved agent decisions.
  const cursor = explicitIndex ?? (isReplay ? -bookLength : aired - 1);
  const bookPly = cursor + bookLength;
  const showingOpening = isReplay && cursor < 0;
  const examinedIndex = aired === 0 || showingOpening ? undefined : Math.min(Math.max(cursor, 0), aired - 1);
  const isLive = !isReplay && explicitIndex === undefined;
  const replayComplete = isReplay && cursor >= aired;
  const atFinalPosition = replayComplete || (isLive && view?.window.status === "finished");

  useEffect(() => {
    if (!isReplay || !playing || !walkoutDismissed || replayComplete) return undefined;
    const id = window.setTimeout(() => {
      setExplicitIndex((index) => Math.min((index ?? -bookLength) + 1, aired));
    }, REPLAY_STEP_MS);
    return () => window.clearTimeout(id);
  }, [isReplay, playing, walkoutDismissed, replayComplete, explicitIndex, aired, bookLength]);

  const replay = useMemo(() => replayDecisions(decisions), [decisions]);
  const activeDecision = examinedIndex === undefined ? undefined : decisionAtIndex(decisions, examinedIndex);
  const previousDecision =
    atFinalPosition ? activeDecision : examinedIndex === undefined || examinedIndex === 0 ? undefined : decisionAtIndex(decisions, examinedIndex - 1);
  const frameFen = showingOpening ? opening?.positions[bookPly] : atFinalPosition ? view?.fen : activeDecision?.fen ?? view?.fen;
  const bookLastMove = cursor <= 0 ? opening?.uciMoves[bookPly - 1] : undefined;
  const appliedMove = cursor <= 0 && bookLength > 0
    ? opening?.moves[bookPly - 1]
    : replay.moves[atFinalPosition ? aired - 1 : (examinedIndex ?? 0) - 1];
  const sound = useChessSound(frameFen, appliedMove?.isCheck ? "check" : appliedMove?.capturedRole !== undefined ? "capture" : "move");
  const moments = useMemo(() => computeMoments(decisions, replay.moves), [decisions, replay]);
  const momentByIndex = useMemo<ReadonlyMap<number, Moment>>(
    () => new Map(moments.map((moment) => [moment.index, moment] as const)),
    [moments],
  );
  const played = useMemo(() => {
    const white: PlayedMove[] = [];
    const black: PlayedMove[] = [];
    if (examinedIndex !== undefined) {
      decisions.slice(historyStart, examinedIndex + 1).forEach((decision, offset) => {
        const index = historyStart + offset;
        const entry: PlayedMove = {
          ply: decision.ply,
          index,
          san: replay.moves[index]?.san ?? decision.move,
          confidence: decision.confidence,
        };
        (decision.colour === "white" ? white : black).push(entry);
      });
    }
    return { white, black } as const;
  }, [decisions, examinedIndex, historyStart, replay]);

  const remainingMs = useCountdown(view?.window.nextBoundaryAt);

  if (view === undefined) {
    return (
      <StatusScreen
        variant={classifyStatus({
          hasSeasonId: knownSeasonId !== undefined,
          recordedError: game.error,
          spectatorConnection: spectator.connection,
          spectatorEverConnected: spectator.everConnected,
        })}
        message={game.error}
        seasonId={knownSeasonId}
      />
    );
  }

  const jumpToIndex = (index: number): void => {
    if (aired === 0) return;
    setPlaying(false);
    setExplicitIndex(Math.min(Math.max(index, isReplay ? -bookLength : historyStart), isReplay ? aired : aired - 1));
  };

  const data = view;
  const seasonId = knownSeasonId ?? data.seasonId;
  // A live game names only the mover of each decision, so a side that has
  // not played yet has no known identity until its first move lands.
  const whiteRef = data.white ?? { name: "white", version: "" };
  const blackRef = data.black ?? { name: "black", version: "" };
  const whiteAccent = accentFor(whiteRef.name);
  const blackAccent = accentFor(blackRef.name);

  const activeAccent = activeDecision === undefined ? undefined : (activeDecision.colour === "white" ? whiteAccent : blackAccent);
  const arrows = atFinalPosition || activeDecision === undefined || activeAccent === undefined ? [] : arrowsFor(activeDecision, activeAccent, "all");
  const nextMoverColour = activeDecision === undefined ? "white" : activeDecision.colour === "white" ? "black" : "white";

  const whiteDecision = examinedIndex === undefined ? undefined : latestForColour(decisions, examinedIndex, "white");
  const blackDecision = examinedIndex === undefined ? undefined : latestForColour(decisions, examinedIndex, "black");

  const whiteManifest = manifestFor(whiteProfile.data, whiteRef.version);
  const blackManifest = manifestFor(blackProfile.data, blackRef.version);
  const whiteRecord =
    whiteProfile.data === undefined
      ? undefined
      : {
          games: whiteProfile.data.row.games,
          wins: whiteProfile.data.row.wins,
          draws: whiteProfile.data.row.draws,
          losses: whiteProfile.data.row.losses,
        };
  const blackRecord =
    blackProfile.data === undefined
      ? undefined
      : {
          games: blackProfile.data.row.games,
          wins: blackProfile.data.row.wins,
          draws: blackProfile.data.row.draws,
          losses: blackProfile.data.row.losses,
        };

  const showWalkout = !walkoutDismissed;
  const showResult = data.outcome !== undefined && !resultDismissed && !showWalkout && atFinalPosition;
  // Honesty about the connection: a recorded broadcast reports its own fetch
  // errors as before, while a live one reports the socket's own state - and
  // never once the game is over, since a closed socket after a result is
  // expected, not a drop.
  const reconnecting = liveSource
    ? spectator.connection === "offline" && data.window.status !== "finished"
    : game.error !== undefined;

  return (
    <div className="relative flex min-h-dvh w-full min-w-0 flex-col overflow-x-clip bg-void text-chalk">
      <header className="relative z-20 border-b border-rail/70 bg-void">
        <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-3 px-3 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <a href={href({ kind: "home" })} className="flex shrink-0 items-center gap-2">
              <BoardMark size={20} />
              <span className="text-sm leading-none font-extrabold text-chalk">{SITE.name}</span>
            </a>
            <span className="h-5 w-px shrink-0 bg-rail" aria-hidden="true" />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-chalk">
                {titleCase(whiteRef.name)} <span className="font-medium text-mist">vs</span>{" "}
                {titleCase(blackRef.name)}
              </p>
              <p className="truncate text-[11px] text-mist">
                {data.openingId === undefined ? `Game ${gameId}` : titleCase(data.openingId)}
              </p>
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {data.window.status === "on-air" ? (
              <LivePill />
            ) : (
              <span className="text-xs font-semibold text-mist">
                {isReplay ? "Replay" : data.window.status === "finished" ? "Finished" : "Scheduled"}
              </span>
            )}
            {reconnecting && <span className="text-xs text-mist">Reconnecting…</span>}
            <button
              type="button"
              aria-label={sound.enabled ? "Mute chess sounds" : "Enable chess sounds"}
              aria-pressed={sound.enabled}
              disabled={!sound.available}
              title={sound.available ? undefined : "Chess sounds are unavailable in this browser"}
              onClick={sound.toggle}
              className="inline-flex min-h-11 items-center rounded-lg border border-rail px-3 text-sm font-semibold text-mist hover:bg-rail disabled:cursor-not-allowed disabled:opacity-40"
            >
              Sound {sound.enabled ? "on" : "off"}
            </button>
            {sound.error === undefined ? null : <span role="alert" className="text-xs text-mist">{sound.error}</span>}
            <span className="hidden h-4 w-px bg-rail sm:block" aria-hidden="true" />
            {seasonId !== undefined && (
              <a
                href={href({ kind: "season", seasonId })}
                className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-mist transition-colors hover:bg-rail hover:text-chalk"
              >
                All games
              </a>
            )}
            {(isReplay ? !replayComplete : !isLive) && (
              <button
                type="button"
                onClick={() => {
                  setExplicitIndex(isReplay ? aired : undefined);
                  setPlaying(false);
                }}
                className="inline-flex min-h-11 items-center rounded-lg bg-brand px-3 text-sm font-bold text-void transition-colors hover:bg-brand-hi"
              >
                {isReplay ? "Skip to end" : data.window.status === "finished" ? "Latest turn" : "Back to live"}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto grid w-full max-w-[1500px] flex-1 grid-cols-2 gap-4 px-3 py-4 sm:px-5 lg:grid-cols-[minmax(14rem,17rem)_minmax(28rem,44rem)_minmax(14rem,17rem)] lg:items-start lg:justify-center lg:px-6">
        <div className={`${showingOpening ? "order-1" : "order-3 col-span-2"} min-w-0 lg:order-1 lg:col-span-1 lg:col-start-1 lg:row-start-1`}>
          {showingOpening && opening !== undefined ? (
            <OpeningPanel name={whiteRef.name} colour="white" opening={opening} bookPly={bookPly} playstyle={whiteManifest?.playstyle} />
          ) : (
          <MindPanel
            name={whiteRef.name}
            accent={whiteAccent}
            colour="white"
            side="left"
            elo={whiteProfile.data?.row.elo}
            record={whiteRecord}
            meanLatencyMs={whiteProfile.data?.row.meanLatencyMs}
            manifest={whiteManifest}
            decision={whiteDecision}
            live={activeDecision?.colour === "white"}
            thinking={data.window.status === "on-air" && isLive && nextMoverColour === "white"}
            played={played.white}
            hoveredMove={hoveredMove}
            onHoverMove={setHoveredMove}
            onJumpToIndex={jumpToIndex}
            reduced={reduced}
          />
          )}
        </div>

        <section
          className={`${showingOpening ? "order-3" : "order-1"} col-span-2 flex min-w-0 flex-col items-center gap-3 lg:order-2 lg:col-span-1 lg:col-start-2 lg:row-start-1`}
          aria-label="Broadcast board"
        >
          <div className="w-full max-w-[44rem]">
            <BoardStage
              fen={frameFen ?? data.fen}
              lastMove={previousDecision?.move ?? bookLastMove}
              lastMoveAccent={
                previousDecision === undefined
                  ? bookLastMove === undefined ? undefined : bookPly % 2 === 1 ? whiteAccent : blackAccent
                  : previousDecision.colour === "white"
                    ? whiteAccent
                    : blackAccent
              }
              arrows={arrows}
              flight={null}
              hoveredMove={hoveredMove}
              onHoverMove={setHoveredMove}
              reducedMotion={reduced}
            />
          </div>

          <div className="flex w-full max-w-[44rem] flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border border-rail/70 bg-deck px-3 py-2.5 text-sm text-mist">
            <span className="font-semibold text-chalk">
              {showingOpening
                ? `Book opening · ${opening?.name} · ${bookPly} / ${bookLength}`
                : activeDecision === undefined
                ? data.window.status === "scheduled"
                  ? "This broadcast has not gone on air yet."
                  : "Waiting for the first move."
                : `Examining ply ${activeDecision.ply}`}
            </span>
            {data.window.status !== "finished" && remainingMs !== undefined && (
              <span className="tabular">
                {data.window.status === "scheduled" ? "First move in " : "Next move in "}
                {remainingMs <= 250 ? "revealing…" : formatCountdown(remainingMs)}
              </span>
            )}
            {data.window.status === "finished" && <span>{isReplay ? replayComplete ? "Replay complete" : playing ? "Playing replay" : "Replay paused" : "Broadcast complete"}</span>}
          </div>
          {showingOpening ? (
            <p className="w-full max-w-[44rem] text-sm leading-relaxed text-mist">{OPENING_NOTES[data.openingId ?? ""]} These moves are pre-set, not chosen by Jev. Probability arrows and stats begin with agent decisions.</p>
          ) : isReplay && bookLength === 0 && (decisions[0]?.ply ?? 0) > 0 ? (
            <p className="w-full max-w-[44rem] text-sm text-mist">Opening moves are unavailable for this recording. Playback starts at the saved position.</p>
          ) : null}

          {isReplay && (
            <div className="flex w-full max-w-[44rem] gap-2" role="group" aria-label="Replay playback">
              <button
                type="button"
                disabled={replayComplete}
                onClick={() => setPlaying((value) => !value)}
                className="min-h-11 flex-1 rounded-lg bg-brand px-4 text-sm font-bold text-void hover:bg-brand-hi disabled:cursor-not-allowed disabled:opacity-40"
              >
                {playing && !replayComplete ? "Pause replay" : "Play replay"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setExplicitIndex(-bookLength);
                  setResultDismissed(false);
                  setPlaying(true);
                }}
                className="min-h-11 rounded-lg border border-rail px-4 text-sm font-semibold text-chalk hover:bg-rail"
              >
                Restart replay
              </button>
            </div>
          )}

          <div
            className="grid w-full max-w-[44rem] grid-cols-[1fr_auto_1fr] items-center gap-2"
            role="group"
            aria-label="Navigate turns"
          >
            <button
              type="button"
              disabled={isReplay ? cursor <= -bookLength : examinedIndex === undefined || examinedIndex <= historyStart}
              onClick={() => jumpToIndex(cursor - 1)}
              className="min-h-11 rounded-lg border border-rail px-3 text-sm font-semibold text-chalk transition-colors hover:bg-rail disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous turn
            </button>
            <span className="tabular min-w-12 text-center text-xs text-mist">
              {isReplay ? `${cursor + bookLength} / ${aired + bookLength} moves` : examinedIndex === undefined ? "No moves yet" : `${examinedIndex + 1} / ${aired}`}
            </span>
            <button
              type="button"
              disabled={isReplay ? replayComplete : examinedIndex === undefined || examinedIndex >= aired - 1}
              onClick={() => jumpToIndex(cursor + 1)}
              className="min-h-11 rounded-lg border border-rail px-3 text-sm font-semibold text-chalk transition-colors hover:bg-rail disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next turn
            </button>
          </div>

          {activeDecision !== undefined && (
            <p className="w-full max-w-[44rem] text-center text-xs leading-relaxed text-mist">
              Each arrow is a move {titleCase(activeDecision.competitor)} weighed here: thicker and brighter the
              more probability it carried, six heaviest shown. The one in its own colour is what it played.
            </p>
          )}
        </section>

        <div className={`${showingOpening ? "order-2" : "order-4 col-span-2"} min-w-0 lg:order-3 lg:col-span-1 lg:col-start-3 lg:row-start-1`}>
          {showingOpening && opening !== undefined ? (
            <OpeningPanel name={blackRef.name} colour="black" opening={opening} bookPly={bookPly} playstyle={blackManifest?.playstyle} />
          ) : (
          <MindPanel
            name={blackRef.name}
            accent={blackAccent}
            colour="black"
            side="right"
            elo={blackProfile.data?.row.elo}
            record={blackRecord}
            meanLatencyMs={blackProfile.data?.row.meanLatencyMs}
            manifest={blackManifest}
            decision={blackDecision}
            live={activeDecision?.colour === "black"}
            thinking={data.window.status === "on-air" && isLive && nextMoverColour === "black"}
            played={played.black}
            hoveredMove={hoveredMove}
            onHoverMove={setHoveredMove}
            onJumpToIndex={jumpToIndex}
            reduced={reduced}
          />
          )}
        </div>

        <div className={`${showingOpening ? "order-4" : "order-2"} col-span-2 flex min-h-[18rem] max-h-[24rem] min-w-0 flex-col lg:order-4 lg:col-span-1 lg:col-start-1 lg:row-start-2`}>
          <MoveHistory
            decisions={decisions}
            moves={replay.moves}
            historyStart={historyStart}
            activeIndex={examinedIndex}
            momentByIndex={momentByIndex}
            whiteAccent={whiteAccent}
            blackAccent={blackAccent}
            onJumpToIndex={jumpToIndex}
            catchUp={catchUp}
          />
        </div>

        <div className="order-5 col-span-2 min-w-0 lg:order-5 lg:col-start-2 lg:row-start-2">
          <TurnInspector decision={activeDecision} accent={activeAccent} />
        </div>
      </main>

      <AnimatePresence>
        {showWalkout && (
          <WalkoutCard
            kind="walkout"
            white={personaFor(whiteRef, whiteProfile.data)}
            black={personaFor(blackRef, blackProfile.data)}
            seasonId={seasonId}
            gameId={gameId}
            reduced={reduced}
            onSkip={() => setWalkoutDismissed(true)}
          />
        )}
        {showResult && data.outcome !== undefined && (
          <WalkoutCard
            kind="result"
            white={personaFor(whiteRef, whiteProfile.data)}
            black={personaFor(blackRef, blackProfile.data)}
            result={data.outcome.result}
            reason={data.outcome.reason}
            plies={aired}
            adjudicatedCp={data.outcome.adjudicatedCp}
            reduced={reduced}
            onSkip={() => setResultDismissed(true)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export function Watch({ seasonId, gameId }: { readonly seasonId: string; readonly gameId: string }): JSX.Element {
  return <Broadcast key={gameId} seasonId={seasonId} gameId={gameId} />;
}

/** The same broadcast, watched from `/live/<gameId>` before any season is known. */
export function LiveBroadcast({ gameId }: { readonly gameId: string }): JSX.Element {
  return <Broadcast key={gameId} seasonId={undefined} gameId={gameId} />;
}
