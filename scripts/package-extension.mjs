import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { strToU8, zipSync } from "fflate";

const root = resolve(import.meta.dirname, "..");
const required = ["manifest.json", "index.html", "background.js", "icon128.png"];
const allowed = new Set([...required, "icon128.svg"]);

export async function packageExtension(directory = join(root, "dist"), output = join(root, "release", "exercise-snacks.zip")) {
  const files = {};
  async function collect(folder, prefix = "") {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`;
      const path = join(folder, entry.name);
      if (entry.isDirectory() && name === "assets") await collect(path, "assets/");
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
  files["THIRD_PARTY_NOTICES.txt"] = strToU8(`Exercise Snacks - bundled third-party notices\n\n${notices.join("\n\n---\n\n")}`);
  files["INSTALL.txt"] = strToU8([
    `Exercise Snacks ${manifest.version}`,
    "",
    "1. Extract this ZIP into a permanent folder. Do not load it directly from the ZIP.",
    "2. Open chrome://extensions or edge://extensions and enable Developer mode.",
    "3. Choose Load unpacked and select the extracted folder containing manifest.json.",
    "4. Open Exercise Snacks, supply your public personal Bookings meeting-type link,",
    "   choose your time zone and preferences, and save with reminders enabled.",
    "5. Test desktop notifications in Settings and allow browser/OS notifications.",
    "",
    "Keep the browser running for reminders. Keep this folder in place.",
    "To update, replace the files in the same folder and click Reload on the extension.",
    "The standard release uses Microsoft personal Bookings; Google needs a configured OAuth build.",
    "Full setup and limitations: https://github.com/jfilcik/exercise-snacks",
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
