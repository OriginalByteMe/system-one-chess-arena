// Serves the repo root so docs/plan.html can fetch PLAN.md (file:// cannot).
const root = new URL("..", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 8792);

Bun.serve({
  port,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const file = Bun.file(`${root}${path === "/" ? "/docs/plan.html" : path}`);
    return (await file.exists())
      ? new Response(file)
      : new Response("Not found", { status: 404 });
  },
});

console.log(`plan: http://localhost:${port}/`);
