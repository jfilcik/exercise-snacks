import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const script = resolve("scripts/configure-google.mjs");
const source = await readFile(resolve("public/manifest.json"), "utf8");

async function configure(environment, inspect) {
  const folder = await mkdtemp(join(tmpdir(), "exercise-snacks-manifest-"));
  try {
    await mkdir(join(folder, "public"));
    await mkdir(join(folder, "dist"));
    await writeFile(join(folder, "public", "manifest.json"), source);
    const env = { ...process.env };
    delete env.GOOGLE_OAUTH_CLIENT_ID;
    delete env.GOOGLE_EXTENSION_PUBLIC_KEY;
    const result = spawnSync(process.execPath, [script], { cwd: folder, env: { ...env, ...environment }, encoding: "utf8" });
    await inspect(result, async () => JSON.parse(await readFile(join(folder, "dist", "manifest.json"), "utf8")));
  } finally { await rm(folder, { recursive: true, force: true }); }
}

test("the default extension build has no Google identity permission, API host, or OAuth client", async () => {
  await configure({}, async (result, manifest) => {
    assert.equal(result.status, 0, result.stderr);
    const value = await manifest();
    assert.deepEqual(value.permissions, ["alarms", "notifications", "storage"]);
    assert.equal(value.oauth2, undefined);
    assert.equal(value.host_permissions.includes("https://www.googleapis.com/*"), false);
  });
});

test("a configured Google build requests only free/busy and uses the supplied public extension identity", async () => {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const clientId = "123456789-testonly.apps.googleusercontent.com";
  await configure({ GOOGLE_OAUTH_CLIENT_ID: clientId, GOOGLE_EXTENSION_PUBLIC_KEY: key }, async (result, manifest) => {
    assert.equal(result.status, 0, result.stderr);
    const value = await manifest();
    assert.ok(value.permissions.includes("identity"));
    assert.ok(value.host_permissions.includes("https://www.googleapis.com/*"));
    assert.deepEqual(value.oauth2, { client_id: clientId, scopes: ["https://www.googleapis.com/auth/calendar.freebusy"] });
    assert.equal(value.key, key);
  });
});

test("invalid Google client configuration fails the build instead of shipping a pretend connection", async () => {
  await configure({ GOOGLE_OAUTH_CLIENT_ID: "not-an-oauth-client" }, async (result) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must be a Chrome Extension OAuth client ID/);
  });
});
