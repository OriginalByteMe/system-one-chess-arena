-- Measured 2026-09-18: six of six recorded games drew by repetition or move
-- limit, so a game with no progress is now decided on final material. The
-- column holds the material balance from white's side in centipawns, and is
-- null for every game that ended on the board.
ALTER TABLE games ADD COLUMN adjudicated_cp INTEGER;
