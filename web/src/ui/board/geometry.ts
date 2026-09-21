// Board-space geometry for the candidate arrows. The board is a 100x100 unit
// square (matching the SVG overlay viewBox), file a is column 0, rank 8 is
// row 0 — a fixed "white at the bottom" orientation. One square is 12.5 units,
// which is the yardstick every size below is expressed against.
//
// Arrows are drawn the way a chess player expects them: a straight shaft from
// origin to destination, an elbow for knight moves, a head that is visibly
// wider than its shaft, and both ends pulled back so the pieces underneath
// stay readable. Probability drives thickness and opacity together, over a
// deliberately narrow range — a 95% arrow should read as confident, not as a
// bar across the board.

export interface Point {
  readonly x: number;
  readonly y: number;
}

const FILE_A_CODE = "a".charCodeAt(0);
const CELL = 12.5;

/** Shaft half-width, in board units, for a candidate at probability `p`. */
const MIN_WIDTH = 0.85;
const WIDTH_RANGE = 1.75;

/** How far the shaft starts from the origin centre, so the moving piece shows through. */
const TAIL_INSET = 2.8;
/** How far the tip stops short of the destination centre. */
const TIP_INSET = 1.4;

/** Centre of a square, in 0..100 board-space units. */
export function squareCenter(square: string): Point {
  const fileIndex = square.charCodeAt(0) - FILE_A_CODE;
  const rank = Number(square.charAt(1));
  const col = Math.min(Math.max(fileIndex, 0), 7);
  const row = Math.min(Math.max(8 - rank, 0), 7);
  return { x: (col + 0.5) * CELL, y: (row + 0.5) * CELL };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Shaft width for a candidate's probability. Narrow on purpose: 7%–21% of a square. */
export function arrowWidth(p: number): number {
  return MIN_WIDTH + clamp(p, 0, 1) * WIDTH_RANGE;
}

export interface ArrowPath {
  /** Shaft polyline, already stopped at the base of the head. */
  readonly d: string;
  /** Triangular head, as SVG polygon points. */
  readonly head: string;
}

function unit(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  return { x: dx / dist, y: dy / dist };
}

function shift(origin: Point, direction: Point, distance: number): Point {
  return { x: origin.x + direction.x * distance, y: origin.y + direction.y * distance };
}

/**
 * The corner points of a move's shaft. A knight's leap gets an L, bent along
 * its long leg first, which is how every board editor draws it and the only
 * way two knight arrows out of the same square stay distinguishable.
 */
function corners(fromSquare: string, toSquare: string): readonly Point[] {
  const from = squareCenter(fromSquare);
  const to = squareCenter(toSquare);
  const files = Math.abs(fromSquare.charCodeAt(0) - toSquare.charCodeAt(0));
  const ranks = Math.abs(Number(fromSquare.charAt(1)) - Number(toSquare.charAt(1)));
  const leaps = (files === 1 && ranks === 2) || (files === 2 && ranks === 1);
  if (!leaps) return [from, to];
  const elbow = ranks > files ? { x: from.x, y: to.y } : { x: to.x, y: from.y };
  return [from, elbow, to];
}

/** Shaft path plus arrowhead for a move, sized off the shaft width. */
export function arrowPath(fromSquare: string, toSquare: string, width: number): ArrowPath {
  const path = corners(fromSquare, toSquare);
  const first = path[0] ?? squareCenter(fromSquare);
  const second = path[1] ?? squareCenter(toSquare);
  const last = path[path.length - 1] ?? second;
  const beforeLast = path[path.length - 2] ?? first;

  const headLength = clamp(width * 2.4, 3.0, 4.6);
  const headHalf = width * 0.95 + 0.45;

  const inbound = unit(beforeLast, last);
  const tip = shift(last, inbound, -TIP_INSET);
  const base = shift(tip, inbound, -headLength);
  const start = shift(first, unit(first, second), TAIL_INSET);

  const middle = path.slice(1, -1).map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`);
  const d = [`M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`, ...middle, `L ${base.x.toFixed(2)} ${base.y.toFixed(2)}`].join(" ");

  const perpendicular = { x: -inbound.y, y: inbound.x };
  const left = shift(base, perpendicular, headHalf);
  const right = shift(base, perpendicular, -headHalf);
  const head = `${tip.x.toFixed(2)},${tip.y.toFixed(2)} ${left.x.toFixed(2)},${left.y.toFixed(2)} ${right.x.toFixed(2)},${right.y.toFixed(2)}`;

  return { d, head };
}
