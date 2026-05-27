# Grundschulwiki-Archiv

Vollständige Sicherung der Inhalte des **ZUM-Grundschul-Wikis**
(<https://grundschulwiki.zum.de>), das die ZUM e.V. im Juni 2026 abschalten
wird. Ziel dieses Archivs: die ~5000 Artikel, von und für Grundschulkinder
geschrieben, bleiben erhalten und wären in jedem MediaWiki wieder
herstellbar.

## Was ist drin

```
data/
├── manifest.json             Liste aller archivierten Seiten + Metadaten
├── pages/
│   ├── ns0-main/             Artikel (~5000)
│   ├── ns4-projekt/          Projekt-Seiten (ZUM-Grundschul-Wiki)
│   ├── ns6-datei/            Datei-Beschreibungsseiten
│   ├── ns10-vorlage/         Templates
│   ├── ns12-hilfe/           Hilfe-Seiten
│   └── ns14-kategorie/       Kategorien
├── xml/                      MediaWiki-XML-Export, blockweise (importierbar)
├── files/                    Originaldateien (Bilder, PDFs etc.)
└── files-manifest.json       Metadaten zu allen Dateien
```

Pro Artikel-JSON: aktueller Wikitext, vollständige Versionsgeschichte (bis 50
Revisionen), Kategorien, Pageid.

Die XML-Dateien in `data/xml/` sind im Standard-MediaWiki-Export-Format und
lassen sich in jedem anderen MediaWiki mit `importDump.php` einlesen.

## Lizenz

Alle archivierten Inhalte stehen unter
[**Creative Commons BY-SA 4.0**](https://creativecommons.org/licenses/by-sa/4.0/deed.de),
so wie sie im Original-Wiki angegeben sind. Eine Wiederverwendung muss die
Autorinnen und Autoren des Grundschulwikis nennen (siehe [ATTRIBUTION.md](./ATTRIBUTION.md))
und die abgeleiteten Werke unter gleicher Lizenz weitergeben.

Die Crawler-Skripte unter `scripts/` stehen unter
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.de):
keine kommerzielle Nutzung, Änderungen müssen bei Weitergabe unter
derselben Lizenz veröffentlicht werden.

## Wiederherstellung

### In ein anderes MediaWiki re-importieren

```bash
# Pro XML-Block einmal:
for f in data/xml/*.xml; do
  php maintenance/importDump.php < "$f"
done
php maintenance/rebuildrecentchanges.php
```

Bilder/Dateien anschließend mit `maintenance/importImages.php` aus
`data/files/` importieren.

### Als statische Wissensquelle (z.B. RAG für KI-Anwendungen)

Die JSON-Dateien pro Seite enthalten den vollen Wikitext und lassen sich
direkt mit allen MediaWiki-Parsern (z.B. `mwparserfromhell`, `parsoid`)
verarbeiten.

## Crawl wiederholen oder ergänzen

```bash
npm install
CRAWLER_CONTACT=deine@email.tld npm run crawl
CRAWLER_CONTACT=deine@email.tld npm run crawl:images
```

Beide Skripte sind resume-fähig: bereits heruntergeladene Seiten/Dateien
werden übersprungen. Standard-Rate: 1 Request pro Sekunde.

## Hintergrund

Das Grundschulwiki wurde von der [ZUM e.V.](https://www.zum.de) gehostet und
von Lehrkräften und Grundschulkindern gemeinsam gepflegt. Im Banner der
Hauptseite (Mai 2026) wurde die Abschaltung im Juni 2026 angekündigt mit
Sicherungs-Frist bis 30. Mai 2026. Offizielle Migrations- oder
Erhaltungspläne wurden nicht kommuniziert.

Dieses Archiv ist eine **private Sicherung**, kein offizielles ZUM-Angebot.
Für Fragen zur Lizenz oder zu einzelnen Inhalten kontaktiere die ZUM e.V.
direkt.
