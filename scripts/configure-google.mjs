import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPublicKey } from "node:crypto";

const manifest = JSON.parse(await readFile(resolve("public/manifest.json"), "utf8"));
const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
const key = process.env.GOOGLE_EXTENSION_PUBLIC_KEY?.trim();
if (key) {
  createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" });
  manifest.key = key;
}
if (clientId) {
  if (!/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID must be a Chrome Extension OAuth client ID, not a secret or API key.");
  }
  manifest.permissions.push("identity");
  manifest.host_permissions.push("https://www.googleapis.com/*");
  manifest.oauth2 = { client_id: clientId, scopes: ["https://www.googleapis.com/auth/calendar.freebusy"] };
}
await writeFile(resolve("dist/manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(clientId ? "Google Calendar OAuth enabled; consent and account access still require user sign-in." : "Bookings build ready. Google sign-in requires GOOGLE_OAUTH_CLIENT_ID; no Google identity permission was added.");
