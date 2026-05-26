/**
 * Erzeugt manifest.json aus dem aktuellen Stand der data/pages/-JSONs.
 * Praktisch, wenn der Crawler noch läuft und man Zwischenstand testen will.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const PAGES_DIR = resolve(REPO_ROOT, "data/pages");
const MANIFEST_PATH = resolve(REPO_ROOT, "data/manifest.json");

const NS_OF_FOLDER: Record<string, number> = {
  "ns0-main": 0,
  "ns4-projekt": 4,
  "ns6-datei": 6,
  "ns10-vorlage": 10,
  "ns12-hilfe": 12,
  "ns14-kategorie": 14,
};

async function main(): Promise<void> {
  const subdirs = await readdir(PAGES_DIR);
  const pages: {
    title: string;
    ns: number;
    pageid: number;
    revisions: number;
  }[] = [];

  for (const folder of subdirs) {
    const ns = NS_OF_FOLDER[folder];
    if (ns === undefined) continue;
    const dir = resolve(PAGES_DIR, folder);
    const files = await readdir(dir);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await readFile(resolve(dir, f), "utf8");
        const data = JSON.parse(raw) as {
          title: string;
          ns: number;
          pageid: number;
          revisions?: unknown[];
        };
        pages.push({
          title: data.title,
          ns: data.ns,
          pageid: data.pageid,
          revisions: data.revisions?.length ?? 0,
        });
      } catch (err) {
        console.warn(`Skipping ${folder}/${basename(f)}:`, (err as Error).message);
      }
    }
  }

  pages.sort((a, b) => a.title.localeCompare(b.title));

  const manifest = {
    source: "https://grundschulwiki.zum.de/",
    crawledAt: new Date().toISOString(),
    contact: process.env.CRAWLER_CONTACT ?? "thomas@soring.de",
    license: "CC BY-SA 4.0",
    namespaces: Array.from(new Set(pages.map((p) => p.ns))).sort((a, b) => a - b),
    pageCount: pages.length,
    pages,
  };

  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Manifest geschrieben: ${pages.length} Seiten`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
