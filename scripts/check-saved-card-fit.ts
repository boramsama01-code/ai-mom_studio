/** One-time read-only diagnostic. No API keys, production writes, AI calls or posting. */
import pg from "pg";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { layoutCard as oldLayout } from "../server/services/cardBeforeFit";
import { renderCardJpeg, loadFonts, wrapText, BUILTIN_LAYOUTS, type CardStyle } from "../server/services/card";
import { buildCardModel } from "../server/services/cardModel";

type Row = { id: number; channel_id: number; kind: string; title: string; revision_id: number; payload: Record<string, any>; channel_name: string; accent: string; card_template: string; source_url: string | null };
const connectionString = process.env.CARD_DIAGNOSTIC_DATABASE_URL;
if (!connectionString) throw new Error("Read-only saved-draft diagnostic is not configured");
const db = new pg.Client({ connectionString, connectionTimeoutMillis: 8000 });
let rows: Row[] = []; const custom = new Map<number, CardStyle>();
try {
  await db.connect(); await db.query("BEGIN READ ONLY"); await db.query("SET LOCAL statement_timeout = '8s'");
  rows = (await db.query(`SELECT i.id,i.channel_id,i.kind,i.title,r.id AS revision_id,r.payload,
    c.name AS channel_name,c.accent_color AS accent,c.card_template,s.original_url AS source_url
    FROM content_items i JOIN content_revisions r ON r.id=i.current_revision_id JOIN channels c ON c.id=i.channel_id
    LEFT JOIN source_documents s ON s.id=i.primary_source_id
    WHERE i.is_sample=false AND i.kind='science_dialogue' AND i.excluded=false
    ORDER BY (i.id=5470) DESC,i.updated_at DESC LIMIT 3`)).rows;
  for (const row of rows) if (/^custom:\d+$/.test(row.card_template)) {
    const result = await db.query("SELECT layout,text_tone,overlay,background FROM card_templates WHERE id=$1 AND deleted_at IS NULL AND (channel_id IS NULL OR channel_id=$2)", [Number(row.card_template.slice(7)), row.channel_id]);
    const t = result.rows[0]; if (t) custom.set(row.id, { layout: t.layout === "header" ? "classic" : t.layout, tone: t.text_tone, overlay: t.overlay, background: t.background });
  }
  await db.query("ROLLBACK");
} finally { await db.end().catch(() => undefined); }
if (!rows.length) throw new Error("No saved science drafts found for verification");
mkdirSync("card-fit-previews", { recursive: true });
const results: Record<string, unknown>[] = [];
const checkedDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
for (const row of rows) {
  const payloadBefore = JSON.stringify(row.payload);
  let sourceOrg: string | null = null;
  try { sourceOrg = new URL(row.source_url || "").hostname.replace(/^www\./, ""); } catch { /* no source */ }
  const model = buildCardModel({ kind: row.kind, payload: row.payload, channelName: row.channel_name, accent: row.accent, sourceOrg, checkedDate });
  const oldBackgroundLines = wrapText(loadFonts().regular, model.blocks.find(b => b.field === "background")?.text || "", 34, 912).length;
  const styles: Array<{ name: string; style: CardStyle }> = BUILTIN_LAYOUTS.map(l => ({ name: l.key, style: { layout: l.key } }));
  if (custom.has(row.id)) styles.push({ name: "saved-custom", style: custom.get(row.id)! });
  for (const { name, style } of styles) {
    let previousError: string | null = null;
    try { oldLayout(model, style); } catch (e) { previousError = (e as Error).message; }
    try {
      const output = await renderCardJpeg(model, style);
      const meta = await sharp(output.jpeg).metadata();
      const file = `card-fit-previews/item-${row.id}-${name}.jpg`;
      writeFileSync(file, output.jpeg);
      results.push({ itemId: row.id, channelId: row.channel_id, revisionId: row.revision_id, title: row.title, template: name,
        selectedTemplate: row.card_template, backgroundLinesBefore: oldBackgroundLines, previousError, ok: true,
        image: file, width: meta.width, height: meta.height, channels: meta.channels,
        payloadUnchanged: JSON.stringify(row.payload) === payloadBefore,
        payloadSha256: createHash("sha256").update(payloadBefore).digest("hex") });
    } catch (e) { results.push({ itemId: row.id, template: name, backgroundLinesBefore: oldBackgroundLines, previousError, ok: false, error: (e as Error).message }); }
  }
}
const report = { checkedAt: new Date().toISOString(), scope: "Saved production draft snapshots, rendered in CI; database READ ONLY", productionWrites: 0, aiCalls: 0, externalPosts: 0, results };
writeFileSync("card-fit-saved-report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (results.some(r => r.itemId === 5470 && !r.ok)) process.exitCode = 1;
