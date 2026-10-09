// A game against a persona, played by whichever model is loaded on this device.
// The page owns nothing of the league: nothing here is recorded, rated or sent
// anywhere, and the persona is only the brief the local model is handed.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, JSX } from "react";

import { createSystemClock } from "../../../../src/core/clock.ts";
import { buildPositionInput } from "../../../../src/core/position-input.ts";
import { createRng } from "../../../../src/core/rng.ts";
import {
  applyMove,
  initialPosition,
  legalMoves,
  terminalState,
  toSan,
  type Position,
} from "../../../../src/core/rules.ts";
import type { Colour, CompetitorManifest } from "../../../../src/core/types.ts";
import { ROSTER } from "../../../../src/players/roster.ts";
import { accentFor } from "../../ui/accent.ts";
import { MiniBoard } from "../../ui/board/MiniBoard.tsx";
import { Card, CardHead } from "../../ui/chrome.tsx";
import { decideLocally, type Asker, type LocalDecision } from "../../local/decide.ts";
import { LAB_MAX_PLIES, parseMoveInput, sanFor } from "../../local/game.ts";

interface Played {
  readonly decision: LocalDecision;
  readonly san: string;
  /** SAN for every move the model put probability on, from the position it saw. */
  readonly names: ReadonlyMap<string, string>;
  readonly persona: string;
  readonly ply: number;
}

function manifest(name: string): CompetitorManifest {
  const fields = ROSTER.find((entry) => entry.name === name) ?? ROSTER[0];
  if (fields === undefined) throw new Error("the roster is empty");
  return { ...fields, version: "local" };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
}

/** "1. e4 e5 2. Nf3" from the position's SAN history. */
function moveList(position: Position): string {
  const parts: string[] = [];
  position.history.forEach((san, index) => {
    parts.push(index % 2 === 0 ? `${index / 2 + 1}. ${san}` : san);
  });
  return parts.join(" ");
}

function describeResult(position: Position, you: Colour): string | undefined {
  const end = terminalState(position, LAB_MAX_PLIES);
  if (end === undefined) return undefined;
  const reason = end.reason.replaceAll("-", " ");
  if (end.result === "draw") return `Draw by ${reason}.`;
  return end.result === you ? `You win by ${reason}.` : `The model wins by ${reason}.`;
}

