import { useState } from "react";

import { Board } from "./Board.tsx";
import { DecisionPanel } from "./DecisionPanel.tsx";
import type { BoardOrientation } from "./board-model.ts";
import { useSpectator } from "./use-spectator.ts";

const GAME_ID = (() => {
  const candidate = new URLSearchParams(window.location.search).get("game")?.trim();
  return candidate !== undefined && /^[A-Za-z0-9._:@-]+$/.test(candidate)
    ? candidate
    : "live";
})();

export function App() {
  const [orientation, setOrientation] = useState<BoardOrientation>("white");
  const { state, connection } = useSpectator(GAME_ID);
  const nextOrientation = orientation === "white" ? "black" : "white";

  return (
    <main className="arena-shell">
      <header className="masthead">
        <a className="wordmark" href={`/?game=${encodeURIComponent(GAME_ID)}`}>
          <span>System One</span>
          <strong>Chess Arena</strong>
        </a>
        <div className="broadcast-meta">
          <span className={`connection connection--${connection}`}>
            <i aria-hidden="true" />
            {connection === "live" ? "Live connection" : connection}
          </span>
          <span className="game-id">Game / {GAME_ID}</span>
        </div>
      </header>

      <section className="spectator-layout" aria-label="Live game spectator view">
        <div className="board-stage">
          <div className="board-toolbar">
            <p>
              <span>Position</span>
              <strong>{state.cursor === 0 ? "Opening board" : `After ply ${state.cursor}`}</strong>
            </p>
            <button
              type="button"
              onClick={() => setOrientation(nextOrientation)}
              aria-label={`Show board from ${nextOrientation}'s perspective`}
            >
              Flip board
            </button>
          </div>
          <Board
            fen={state.fen}
            orientation={orientation}
            lastMove={state.lastMove?.move}
          />
        </div>

        <aside className="analysis-rail">
          <p className="rail-intro">
            One move at a time. The arena reveals the engine’s choice, declared
            strategy, certainty and response time as each decision lands.
          </p>
          <DecisionPanel event={state.lastMove} finished={state.finished} />
          <p className="stream-note">
            The board updates automatically. Keep this window open; a dropped
            connection retries from ply {state.cursor}.
          </p>
        </aside>
      </section>
    </main>
  );
}
