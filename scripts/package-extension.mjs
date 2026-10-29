import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { strToU8, zipSync } from "fflate";

const root = resolve(import.meta.dirname, "..");
const required = [
  "manifest.json", "index.html", "coach.html", "background.js", "icon128.png",
  "pose/pose_landmarker_lite.task", "pose/LICENSE.txt", "pose/MODEL_CARD.pdf",
  "pose/wasm/vision_wasm_internal.js", "pose/wasm/vision_wasm_internal.wasm",
  "pose/wasm/vision_wasm_nosimd_internal.js", "pose/wasm/vision_wasm_nosimd_internal.wasm",
];
const allowed = new Set([...required, "icon128.svg"]);

export async function packageExtension(directory = join(root, "dist"), output = join(root, "release", "exercise-snacks.zip")) {
  const files = {};
  async function collect(folder, prefix = "") {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`;
      const path = join(folder, entry.name);
      if (entry.isDirectory() && ["assets", "pose", "pose/wasm"].includes(name)) await collect(path, `${name}/`);
      else if (entry.isFile() && (allowed.has(name) || /^assets\/[A-Za-z0-9._-]+\.(?:js|css)$/.test(name))) {
        files[name] = await readFile(path);
      } else {
        throw new Error(`Unexpected build entry "${name}". Rebuild before packaging; source, maps, and local files must not be included.`);
      }
    }
  }
  await collect(directory);
  for (const name of required) {
    if (!files[name]) throw new Error(`Missing ${name}. Run npm run build before packaging.`);
  }
  const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
  const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (manifest.manifest_version !== 3 || manifest.version !== metadata.version) {
    throw new Error("The built manifest must be Manifest V3 and match package.json's version.");
  }
  const notices = [];
  for (const dependency of ["react", "react-dom", "scheduler", "cldr-core"]) {
    const folder = join(root, "node_modules", dependency);
    const info = JSON.parse(await readFile(join(folder, "package.json"), "utf8"));
    notices.push(`${dependency} ${info.version}\n${await readFile(join(folder, "LICENSE"), "utf8")}`);
  }
  const mediaPipe = JSON.parse(await readFile(join(root, "node_modules", "@mediapipe", "tasks-vision", "package.json"), "utf8"));
  notices.push(`@mediapipe/tasks-vision ${mediaPipe.version}, WASM runtime and BlazePose GHUM lite model\n` +
    "Copyright Google LLC. Licensed under Apache License, Version 2.0.\n" +
    "The model's license and intended uses are documented on page 2 of pose/MODEL_CARD.pdf.\n" +
    "Model source: https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task\n" +
    "Model card: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf\n" +
    await readFile(join(root, "docs", "third-party", "LICENSE.txt"), "utf8"));
  files["THIRD_PARTY_NOTICES.txt"] = strToU8(`Exercise Snacks - bundled third-party notices\n\n${notices.join("\n\n---\n\n")}`);
  files["INSTALL.txt"] = strToU8([
    `Exercise Snacks ${manifest.version}`,
    "",
    "1. Extract this ZIP into a permanent folder. Do not load it directly from the ZIP.",
    "2. Open chrome://extensions or edge://extensions and enable Developer mode.",
    "3. Choose Load unpacked and select the extracted folder containing manifest.json.",
    "4. Open Exercise Snacks, choose your time zone, work hours and preferences,",
    "   and save with reminders enabled. No calendar is needed to get started.",
    "   Add your own personal Bookings link in Settings to look for free gaps.",
    "5. Test desktop notifications in Settings and allow browser/OS notifications.",
    "6. Start early / Start now starts a planned snack manually without checking the calendar.",
    "   It replaces that snack's reminder. Time-based reminders are not verified free slots.",
    "7. For an active squat break, choose Count with camera / manually to open Camera Coach.",
    "   Camera permission is optional and requested only after Enable camera counting.",
    "   Squat counts are experimental estimates, not verification of form or quality.",
    "",
    "Keep the browser running for reminders. Keep this folder in place.",
    "To update, replace the files in the same folder and click Reload on the extension.",
    "The standard ZIP supports no calendar or Microsoft personal Bookings.",
    "Google Calendar needs a configured OAuth build. Time-based reminders may overlap meetings.",
    "Setup and technical details: https://github.com/jfilcik/exercise-snacks/blob/main/docs/technical.md",
    "",
  ].join("\n"));
  const archive = zipSync(files, { level: 9, mtime: new Date(2020, 0, 1) });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, archive);
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(`Created ${await packageExtension()}`);
}
