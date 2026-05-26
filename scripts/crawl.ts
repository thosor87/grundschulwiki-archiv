/**
 * Vollständiger Crawl von grundschulwiki.zum.de.
 *
 * Ziel: rekonstruierbares Archiv. Was wir holen:
 *  1) Alle Seiten in allen relevanten Namespaces (Main, Kategorien, Vorlagen,
 *     Dateien, Hilfe, ZUM-Wiki) mit komplettem Wikitext und Versionsgeschichte
 *  2) MediaWiki-XML-Export jeder Seite (importierbar in jedes andere MediaWiki)
 *  3) Pro Seite eine lesbare JSON mit aktuellem Wikitext + Metadaten
 *  4) Eine Master-Liste aller Titel (manifest.json)
 *
 * Bilder/Dateien laufen separat in scripts/crawl-images.ts.
 *
 * Respekt vor dem Server: 1 Request pro Sekunde, eigener User-Agent.
 */
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://grundschulwiki.zum.de/api.php";
const CONTACT = process.env.CRAWLER_CONTACT ?? "thomas@soring.de";
const UA = `Grundschulwiki-Archiv/1.0 (+Kontakt: ${CONTACT}; Zweck: Sicherung vor Abschaltung Juni 2026, CC BY-SA)`;
const DELAY_MS = 1000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const PAGES_DIR = resolve(REPO_ROOT, "data/pages");
const XML_DIR = resolve(REPO_ROOT, "data/xml");
const MANIFEST_PATH = resolve(REPO_ROOT, "data/manifest.json");

// Namespaces im MediaWiki:
//   0  = (Main / Artikel)
//   1  = (Diskussion)
//   2  = Benutzer
//   3  = Benutzer Diskussion
//   4  = ZUM-Grundschul-Wiki (Projekt-Namespace)
//   5  = ZUM-Grundschul-Wiki Diskussion
//   6  = Datei (Bild-Beschreibungsseiten, NICHT die Dateien selbst)
//   7  = Datei Diskussion
//   8  = MediaWiki (System-Nachrichten)
//   10 = Vorlage (Templates)
//   12 = Hilfe
//   14 = Kategorie
//
// Wir nehmen alles, was Inhalt trägt: Main, Projekt, Datei-Beschreibungsseiten,
// Vorlagen, Hilfe, Kategorien.
const NAMESPACES: number[] = (process.env.CRAWL_NAMESPACES?.split(",").map(Number) ?? [
  0, 4, 6, 10, 12, 14,
]);
const PAGE_LIMIT = Number(process.env.CRAWL_LIMIT ?? 0); // 0 = alles

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function api<T>(params: Record<string, string>): Promise<T> {
  const url = new URL(API);
  url.searchParams.set("format", "json");
  // Grundschulwiki läuft auf älterem MediaWiki, formatversion=2 bewusst NICHT
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return (await res.json()) as T;
}

type AllPagesResp = {
  query?: { allpages?: { pageid: number; ns: number; title: string }[] };
  // MediaWiki 1.21 (Grundschulwiki) verwendet apcontinue, neuere apfrom.
  "query-continue"?: { allpages?: { apcontinue?: string; apfrom?: string } };
};

async function* listPagesInNs(ns: number): AsyncGenerator<{
  pageid: number;
  title: string;
  ns: number;
}> {
  let nextContinue: string | undefined;
  let nextFrom: string | undefined;
  for (;;) {
    const params: Record<string, string> = {
      action: "query",
      list: "allpages",
      apnamespace: String(ns),
      aplimit: "500",
    };
    if (nextContinue) params.apcontinue = nextContinue;
    else if (nextFrom) params.apfrom = nextFrom;
    const resp = await api<AllPagesResp>(params);
    for (const p of resp.query?.allpages ?? []) {
      yield { pageid: p.pageid, title: p.title, ns: p.ns };
    }
    const cont = resp["query-continue"]?.allpages;
    if (!cont?.apcontinue && !cont?.apfrom) return;
    nextContinue = cont.apcontinue;
    nextFrom = cont.apfrom;
    await sleep(DELAY_MS);
  }
}

