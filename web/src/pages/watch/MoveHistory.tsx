// The clickable spine of the broadcast: every aired move, paired the way a
// scoresheet pairs them, each cell jumping the board to the decision behind
// it. Cells carry the flags the moment detector raised, so scanning the
// column finds the interesting plies without playing through the whole
// window. Arrow keys move a ply at a time without leaving the keyboard.
import { useEffect, useMemo, useRef } from "react";
import type { JSX, KeyboardEvent } from "react";

import type { DecisionRecord } from "../../../../src/core/types.ts";
import { titleCase } from "../../format.ts";
import { MOMENT_LABEL, type Moment, type MomentKind, type MoveMeta } from "../../watch-model.ts";

// One quiet colour per flag the moment detector raises, so a column of moves
// can be scanned for the interesting plies without emoji noise.
const MOMENT_DOT: Readonly<Record<MomentKind, string>> = {
  audible: "#7c8cff",
  capture: "#ff5ecb",
  lowConfidence: "#ffb020",
  slow: "#8b93ad",
};

const MOMENT_ORDER: readonly MomentKind[] = ["audible", "capture", "lowConfidence", "slow"];

export interface MoveHistoryProps {
  readonly decisions: readonly DecisionRecord[];
  readonly moves: readonly MoveMeta[];
  /** The earliest index a viewer without catch-up may scrub back to. */
  readonly historyStart: number;
  readonly activeIndex: number | undefined;
  readonly momentByIndex: ReadonlyMap<number, Moment>;
  readonly whiteAccent: string;
  readonly blackAccent: string;
  readonly onJumpToIndex: (index: number) => void;
  readonly catchUp: boolean;
}

interface Cell {
  readonly index: number;
  readonly san: string;
  readonly decision: DecisionRecord;
}

interface Row {
  readonly moveNumber: number;
  readonly white: Cell | undefined;
  readonly black: Cell | undefined;
}

function buildRows(decisions: readonly DecisionRecord[], moves: readonly MoveMeta[], historyStart: number): readonly Row[] {
  const byNumber = new Map<number, { white?: Cell; black?: Cell }>();
  for (let index = historyStart; index < decisions.length; index += 1) {
    const decision = decisions[index];
    if (decision === undefined) continue;
    const moveNumber = Math.ceil(decision.ply / 2);
    const row = byNumber.get(moveNumber) ?? {};
    const cell: Cell = { index, san: moves[index]?.san ?? decision.move, decision };
    byNumber.set(moveNumber, decision.colour === "white" ? { ...row, white: cell } : { ...row, black: cell });
  }
  return [...byNumber.entries()]
    .sort(([a], [b]) => a - b)
    .map(([moveNumber, sides]) => ({ moveNumber, white: sides.white, black: sides.black }));
}

function MoveCell({
  cell,
  accent,
  active,
  moment,
  onJumpToIndex,
  onKeyStep,
  buttonRef,
}: {
  readonly cell: Cell | undefined;
  readonly accent: string;
  readonly active: boolean;
  readonly moment: Moment | undefined;
  readonly onJumpToIndex: (index: number) => void;
  readonly onKeyStep: (event: KeyboardEvent<HTMLButtonElement>, index: number) => void;
  readonly buttonRef: (index: number, el: HTMLButtonElement | null) => void;
}): JSX.Element {
  if (cell === undefined) {
    return <span className="px-2 py-2.5 text-xs text-mist/40">—</span>;
  }
  const flags = moment?.kinds ?? [];
  return (
    <button
      ref={(el) => buttonRef(cell.index, el)}
      type="button"
      onClick={() => onJumpToIndex(cell.index)}
      onKeyDown={(event) => onKeyStep(event, cell.index)}
      aria-current={active ? "step" : undefined}
      title={`Ply ${cell.decision.ply} · ${cell.decision.strategy}${
        moment === undefined ? "" : ` · ${moment.headline}`
      }`}
      className="flex min-h-11 w-full items-center justify-between gap-1 rounded-md px-2 py-2 text-left transition-colors outline-none hover:bg-rail/60 focus-visible:ring-1 focus-visible:ring-chalk"
      style={active ? { backgroundColor: `${accent}22`, boxShadow: `inset 0 0 0 1px ${accent}88` } : undefined}
    >
      <span className="tabular truncate text-xs font-semibold" style={{ color: active ? accent : "var(--color-chalk)" }}>
        {cell.san}
      </span>
      {flags.length > 0 && (
        <span className="flex shrink-0 items-center gap-[2px]" aria-hidden="true">
          {flags.map((kind) => (
            <span key={kind} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: MOMENT_DOT[kind] }} />
          ))}
        </span>
      )}
      {flags.length > 0 && <span className="sr-only">{flags.map((kind) => MOMENT_LABEL[kind]).join(", ")}</span>}
    </button>
  );
}

