import { createControl } from "./app";
import { readMarketTickets } from "./market-tickets";
const port = Number(process.env.CONTROL_PORT ?? 3002);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("CONTROL_PORT must be between 1024 and 65535.");
const { createMarketPool, useSupabase } = await import("../server/postgres.js");
const pool = useSupabase ? createMarketPool() : undefined;
if (pool) await pool.query("SELECT id FROM two_db.support_tickets LIMIT 1");
const control = createControl({ remoteTickets: pool ? () => readMarketTickets(pool) : undefined });
const server = control.app.listen(port, "127.0.0.1", () =>
  console.log(
    `2DB: http://127.0.0.1:${port}\nOpen a local engineer session with: npm.cmd run control:engineer\nAgent 1 setup: npm.cmd run control:agent:status\nLive Agent 2 and GitHub integration are not connected.`,
  ),
);
server.on("error", (error: NodeJS.ErrnoException) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Port ${port} is occupied. No process was stopped. Set CONTROL_PORT to a free port.`
      : error.message,
  );
  control.store.close();
  process.exitCode = 1;
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    if (control.agent.activeId) control.agent.cancel(control.agent.activeId);
    server.close();
    const timer = setInterval(async () => {
      if (!control.agent.active && !control.runner.active) {
        clearInterval(timer);
        control.store.close();
        await pool?.end();
        process.exit(0);
      }
    }, 200);
    timer.unref();
  });
