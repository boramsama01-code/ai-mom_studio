"""Build-time only: full-Unicode static instances of the bundled OFL fonts.

Render does not run Python. Commit the deterministic gzip parts, manifests and
licenses; scripts/restore-cardnews14-fonts.mjs restores runtime TTFs with Node.
No glyph subsetting, font fallback, or source-font modification is performed.
First restore the preserved sources: node scripts/restore-cardnews14-fonts.mjs --sources
Reproduce with fontTools 4.61.1; Python is never a serving/build dependency on Render.
"""
from pathlib import Path
import gzip
import hashlib
import json
import fontTools
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[1]
FONT_ROOT = ROOT / "assets/fonts/cardnews14"
GENERATED = FONT_ROOT / "generated"
PACKED = FONT_ROOT / "packed-static"
GENERATED.mkdir(exist_ok=True)
PACKED.mkdir(exist_ok=True)
SOURCE = json.loads((FONT_ROOT / "manifest.json").read_text())
HASH = lambda value: hashlib.sha256(value).hexdigest()
profiles = [("Noto Sans KR", "NotoSansKR", [400, 700]), ("Noto Serif KR", "NotoSerifKR", [500, 600, 700, 800, 900])]
files, archives = [], []
for family, prefix, weights in profiles:
    source_entry = next(entry for entry in SOURCE["files"] if entry["file"] == prefix + "-Variable.ttf")
    source_path = FONT_ROOT / source_entry["file"]
    if HASH(source_path.read_bytes()) != source_entry["sha256"]:
        raise ValueError("Source font hash changed: " + str(source_path))
    for weight in weights:
        font = TTFont(source_path, recalcTimestamp=False)
        original_cmap = font.getBestCmap()
        # These original notice records remain in every derived font.
        notices = {(record.nameID, record.platformID, record.platEncID, record.langID): record.toBytes()
                   for record in font["name"].names if record.nameID in (0, 13, 14)}
        instance = instantiateVariableFont(font, {"wght": weight}, inplace=True, optimize=True, updateFontNames=True)
        if instance.getBestCmap() != original_cmap:
            raise ValueError("Unicode coverage changed: " + prefix + str(weight))
        for key, value in notices.items():
            current = instance["name"].getName(*key)
            if current is None or current.toBytes() != value:
                raise ValueError("Font copyright/license notice changed")
        filename = f"{prefix}-{weight}.ttf"
        output = GENERATED / filename
        instance.save(output, reorderTables=True)
        reopened = TTFont(output, recalcTimestamp=False)
        if reopened.getBestCmap() != original_cmap or "fvar" in reopened or "gvar" in reopened:
            raise ValueError("Static font validation failed: " + filename)
        raw = output.read_bytes()
        coverage = sorted(original_cmap)
        coverage_hash = HASH(json.dumps(coverage, separators=(",", ":")).encode())
        files.append({"file": "generated/" + filename, "family": family, "weight": weight,
                      "sha256": HASH(raw), "bytes": len(raw), "sourceFile": source_entry["file"],
                      "sourceSha256": source_entry["sha256"], "sourceGitBlobSha": source_entry["gitBlobSha"],
                      "unicodeCodepoints": len(coverage), "unicodeCoverageSha256": coverage_hash,
                      "glyphs": reopened["maxp"].numGlyphs, "copyrightAndLicenseNoticesPreserved": True})
        packed = gzip.compress(raw, compresslevel=9, mtime=0)
        parts = []
        for index, start in enumerate(range(0, len(packed), 196608)):
            name = f"{prefix}-{weight}.{index:03}.part"
            (PACKED / name).write_bytes(packed[start:start + 196608])
            parts.append(name)
        archives.append({"file": "generated/" + filename, "bytes": len(raw), "sha256": HASH(raw),
                         "packedBytes": len(packed), "packedSha256": HASH(packed), "parts": parts})
        (FONT_ROOT / "static-manifest.json").write_text(json.dumps({"version": 1, "license": "SIL Open Font License 1.1",
            "sourceFontsModified": False, "runtimeFonts": "full-Unicode static weight instances", "glyphSubsetting": False,
            "generator": {"tool": "fontTools.varLib.instancer", "version": fontTools.__version__, "optimize": True, "updateFontNames": True, "recalcTimestamp": False},
            "files": files}, ensure_ascii=False, indent=2) + "\n")
        (PACKED / "manifest.json").write_text(json.dumps({"version": 1, "encoding": "gzip", "files": archives}, indent=2) + "\n")
        print(json.dumps({"file": filename, "bytes": len(raw), "packedBytes": len(packed), "parts": len(parts), "unicodeCodepoints": len(coverage)}), flush=True)
        font.close(); reopened.close()