type RevisionsResp = {
  query?: {
    pages?: Record<
      string,
      {
        pageid: number;
        ns: number;
        title: string;
        missing?: string;
        revisions?: {
          revid: number;
          parentid?: number;
          user?: string;
          timestamp: string;
          comment?: string;
          "*"?: string; // wikitext (v1 format)
          content?: string;
        }[];
        categories?: { ns: number; title: string }[];
      }
    >;
  };
};

async function fetchRevisions(title: string): Promise<{
  pageid: number;
  ns: number;
  title: string;
  revisions: {
    revid: number;
    parentid?: number;
    user?: string;
    timestamp: string;
    comment?: string;
    wikitext: string;
  }[];
  categories: string[];
} | null> {
  const resp = await api<RevisionsResp>({
    action: "query",
    prop: "revisions|categories",
    rvprop: "ids|timestamp|user|comment|content",
    rvlimit: "50", // Mehr als 50 Versionen pro Artikel sind im Grundschulwiki rar
    cllimit: "max",
    titles: title,
    redirects: "1",
  });
  const pages = resp.query?.pages;
  if (!pages) return null;
  const page = Object.values(pages)[0];
  if (!page || page.missing) return null;
  const revisions = (page.revisions ?? []).map((r) => ({
    revid: r.revid,
    parentid: r.parentid,
    user: r.user,
    timestamp: r.timestamp,
    comment: r.comment,
    wikitext: (r["*"] ?? r.content ?? "").toString(),
  }));
  const categories = (page.categories ?? []).map((c) => c.title);
  return {
    pageid: page.pageid,
    ns: page.ns,
    title: page.title,
    revisions,
    categories,
  };
}

