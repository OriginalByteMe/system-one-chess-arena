import { NotImplemented } from "../core/errors.ts";
import type { ArenaStore } from "../core/types.ts";

/**
 * The only module that knows SQL for the read side. Every query is scoped by
 * season or competitor, and none of them filters by reveal state: gating is the
 * gate's job, so this returns the record and the handler slices it.
 */
export function d1Store(db: D1Database): ArenaStore {
  void db;
  throw new NotImplemented("api.store.d1Store");
}
