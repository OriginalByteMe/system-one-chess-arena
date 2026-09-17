import type { Env } from "./core/env.ts";

export { GameDurableObject } from "./do/game.ts";
export { SeasonDurableObject } from "./do/season.ts";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/health") {
      return Response.json({ ok: true, phase: 0 });
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
