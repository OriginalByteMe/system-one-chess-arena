import { useEffect, useMemo, useState } from "react";

import { Board } from "../Board.tsx";
import { Loading, Shell } from "../Shell.tsx";
import { apiPath, useJson } from "../api.ts";
import type { BoardOrientation } from "../board-model.ts";
import { percent, seconds, titleCase } from "../format.ts";
import { href } from "../route.ts";
import {
  NO_GUESSES,
  probabilityBars,
  recordGuess,
  scrub,
  settleGuess,
  type GuessState,
} from "../watch-model.ts";
import type {
  DecisionRecord,
  RevealedGame,
  RevealedMoves,
} from "../../../src/core/types.ts";

/** Poll interval. The server caches to the next ply boundary anyway. */
const POLL_MS = 1_000;

function GuessPanel({
  game,
  latest,
}: {
  readonly game: RevealedGame;
  readonly latest?: DecisionRecord;
}) {
  const [guesses, setGuesses] = useState<GuessState>(NO_GUESSES);
  const moves = useJson<RevealedMoves>(
    apiPath("seasons", game.seasonId, "games", game.gameId, "moves"),
    POLL_MS,
  );

  // Score the outstanding guess as soon as its ply is revealed. The model
  // ignores a guess whose ply does not match, so a late reveal cannot inflate
  // the hit rate, and settling the same decision twice counts once.
  useEffect(() => {
    if (latest === undefined) return;
    setGuesses((previous) => settleGuess(previous, latest));
  }, [latest?.gameId, latest?.ply]);

  const nextPly = (latest?.ply ?? game.decisions[0]?.ply ?? 1) + 1;
  const outstanding = guesses.ply === nextPly ? guesses.guess : undefined;

  if (game.outcome !== undefined) {
    return (
      <section className="guess-panel">
        <h2>Your guesses</h2>
        <p>
          {guesses.settled === 0
            ? "You did not guess on this game."
            : `${guesses.hits} of ${guesses.settled} right.`}
        </p>
      </section>
    );
  }

  return (
    <section className="guess-panel">
      <h2>Guess the next move</h2>
      <p className="page-note">
        Pick the move you think comes next at ply {nextPly}. Guesses live in this
        browser, so there is no account and nothing is shared.
      </p>
      <Loading loaded={moves}>
        {(data) => (
          <div className="guess-choices">
            {data.legalMoves.map((move) => (
              <button
                key={move}
                type="button"
                className={move === outstanding ? "guess guess--picked" : "guess"}
                onClick={() => setGuesses((previous) => recordGuess(previous, nextPly, move))}
              >
                {move}
              </button>
            ))}
          </div>
        )}
      </Loading>
      <p>
        {guesses.settled === 0
          ? "Nothing scored yet."
          : `${guesses.hits} of ${guesses.settled} right${
              guesses.lastCorrect === undefined
                ? ""
                : guesses.lastCorrect
                  ? ", last one right"
                  : ", last one wrong"
            }.`}
      </p>
    </section>
  );
}

