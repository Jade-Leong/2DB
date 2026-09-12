import { createControl } from "./app";
const port = Number(process.env.CONTROL_PORT ?? 3002);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("CONTROL_PORT must be between 1024 and 65535.");
const control = createControl();
const server = control.app.listen(port, "127.0.0.1", () =>
  console.log(
    `2DB: http://127.0.0.1:${port}\nOpen a local engineer session with: npm.cmd run control:engineer\nLive agents and GitHub are not connected.`,
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
