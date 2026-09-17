import { NotImplemented } from "../core/errors";
import type {
  CompetitorRef,
  DecisionRecord,
  GameSummary,
  PlayerRecord,
} from "../core/types";

export function rebuildRecord(
  competitor: CompetitorRef,
  decisions: readonly DecisionRecord[],
  games: readonly GameSummary[],
): PlayerRecord {
  throw new NotImplemented("record.rebuildRecord");
}

export function rebuildRecords(
  decisions: readonly DecisionRecord[],
  games: readonly GameSummary[],
): readonly PlayerRecord[] {
  throw new NotImplemented("record.rebuildRecords");
}