// MediaWiki-XML-Export für eine Liste von Titeln, inkl. Historie.
// Liefert ein eigenständiges <mediawiki>...</mediawiki>-Dokument.
async function exportXml(titles: string[]): Promise<string> {
  const body = new URLSearchParams();
  body.set("action", "query");
  body.set("format", "xml");
  body.set("export", "1");
  body.set("exportnowrap", "1");
  body.set("titles", titles.join("|"));
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Export HTTP ${res.status}`);
  return await res.text();
}

function safeFilename(title: string): string {
  // Wir behalten Title-Struktur, ersetzen Slashes und problematische Zeichen
  return title.replace(/[\\/]/g, "__").replace(/\s+/g, "_").slice(0, 200);
}

function nsFolder(ns: number): string {
  const map: Record<number, string> = {
    0: "ns0-main",
    4: "ns4-projekt",
    6: "ns6-datei",
    10: "ns10-vorlage",
    12: "ns12-hilfe",
    14: "ns14-kategorie",
  };
  return map[ns] ?? `ns${ns}`;
}

type Manifest = {
  source: string;
  crawledAt: string;
  contact: string;
  license: string;
  namespaces: number[];
  pageCount: number;
  pages: { title: string; ns: number; pageid: number; revisions: number }[];
};

async function loadManifest(): Promise<Manifest | null> {
  try {
    const raw = await readFile(MANIFEST_PATH, "utf8");
    return JSON.parse(raw) as Manifest;
  } catch {
    return null;
  }
}

async function saveManifest(m: Manifest): Promise<void> {
  await writeFile(MANIFEST_PATH, JSON.stringify(m, null, 2) + "\n");
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  console.log(`User-Agent: ${UA}`);
  await mkdir(PAGES_DIR, { recursive: true });
  await mkdir(XML_DIR, { recursive: true });

  // 1. Phase: alle Titel aus allen Namespaces sammeln
  console.log("Phase 1: Titel sammeln aus Namespaces", NAMESPACES.join(", "));
  const titles: { title: string; ns: number; pageid: number }[] = [];
  for (const ns of NAMESPACES) {
    console.log(`  Namespace ${ns}…`);
    let count = 0;
    for await (const p of listPagesInNs(ns)) {
      titles.push(p);
      count++;
      if (PAGE_LIMIT && titles.length >= PAGE_LIMIT) break;
    }
    console.log(`    -> ${count} Seiten`);
    if (PAGE_LIMIT && titles.length >= PAGE_LIMIT) break;
    await sleep(DELAY_MS);
  }
  console.log(`Phase 1 fertig: ${titles.length} Seiten insgesamt`);

  // 2. Phase: pro Seite JSON mit Revisionen schreiben
  console.log("Phase 2: Inhalte pro Seite holen");
  const manifestPages: Manifest["pages"] = [];
  let i = 0;
  for (const t of titles) {
    i++;
    const dir = resolve(PAGES_DIR, nsFolder(t.ns));
    const path = resolve(dir, safeFilename(t.title) + ".json");
    await mkdir(dir, { recursive: true });

    // Resume: schon vorhanden? überspringen, aber Manifest-Eintrag behalten
    if (await fileExists(path)) {
      try {
        const existing = JSON.parse(await readFile(path, "utf8")) as {
          revisions?: unknown[];
        };
        manifestPages.push({
          title: t.title,
          ns: t.ns,
          pageid: t.pageid,
          revisions: existing.revisions?.length ?? 0,
        });
        if (i % 100 === 0) console.log(`  [${i}/${titles.length}] resumed`);
        continue;
      } catch {
        // korrupt? neu holen
      }
    }

    try {
      const data = await fetchRevisions(t.title);
      if (!data) {
        console.warn(`  ! ${t.title} missing/null, skip`);
        continue;
      }
      await writeFile(path, JSON.stringify(data, null, 2) + "\n");
      manifestPages.push({
        title: t.title,
        ns: t.ns,
        pageid: t.pageid,
        revisions: data.revisions.length,
      });
      if (i % 25 === 0) {
        console.log(
          `  [${i}/${titles.length}] ${t.title} (${data.revisions.length} rev)`,
        );
      }
    } catch (err) {
      console.warn(`  ! Fehler bei ${t.title}:`, (err as Error).message);
    }
    await sleep(DELAY_MS);
  }

  // 3. Phase: MediaWiki-XML-Export, blockweise (50 Titel pro Request)
  console.log("Phase 3: XML-Export (importierbar in andere MediaWiki)");
  const BLOCK = 50;
  for (let j = 0; j < titles.length; j += BLOCK) {
    const block = titles.slice(j, j + BLOCK);
    const xmlPath = resolve(
      XML_DIR,
      `pages-${String(j).padStart(6, "0")}-${String(j + block.length - 1).padStart(6, "0")}.xml`,
    );
    if (await fileExists(xmlPath)) continue;
    try {
      const xml = await exportXml(block.map((t) => t.title));
      await writeFile(xmlPath, xml);
      console.log(`  XML ${j}-${j + block.length - 1} (${block.length} Seiten)`);
    } catch (err) {
      console.warn(`  ! XML-Fehler bei Block ${j}:`, (err as Error).message);
    }
    await sleep(DELAY_MS);
  }

  // 4. Manifest schreiben
  const manifest: Manifest = {
    source: "https://grundschulwiki.zum.de/",
    crawledAt: new Date().toISOString(),
    contact: CONTACT,
    license: "CC BY-SA 4.0",
    namespaces: NAMESPACES,
    pageCount: manifestPages.length,
    pages: manifestPages,
  };
  await saveManifest(manifest);

  console.log(`\nFertig. ${manifestPages.length} Seiten archiviert.`);
}

// Resume-Modus, falls schon ein Manifest existiert
const existing = await loadManifest();
if (existing) {
  console.log(`Resume: Manifest von ${existing.crawledAt} existiert, ` +
              `setze fort. Vorhandene Seiten werden übersprungen.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