/** Phase 2: a recorded game revealed on the broadcast clock. */
export function Watch({
  seasonId,
  gameId,
}: {
  readonly seasonId: string;
  readonly gameId: string;
}) {
  const loaded = useJson<RevealedGame>(
    apiPath("seasons", seasonId, "games", gameId),
    POLL_MS,
  );
  const [orientation, setOrientation] = useState<BoardOrientation>("white");
  const [scrubTo, setScrubTo] = useState<number | undefined>(undefined);

  const game = loaded.data;
  const live = game?.decisions.length ?? 0;
  // Following the broadcast means no explicit index: the frame is the live one.
  const frame = useMemo(
    () => (game === undefined ? undefined : scrub(game, scrubTo ?? live)),
    [game, scrubTo, live],
  );

  return (
    <Shell
      title={`${seasonId} / ${game === undefined ? "game" : `${game.white.name} vs ${game.black.name}`}`}
      meta={
        <span className={`connection connection--${game?.window.status ?? "connecting"}`}>
          <i aria-hidden="true" />
          {game === undefined ? "connecting" : titleCase(game.window.status)}
        </span>
      }
    >
      <Loading loaded={loaded}>
        {(data) => {
          const current = frame ?? scrub(data, live);
          const decision = current.decision;
          const bars = decision === undefined ? [] : probabilityBars(decision, 6);

          return (
            <section className="spectator-layout" aria-label="Broadcast game">
              <div className="board-stage">
                <div className="board-toolbar">
                  <p>
                    <span>Position</span>
                    <strong>
                      {current.index === 0
                        ? "Opening board"
                        : `After ply ${decision?.ply ?? current.index}`}
                    </strong>
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setOrientation(orientation === "white" ? "black" : "white")
                    }
                  >
                    Flip board
                  </button>
                </div>
                <Board
                  fen={current.fen}
                  orientation={orientation}
                  lastMove={decision?.move}
                />
                <div className="scrubber">
                  <input
                    type="range"
                    min={0}
                    max={live}
                    value={current.index}
                    aria-label="Scrub through the revealed moves"
                    onChange={(event) => setScrubTo(Number(event.target.value))}
                  />
                  <button type="button" onClick={() => setScrubTo(undefined)}>
                    Back to live
                  </button>
                  <span>
                    {current.index} of {live} revealed
                    {data.catchUp ? "" : ", catch-up closed while on air"}
                  </span>
                </div>
              </div>

              <aside className="analysis-rail">
                <p className="rail-intro">
                  {data.white.name} as white against {data.black.name}, opening{" "}
                  {data.openingId}. The server reveals one ply at a time; nothing
                  past the clock is in this page.
                </p>

                {decision === undefined ? (
                  <p className="page-note">
                    {data.window.status === "scheduled"
                      ? "This game has not gone on air yet."
                      : "Waiting for the first move."}
                  </p>
                ) : (
                  <section className="decision">
                    <h2>
                      Ply {decision.ply} · {decision.competitor}
                    </h2>
                    <dl>
                      <dt>Move</dt>
                      <dd>{decision.move}</dd>
                      <dt>Strategy</dt>
                      <dd>{titleCase(decision.strategy)}</dd>
                      <dt>Confidence</dt>
                      <dd>
                        {decision.confidence === undefined
                          ? "not stated"
                          : percent(decision.confidence)}
                      </dd>
                      <dt>Latency</dt>
                      <dd>{seconds(decision.latencyMs)}</dd>
                      <dt>Legal moves</dt>
                      <dd>{decision.legalMoveCount}</dd>
                      {decision.fallback === undefined ? null : (
                        <>
                          <dt>Fallback</dt>
                          <dd>{decision.fallback}</dd>
                        </>
                      )}
                    </dl>
                    <h3>What it considered</h3>
                    <ul className="bars">
                      {bars.map((bar) => (
                        <li key={bar.move} className={bar.chosen ? "bar bar--chosen" : "bar"}>
                          <span>{bar.move}</span>
                          <span
                            className="bar-fill"
                            style={{ width: `${Math.round(bar.probability * 100)}%` }}
                          />
                          <span>{percent(bar.probability)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {data.outcome === undefined ? (
                  <p className="stream-note">
                    The result is withheld until the broadcast finishes.
                  </p>
                ) : (
                  <p className="stream-note">
                    Final result: {data.outcome.result} by {data.outcome.reason.replace(/-/g, " ")}.
                  </p>
                )}

                <GuessPanel game={data} latest={data.decisions[live - 1]} />

                <p className="stream-note">
                  <a href={href({ kind: "dashboard", seasonId })}>All games</a>
                  {" · "}
                  <a href={href({ kind: "leaderboard", seasonId })}>Leaderboard</a>
                  {" · "}
                  <a href={href({ kind: "competitor", competitor: data.white.name })}>
                    {data.white.name}
                  </a>
                  {" · "}
                  <a href={href({ kind: "competitor", competitor: data.black.name })}>
                    {data.black.name}
                  </a>
                </p>
              </aside>
            </section>
          );
        }}
      </Loading>
    </Shell>
  );
}