export function LabBoard({
  asker,
  tierLabel,
}: {
  readonly asker: Asker;
  readonly tierLabel: string;
}): JSX.Element {
  const [persona, setPersona] = useState<string>(ROSTER[0]?.name ?? "");
  const [you, setYou] = useState<Colour>("white");
  const [position, setPosition] = useState<Position>(initialPosition);
  const [lastMove, setLastMove] = useState<string | undefined>(undefined);
  const [thinking, setThinking] = useState(false);
  const [played, setPlayed] = useState<Played | undefined>(undefined);
  const [typed, setTyped] = useState("");
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const persona_ = useMemo(() => manifest(persona), [persona]);
  const result = describeResult(position, you);
  const modelToMove = result === undefined && position.turn !== you;
  const legal = useMemo(() => legalMoves(position), [position]);
  const suggestions = useMemo(() => legal.map((move) => toSan(position, move)), [legal, position]);

  const newGame = useCallback((): void => {
    setPosition(initialPosition());
    setLastMove(undefined);
    setPlayed(undefined);
    setThinking(false);
    setProblem(undefined);
    setTyped("");
  }, []);

  // The model's turn: ask it, then play what it chose. Any change to the game
  // (a new game, another persona) changes `position`, which cancels the answer
  // to the old one before it can land.
  useEffect(() => {
    if (!modelToMove) return;
    let cancelled = false;
    setThinking(true);
    const input = buildPositionInput({
      seasonId: "lab",
      gameId: "lab",
      position,
      persona: persona_,
      ...(lastMove === undefined ? {} : { lastMove }),
    });
    void decideLocally(input, asker, createSystemClock(), createRng(`lab:${position.fen}`)).then((local) => {
      if (cancelled) return;
      const { move, distribution } = local.decision;
      setPlayed({
        decision: local,
        san: toSan(position, move),
        names: sanFor(position, [move, ...Object.keys(distribution ?? {})]),
        persona: persona_.name,
        ply: position.ply,
      });
      setPosition(applyMove(position, move));
      setLastMove(move);
      setThinking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [modelToMove, position, persona_, lastMove, asker]);

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (modelToMove || result !== undefined) return;
    const move = parseMoveInput(position, typed);
    if (move === undefined) {
      setProblem(`"${typed.trim()}" is not a legal move here. Try something like e4, Nf3 or O-O.`);
      return;
    }
    setProblem(undefined);
    setTyped("");
    setPosition(applyMove(position, move));
    setLastMove(move);
  }

  function changePersona(name: string): void {
    setPersona(name);
    newGame();
  }

  function changeSide(side: Colour): void {
    setYou(side);
    newGame();
  }

  const entries = played === undefined ? [] : Object.entries(played.decision.decision.distribution ?? {});
  entries.sort(([, a], [, b]) => b - a);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <MiniBoard
          fen={position.fen}
          orientation={you}
          moverAccent={accentFor(position.turn === you ? persona_.name : "you")}
          {...(lastMove === undefined ? {} : { lastMove })}
        />
        <p className="sr-only">
          Position {position.fen}. {position.turn} to move.
        </p>
        <p className="min-h-5 text-sm leading-relaxed text-mist">{moveList(position)}</p>

        <form onSubmit={submit} className="flex flex-col gap-2">
          <label htmlFor="lab-move" className="text-sm font-semibold text-chalk">
            Your move
          </label>
          <div className="flex gap-2">
            <input
              id="lab-move"
              list="lab-moves"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              disabled={modelToMove || result !== undefined}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder={modelToMove ? "The model is moving" : "e4, Nf3, O-O or g1f3"}
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-rail bg-pit px-3 text-chalk placeholder:text-mist disabled:opacity-60"
            />
            <datalist id="lab-moves">
              {suggestions.map((san) => (
                <option key={san} value={san} />
              ))}
            </datalist>
            <button
              type="submit"
              disabled={modelToMove || result !== undefined || typed.trim() === ""}
              className="min-h-11 rounded-lg bg-brand px-5 text-sm font-bold text-void transition-colors hover:bg-brand-hi disabled:cursor-not-allowed disabled:opacity-50"
            >
              Play
            </button>
          </div>
          <p role="status" aria-live="polite" className="min-h-5 text-sm text-mist">
            {problem ?? (result !== undefined ? result : thinking ? `${tierLabel} is thinking…` : "")}
          </p>
        </form>
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        <Card>
          <CardHead title="Opponent" />
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1 text-sm font-semibold text-chalk">
                Persona
                <select
                  value={persona}
                  onChange={(event) => changePersona(event.target.value)}
                  className="min-h-11 rounded-lg border border-rail bg-deck px-3 font-normal text-chalk"
                >
                  {ROSTER.map((entry) => (
                    <option key={entry.name} value={entry.name}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold text-chalk">
                You play
                <select
                  value={you}
                  onChange={(event) => changeSide(event.target.value === "black" ? "black" : "white")}
                  className="min-h-11 rounded-lg border border-rail bg-deck px-3 font-normal text-chalk"
                >
                  <option value="white">White</option>
                  <option value="black">Black</option>
                </select>
              </label>
              <button
                type="button"
                onClick={newGame}
                className="mt-auto min-h-11 rounded-lg border border-rail px-4 text-sm font-semibold text-chalk transition-colors hover:border-mist hover:bg-deck"
              >
                New game
              </button>
            </div>
            <p className="text-[15px] leading-relaxed text-mist">
              <span className="font-semibold text-chalk">The brief the model is given: </span>
              {persona_.playstyle}
            </p>
          </div>
        </Card>

        <Card>
          <CardHead
            title="Latest decision"
            meta={played === undefined ? null : <span>ply {played.ply + 1}</span>}
          />
          {played === undefined ? (
            <p className="text-[15px] leading-relaxed text-mist">
              {you === "white"
                ? "Make your move. The model's answer appears here with the probabilities it put on each option."
                : "The model plays first. Its answer appears here."}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {played.decision.decision.fallback === undefined ? null : (
                <p role="alert" className="rounded-lg border border-live px-3 py-2 text-sm text-chalk">
                  The model's answer could not be used ({played.decision.decision.fallback}
                  {played.decision.detail === undefined ? "" : `: ${played.decision.detail}`}), so the persona's
                  fallback ({persona_.fallback}) chose this move instead.
                </p>
              )}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
                <Fact label="Move" value={played.san} strong />
                <Fact label="Strategy" value={played.decision.decision.strategy} />
                <Fact
                  label="Confidence"
                  value={
                    played.decision.decision.confidence === undefined
                      ? "none"
                      : percent(played.decision.decision.confidence)
                  }
                />
                <Fact label="Time" value={`${(played.decision.decision.latencyMs / 1000).toFixed(1)} s`} />
              </dl>

              {entries.length === 0 ? null : (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold text-chalk">Where the model put its probability</h3>
                  <ul className="flex flex-col gap-1.5">
                    {entries.map(([move, probability]) => (
                      <li key={move} className="grid grid-cols-[4.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-sm">
                        <span className="font-mono text-chalk">{played.names.get(move) ?? move}</span>
                        <span className="h-2 overflow-hidden rounded-full bg-deck" aria-hidden="true">
                          <span className="block h-full rounded-full bg-brand" style={{ width: `${probability * 100}%` }} />
                        </span>
                        <span className="text-right text-mist">{percent(probability)}</span>
                      </li>
                    ))}
                  </ul>
                  {played.decision.tailMass === undefined ? null : (
                    <p className="text-xs leading-relaxed text-mist">
                      These are the model's top options, renormalised to 100%.{" "}
                      {percent(played.decision.tailMass)} of its raw probability fell outside them. Unlike Jev, a
                      browser model reports at most its top five.
                    </p>
                  )}
                </div>
              )}
              <p className="text-xs text-mist">
                {tierLabel} · {played.decision.calls} model call{played.decision.calls === 1 ? "" : "s"} · played as{" "}
                {played.persona}
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Fact({
  label,
  value,
  strong = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly strong?: boolean;
}): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-mist">{label}</dt>
      <dd className={`truncate ${strong ? "text-lg font-bold" : "font-semibold"} text-chalk`}>{value}</dd>
    </div>
  );
}
