/**
 * Erzeugt zu jeder Artikel-JSON eine lesbare Markdown-Variante unter
 * data/articles/<filename>.md. GitHub rendert MD automatisch beim Browsen
 * des Repos, sodass jemand die Artikel direkt im Webbrowser lesen kann.
 *
 * Das ist KEIN vollständiger Wikitext-Parser, sondern eine pragmatische
 * Konvertierung für Lesbarkeit.
 */
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const PAGES_DIR = resolve(REPO_ROOT, "data/pages");
const MD_DIR = resolve(REPO_ROOT, "data/articles");

const NS_FOLDERS = ["ns0-main"]; // nur Hauptartikel rendern, der Rest ist Wiki-Innerei

type ArticleJson = {
  title: string;
  ns: number;
  pageid: number;
  categories: string[];
  revisions: {
    revid: number;
    user?: string;
    timestamp: string;
    wikitext: string;
  }[];
};

const MAX_PASSES = 5;

function wikitextToMarkdown(wt: string, title: string): string {
  if (!wt) return "";
  let out = wt;

  // HTML-Kommentare
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  // refs
  out = out.replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, "");
  out = out.replace(/<ref\b[^>]*\/>/gi, "");
  out = out.replace(/<nowiki\b[^>]*>([\s\S]*?)<\/nowiki>/gi, "$1");
  // Galerien
  out = out.replace(/<gallery\b[^>]*>[\s\S]*?<\/gallery>/gi, "");

  // Tabellen iterativ
  for (let i = 0; i < MAX_PASSES; i++) {
    const before = out;
    out = out.replace(/\{\|[\s\S]*?\|\}/g, "");
    if (out === before) break;
  }
  // Templates iterativ (von innen nach außen)
  for (let i = 0; i < MAX_PASSES; i++) {
    const before = out;
    out = out.replace(/\{\{[^{}]*?\}\}/g, "");
    if (out === before) break;
  }

  // Bilder/Dateien -> Markdown-Bild (Link auf File-Beschreibungsseite des Originals)
  out = out.replace(
    /\[\[(?:Bild|Datei|Image|File):([^\]|]+?)(?:\|[^\]]*)?\]\]/gi,
    (_, filename: string) => {
      const fn = filename.trim();
      return `\n![${fn}](https://grundschulwiki.zum.de/wiki/Datei:${encodeURIComponent(fn.replace(/\s/g, "_"))})\n`;
    },
  );

  // Kategorie-Links komplett raus
  out = out.replace(/\[\[(?:Kategorie|Category):[^\]]*\]\]/gi, "");

  // Wiki-Links -> normale Markdown-Links auf den Archive-Viewer
  out = out.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_, target: string, text: string) => {
    return `[${text}](${linkTarget(target)})`;
  });
  out = out.replace(/\[\[([^\]]+)\]\]/g, (_, target: string) => {
    return `[${target}](${linkTarget(target)})`;
  });

  // Externe Links
  out = out.replace(/\[(https?:\/\/\S+)\s+([^\]]+)\]/g, "[$2]($1)");
  out = out.replace(/\[(https?:\/\/\S+)\]/g, "$1");

  // Headings: == X == -> ## X
  out = out.replace(/^={6}\s*(.+?)\s*={6}\s*$/gm, "###### $1");
  out = out.replace(/^={5}\s*(.+?)\s*={5}\s*$/gm, "##### $1");
  out = out.replace(/^={4}\s*(.+?)\s*={4}\s*$/gm, "#### $1");
  out = out.replace(/^={3}\s*(.+?)\s*={3}\s*$/gm, "### $1");
  out = out.replace(/^={2}\s*(.+?)\s*={2}\s*$/gm, "## $1");

  // Listen
  out = out.replace(/^\s*\*+\s*/gm, "- ");
  out = out.replace(/^\s*#+\s*/gm, "1. ");

  // Bold/Italic
  out = out.replace(/'''([\s\S]+?)'''/g, "**$1**");
  out = out.replace(/''([\s\S]+?)''/g, "*$1*");

  // Restliches HTML weg
  out = out.replace(/<[^>]+>/g, "");

  // Entities
  out = out
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Whitespace
  out = out
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l, i, arr) => l.length > 0 || (arr[i - 1]?.length ?? 0) > 0)
    .join("\n");

  // Dokumenten-Header
  const url = `https://grundschulwiki.zum.de/wiki/${encodeURIComponent(title.replace(/\s/g, "_"))}`;
  const header = `# ${title}

> **Quelle:** [${title} im Grundschulwiki](${url}) (voraussichtlich bis Juni 2026 erreichbar)
> **Lizenz:** [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.de)
> **Archiviert am:** ${new Date().toISOString().slice(0, 10)}

---

`;
  return header + out.trim() + "\n";
}

function linkTarget(target: string): string {
  // Wiki-Link wie "Adler" oder "Adler#Abschnitt" → Link auf das Markdown
  // im selben Verzeichnis (GitHub rendert relative MD-Links).
  const clean = target.split("#")[0].replace(/\s/g, "_");
  const safe = clean.replace(/[\\/]/g, "__");
  return `./${encodeURIComponent(safe)}.md`;
}

function safeFilename(title: string): string {
  return title.replace(/[\\/]/g, "__").replace(/\s+/g, "_").slice(0, 200);
}

async function main(): Promise<void> {
  await mkdir(MD_DIR, { recursive: true });
  let count = 0;
  for (const folder of NS_FOLDERS) {
    const dir = resolve(PAGES_DIR, folder);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await readFile(resolve(dir, f), "utf8");
        const art = JSON.parse(raw) as ArticleJson;
        const latest = art.revisions[0];
        if (!latest?.wikitext) continue;
        const md = wikitextToMarkdown(latest.wikitext, art.title);
        const out = resolve(MD_DIR, safeFilename(art.title) + ".md");
        await writeFile(out, md);
        count++;
      } catch (err) {
        console.warn(`Skipping ${basename(f)}:`, (err as Error).message);
      }
    }
  }

  // Index-Datei mit Liste aller Artikel
  const all = (await readdir(MD_DIR)).filter((f) => f.endsWith(".md") && f !== "README.md");
  const titles = all
    .map((f) => f.replace(/\.md$/, "").replace(/_/g, " "))
    .sort((a, b) => a.localeCompare(b));
  const indexMd =
    `# Grundschulwiki-Archiv - Artikel\n\nLesbare Markdown-Versionen der archivierten Hauptartikel (~${titles.length} Stück).\n\n` +
    titles.map((t) => `- [${t}](./${encodeURIComponent(t.replace(/ /g, "_"))}.md)`).join("\n") +
    "\n";
  await writeFile(resolve(MD_DIR, "README.md"), indexMd);

  console.log(`${count} Markdown-Dateien geschrieben (plus README.md Index).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
