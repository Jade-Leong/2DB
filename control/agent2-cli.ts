import { agent2Status } from "./agent2";

const status = await agent2Status();
console.log(JSON.stringify(status, null, 2));
process.exitCode = status.state === "Ready" ? 0 : 1;
