/**
 * Lädt alle hochgeladenen Dateien (Bilder, PDFs etc.) aus dem Grundschulwiki.
 * Speichert die Originaldateien plus eine Metadaten-JSON pro Datei mit
 * Uploader, Lizenz-Tag, Beschreibung, Größe.
 */
import { mkdir, writeFile, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://grundschulwiki.zum.de/api.php";
const CONTACT = process.env.CRAWLER_CONTACT ?? "thomas@soring.de";
const UA = `Grundschulwiki-Archiv/1.0 (+Kontakt: ${CONTACT}; Zweck: Sicherung CC BY-SA)`;
const DELAY_MS = 1000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const FILES_DIR = resolve(REPO_ROOT, "data/files");
const FILES_META = resolve(REPO_ROOT, "data/files-manifest.json");

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function api<T>(params: Record<string, string>): Promise<T> {
  const url = new URL(API);
  url.searchParams.set("format", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return (await res.json()) as T;
}

type AllImagesResp = {
  query?: {
    allimages?: {
      name: string;
      url: string;
      descriptionurl?: string;
      size?: number;
      width?: number;
      height?: number;
      mime?: string;
      mediatype?: string;
      timestamp?: string;
      user?: string;
      sha1?: string;
    }[];
  };
  // MediaWiki 1.21 verwendet aicontinue, neuere auch aifrom. Wir nehmen
  // beides an.
  "query-continue"?: { allimages?: { aicontinue?: string; aifrom?: string } };
};

async function* listAllImages(): AsyncGenerator<NonNullable<AllImagesResp["query"]>["allimages"] extends (infer T)[] | undefined ? NonNullable<T> : never> {
  let nextContinue: string | undefined;
  let nextFrom: string | undefined;
  for (;;) {
    const params: Record<string, string> = {
      action: "query",
      list: "allimages",
      ailimit: "200",
      aiprop: "url|size|mime|mediatype|timestamp|user|sha1",
    };
    if (nextContinue) params.aicontinue = nextContinue;
    else if (nextFrom) params.aifrom = nextFrom;
    const resp = await api<AllImagesResp>(params);
    for (const img of resp.query?.allimages ?? []) {
      yield img as never;
    }
    const cont = resp["query-continue"]?.allimages;
    if (!cont?.aicontinue && !cont?.aifrom) return;
    nextContinue = cont.aicontinue;
    nextFrom = cont.aifrom;
    await sleep(DELAY_MS);
  }
}

function safeFilename(name: string): string {
  return name.replace(/[\\/]/g, "__").replace(/\s+/g, "_").slice(0, 200);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

type FileMeta = {
  name: string;
  url: string;
  descriptionurl?: string;
  size?: number;
  width?: number;
  height?: number;
  mime?: string;
  mediatype?: string;
  timestamp?: string;
  user?: string;
  sha1?: string;
  localPath: string;
};

async function downloadFile(url: string, target: string): Promise<void> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`File HTTP ${res.status} on ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(target, buf);
}

async function main(): Promise<void> {
  await mkdir(FILES_DIR, { recursive: true });
  console.log(`User-Agent: ${UA}`);

  const manifest: FileMeta[] = [];
  let count = 0;
  for await (const img of listAllImages()) {
    count++;
    const localName = safeFilename(img.name);
    const localPath = resolve(FILES_DIR, localName);
    const meta: FileMeta = {
      name: img.name,
      url: img.url,
      descriptionurl: img.descriptionurl,
      size: img.size,
      width: img.width,
      height: img.height,
      mime: img.mime,
      mediatype: img.mediatype,
      timestamp: img.timestamp,
      user: img.user,
      sha1: img.sha1,
      localPath: `data/files/${localName}`,
    };

    if (!(await fileExists(localPath))) {
      try {
        await downloadFile(img.url, localPath);
        if (count % 25 === 0) {
          console.log(`  [${count}] ${img.name} (${img.size ?? "?"} B)`);
        }
      } catch (err) {
        console.warn(`  ! Fehler bei ${img.name}:`, (err as Error).message);
        continue;
      }
      await sleep(DELAY_MS);
    }
    manifest.push(meta);
  }

  await writeFile(FILES_META, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`\nFertig. ${manifest.length} Dateien archiviert.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
