import type { MoveEvent, ResultEvent } from "../../src/core/types.ts";
import { formatDecision } from "./decision-model.ts";

interface DecisionPanelProps {
  readonly event?: MoveEvent;
  readonly finished?: ResultEvent;
}

export function DecisionPanel({ event, finished }: DecisionPanelProps) {
  const decision = formatDecision(event);

  return (
    <section className="decision-sheet" aria-labelledby="decision-heading">
      <div className="decision-heading-row">
        <h2 id="decision-heading">Latest decision</h2>
        <span className="ply-marker">{decision.ply}</span>
      </div>

      <div className="move-block">
        <span className="field-label">Move</span>
        <strong className="move-value">{decision.move}</strong>
        <span className="competitor-name">{decision.competitor}</span>
      </div>

      <dl className="decision-facts">
        <div>
          <dt>Strategy</dt>
          <dd>{decision.strategy}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{decision.confidence}</dd>
        </div>
        <div>
          <dt>Latency</dt>
          <dd>{decision.latency}</dd>
        </div>
      </dl>

      <div className={`result-line${finished === undefined ? " result-line--waiting" : ""}`}>
        <span>{finished === undefined ? "Game in progress" : "Final result"}</span>
        <strong>
          {finished === undefined
            ? "Waiting for the next move"
            : `${finished.result} · ${finished.reason.replaceAll("-", " ")}`}
        </strong>
      </div>
    </section>
  );
}
