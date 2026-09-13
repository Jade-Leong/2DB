import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { applyPatch, parsePatch } from "diff";
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { problem } from "./paths";

export interface GitHubConfig {
  appId: string;
  slug: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  publicUrl: string;
  tokenKey: Buffer;
}

export function loadGitHubConfig(env: NodeJS.ProcessEnv = process.env): GitHubConfig | undefined {
  const appId = env.GITHUB_APP_ID;
  const slug = env.GITHUB_APP_SLUG;
  const clientId = env.GITHUB_APP_CLIENT_ID;
  const clientSecret = env.GITHUB_APP_CLIENT_SECRET;
  const privateKeyRaw = env.GITHUB_APP_PRIVATE_KEY;
  const tokenKeyRaw = env.GITHUB_TOKEN_KEY;
  const publicUrl = env.GITHUB_APP_PUBLIC_URL;
  if (!appId || !slug || !clientId || !clientSecret || !privateKeyRaw || !tokenKeyRaw || !publicUrl) return undefined;
  const privateKey = privateKeyRaw.includes("\\n") ? privateKeyRaw.replace(/\\n/g, "\n") : privateKeyRaw;
  const tokenKey = Buffer.from(tokenKeyRaw, "base64url");
  if (tokenKey.length !== 32) return undefined;
  return { appId, slug, clientId, clientSecret, privateKey, publicUrl: publicUrl.replace(/\/$/, ""), tokenKey };
}

export function encrypt(config: GitHubConfig, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.tokenKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function decrypt(config: GitHubConfig, ciphertext: string): string {
  const buf = Buffer.from(ciphertext, "base64url");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", config.tokenKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function installUrl(config: GitHubConfig, state: string): string {
  return `https://github.com/apps/${encodeURIComponent(config.slug)}/installations/new?state=${encodeURIComponent(state)}`;
}

export function safeCompareState(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

async function githubJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { Accept: "application/json", ...(init.headers ?? {}) } });
  const body = (await response.json().catch(() => ({}))) as any;
  if (!response.ok) problem(body?.error_description || body?.message || `GitHub responded ${response.status}.`, 502);
  return body as T;
}

export async function exchangeOAuthCode(config: GitHubConfig, code: string): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  return githubJson("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code }),
  });
}

export function userOctokit(userToken: string): Octokit {
  return new Octokit({ auth: userToken, userAgent: "2db-bridge/0.1" });
}

export async function fetchGitHubUser(userToken: string): Promise<{ id: number; login: string }> {
  const kit = userOctokit(userToken);
  const { data } = await kit.rest.users.getAuthenticated();
  return { id: data.id, login: data.login };
}

export async function listUserInstallations(userToken: string): Promise<{ id: number; account_login: string }[]> {
  const kit = userOctokit(userToken);
  const { data } = await kit.request("GET /user/installations", { per_page: 100 });
  return data.installations.map((i) => ({ id: i.id, account_login: (i.account && "login" in i.account ? i.account.login : "") as string }));
}

export async function listAccessibleRepos(userToken: string, installationId: number): Promise<{ owner: string; repo: string; default_branch: string }[]> {
  const kit = userOctokit(userToken);
  const { data } = await kit.request("GET /user/installations/{installation_id}/repositories", { installation_id: installationId, per_page: 100 });
  return data.repositories.map((r) => ({ owner: r.owner.login, repo: r.name, default_branch: r.default_branch }));
}

export function installationOctokit(config: GitHubConfig, installationId: number): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId: config.appId, privateKey: config.privateKey, installationId },
    userAgent: "2db-bridge/0.1",
  });
}

// Turn one file patch (from `diff`.parsePatch) into a new file blob.
// Returns undefined for pure deletions (caller should mark path removed).
async function applyPatchToFile(kit: Octokit, owner: string, repo: string, ref: string, patch: ReturnType<typeof parsePatch>[number]): Promise<{ path: string; content: string | null }> {
  const oldFile = (patch.oldFileName || "").replace(/^a\//, "");
  const newFile = (patch.newFileName || "").replace(/^b\//, "");
  const path = newFile && newFile !== "/dev/null" ? newFile : oldFile;
  if (!path) problem("Diff is missing a file path.", 400);
  if (newFile === "/dev/null") return { path: oldFile, content: null };
  let original = "";
  if (oldFile && oldFile !== "/dev/null") {
    try {
      const { data } = await kit.rest.repos.getContent({ owner, repo, path: oldFile, ref });
      if (Array.isArray(data) || data.type !== "file") problem(`Cannot patch non-file: ${oldFile}`, 400);
      original = Buffer.from((data as any).content, "base64").toString("utf8");
    } catch (e: any) {
      if (e.status !== 404) throw e;
      original = "";
    }
  }
  const patched = applyPatch(original, patch as any);
  if (patched === false) problem(`Failed to apply patch to ${path}. The target repo may have diverged from the proposal base.`, 409);
  return { path, content: patched };
}

export interface CreatePrParams {
  config: GitHubConfig;
  installationId: number;
  owner: string;
  repo: string;
  base: string;
  branch: string;
  title: string;
  body: string;
  unifiedDiff: string;
  authorName?: string;
  authorEmail?: string;
}

export async function createPullRequestFromDiff(params: CreatePrParams): Promise<{ url: string; number: number; branch: string }> {
  const kit = installationOctokit(params.config, params.installationId);
  const { owner, repo, base, branch } = params;
  const patches = parsePatch(params.unifiedDiff);
  if (!patches.length) problem("Proposal diff is empty.", 400);

  const { data: baseRef } = await kit.rest.git.getRef({ owner, repo, ref: `heads/${base}` });
  const baseSha = baseRef.object.sha;
  const { data: baseCommit } = await kit.rest.git.getCommit({ owner, repo, commit_sha: baseSha });
  const baseTree = baseCommit.tree.sha;

  const treeEntries: { path: string; mode: "100644"; type: "blob"; sha: string | null }[] = [];
  for (const patch of patches) {
    const applied = await applyPatchToFile(kit, owner, repo, base, patch);
    if (applied.content === null) {
      treeEntries.push({ path: applied.path, mode: "100644", type: "blob", sha: null });
    } else {
      const { data: blob } = await kit.rest.git.createBlob({ owner, repo, content: applied.content, encoding: "utf-8" });
      treeEntries.push({ path: applied.path, mode: "100644", type: "blob", sha: blob.sha });
    }
  }

  const { data: tree } = await kit.rest.git.createTree({ owner, repo, base_tree: baseTree, tree: treeEntries as any });
  const { data: commit } = await kit.rest.git.createCommit({
    owner, repo, message: params.title, tree: tree.sha, parents: [baseSha],
    author: { name: params.authorName || "2DB Bridge", email: params.authorEmail || "2db-bridge@users.noreply.github.com", date: new Date().toISOString() },
  });

  try {
    await kit.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: commit.sha });
  } catch (e: any) {
    if (e.status === 422) problem(`Branch ${branch} already exists on ${owner}/${repo}.`, 409);
    throw e;
  }

  const { data: pr } = await kit.rest.pulls.create({ owner, repo, title: params.title, body: params.body, head: branch, base });
  return { url: pr.html_url, number: pr.number, branch };
}
