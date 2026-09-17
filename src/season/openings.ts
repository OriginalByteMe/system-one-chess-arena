import { ContractViolation } from "../core/errors.ts";
import type { Opening } from "../core/types.ts";

export const OPENINGS: readonly Opening[] = [
  {
    id: "italian-game",
    name: "Italian Game",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"],
    fen: "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
  },
  {
    id: "queens-gambit",
    name: "Queen's Gambit Declined",
    moves: ["d4", "d5", "c4", "e6", "Nc3", "Nf6"],
    fen: "rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR w KQkq - 2 4",
  },
  {
    id: "sicilian-najdorf",
    name: "Sicilian Defence: Najdorf",
    moves: ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6"],
    fen: "rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6",
  },
  {
    id: "kings-indian",
    name: "King's Indian Defence",
    moves: ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6"],
    fen: "rnbqk2r/ppp1ppbp/3p1np1/8/2PPP3/2N5/PP3PPP/R1BQKBNR w KQkq - 0 5",
  },
  {
    id: "london-system",
    name: "London System",
    moves: ["d4", "d5", "Nf3", "Nf6", "Bf4", "e6", "e3", "Bd6"],
    fen: "rnbqk2r/ppp2ppp/3bpn2/3p4/3P1B2/4PN2/PPP2PPP/RN1QKB1R w KQkq - 1 5",
  },
];

export function openingById(id: string): Opening {
  const opening = OPENINGS.find((candidate) => candidate.id === id);
  if (opening === undefined) {
    throw new ContractViolation("openings.openingById", `unknown opening id: ${id}`);
  }
  return opening;
}
