import test from "node:test";
import assert from "node:assert/strict";
import { authorizationUrl, installUrl, type GitHubConfig } from "../github";

const config: GitHubConfig = {
  appId: "1",
  slug: "2db-bridge",
  clientId: "Iv1.test client",
  clientSecret: "secret",
  privateKey: "private-key",
  publicUrl: "https://controller.example.com",
  returnUrl: "https://twodb-steel.vercel.app/control/",
  tokenKey: Buffer.alloc(32),
  targetRepo: null,
};

test("GitHub account authorization and App installation use separate URLs", () => {
  assert.equal(
    authorizationUrl(config, "single-use state"),
    "https://github.com/login/oauth/authorize?client_id=Iv1.test%20client&state=single-use%20state&redirect_uri=https%3A%2F%2Fcontroller.example.com%2Fengineer-api%2Fgithub%2Fcallback",
  );
  assert.equal(
    installUrl(config),
    "https://github.com/apps/2db-bridge/installations/new",
  );
});