export function MoveHistory({
  decisions,
  moves,
  historyStart,
  activeIndex,
  momentByIndex,
  whiteAccent,
  blackAccent,
  onJumpToIndex,
  catchUp,
}: MoveHistoryProps): JSX.Element {
  const rows = useMemo(() => buildRows(decisions, moves, historyStart), [decisions, moves, historyStart]);
  const scroller = useRef<HTMLDivElement | null>(null);
  const activeRow = useRef<HTMLDivElement | null>(null);
  const buttons = useRef(new Map<number, HTMLButtonElement>());

  useEffect(() => {
    const row = activeRow.current;
    const box = scroller.current;
    if (row === null || box === null) return;
    const top = row.offsetTop - box.clientHeight / 2 + row.clientHeight / 2;
    box.scrollTo({ top: Math.max(top, 0), behavior: "smooth" });
  }, [activeIndex]);

  const setButtonRef = (index: number, el: HTMLButtonElement | null): void => {
    if (el === null) buttons.current.delete(index);
    else buttons.current.set(index, el);
  };

  const handleKeyStep = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
      return;
    }
    event.preventDefault();
    const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? index + 1 : index - 1;
    const target = Math.min(Math.max(step, historyStart), decisions.length - 1);
    onJumpToIndex(target);
    requestAnimationFrame(() => buttons.current.get(target)?.focus());
  };

  const firstPly = decisions[historyStart]?.ply;

  return (
    <section className="flex h-full min-h-0 flex-col rounded-xl border border-rail/70 bg-deck" aria-label="Move history">
      <header className="flex shrink-0 items-baseline justify-between gap-2 border-b border-rail/60 px-3 py-3">
        <h2 className="font-display text-base leading-none font-bold text-chalk">Move history</h2>
        <span className="tabular shrink-0 text-xs font-semibold text-mist">
          {decisions.length - historyStart} aired
        </span>
      </header>

      <div className="grid shrink-0 grid-cols-[2.25rem_minmax(0,1fr)_minmax(0,1fr)] gap-1 border-b border-rail/40 px-2 py-2 text-[10px] font-semibold tracking-wide text-mist uppercase">
        <span>#</span>
        <span>White</span>
        <span>Black</span>
      </div>

      <div ref={scroller} className="no-scrollbar relative min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
        {rows.length === 0 ? (
          <p className="px-2 py-5 text-center text-sm text-mist">
            {decisions.length === 0 ? "Nothing aired yet." : "Nothing has aired since you joined yet."}
          </p>
        ) : (
          rows.map((row) => {
            const isActive = row.white?.index === activeIndex || row.black?.index === activeIndex;
            return (
              <div
                key={row.moveNumber}
                ref={isActive ? activeRow : null}
                className="grid grid-cols-[2.25rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-1"
              >
                <span className="tabular pl-1 text-[10px] text-mist">{row.moveNumber}.</span>
                <MoveCell
                  cell={row.white}
                  accent={whiteAccent}
                  active={row.white?.index === activeIndex}
                  moment={row.white === undefined ? undefined : momentByIndex.get(row.white.index)}
                  onJumpToIndex={onJumpToIndex}
                  onKeyStep={handleKeyStep}
                  buttonRef={setButtonRef}
                />
                <MoveCell
                  cell={row.black}
                  accent={blackAccent}
                  active={row.black?.index === activeIndex}
                  moment={row.black === undefined ? undefined : momentByIndex.get(row.black.index)}
                  onJumpToIndex={onJumpToIndex}
                  onKeyStep={handleKeyStep}
                  buttonRef={setButtonRef}
                />
              </div>
            );
          })
        )}
      </div>

      <div className="shrink-0 border-t border-rail/60 px-3 py-2.5">
        <ul className="flex flex-wrap gap-x-2 gap-y-0.5">
          {MOMENT_ORDER.map((kind) => (
            <li key={kind} className="flex items-center gap-1.5 text-[10px] text-mist">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: MOMENT_DOT[kind] }} aria-hidden="true" />
              {titleCase(MOMENT_LABEL[kind])}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs leading-snug text-mist">
          {!catchUp && firstPly !== undefined && <>Broadcast joins at move {Math.ceil(firstPly / 2)} · </>}
          {catchUp
            ? "Complete game"
            : firstPly === undefined
              ? "Rewind is limited to what has aired since you joined"
              : "rewind is limited to what has aired since you joined"}
        </p>
      </div>
    </section>
  );
}
