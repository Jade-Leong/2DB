import { prepareImage, probeIsolation } from "./docker";
import { setupStatus } from "./service";
if (process.argv[2] === "prepare") {
  console.log(
    "Building the isolated tools image. First build downloads Node.js, dependencies, and Chromium; this can take several minutes.",
  );
  try {
    console.log(await prepareImage());
    const result = await probeIsolation();
    console.log(JSON.stringify(result, null, 2));
    if (!result.ready) process.exitCode = 1;
  } catch (e) {
    console.error(e instanceof Error ? e.message : "Preparation failed");
    process.exitCode = 1;
  }
} else console.log(JSON.stringify(await setupStatus(), null, 2));
