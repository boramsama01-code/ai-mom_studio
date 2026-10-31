import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { fitCardBody, MIN_CARD_BODY_SIZE, type CardBodyBlock } from "../server/services/cardBodyFit";
import { loadFonts, wrapText, renderCardJpeg, CardOverflowError, type CardModel } from "../server/services/card";
import { buildCardModel } from "../server/services/cardModel";
import { login, resetDb, setTestEnv } from "./helpers";

const paragraph = "관찰한 사실과 추측을 구분하고 근거를 확인합니다.";
const sevenLines = Array.from({ length: 7 }, (_, i) => `${i + 1}. ${paragraph}`).join("\n");
const blocks: CardBodyBlock[] = [
  { field: "background", label: "알아두면 좋은 배경", text: sevenLines, maxLines: 6 },
  { field: "discussion_questions", label: "함께 생각해 볼 질문", text: "어떤 근거가 더 필요할까?", maxLines: 3, emphasis: true },
];
function plan(input = blocks, startY = 420, emphasisBox = false) {
  const fonts = loadFonts();
  return fitCardBody(input, { width: 912, startY, footerTop: 1196, emphasisBox,
    wrap: (text, size, width, emphasis) => wrapText(emphasis ? fonts.semibold : fonts.regular, text, size, width) });
}
const normalize = (text: string) => text.replace(/\s+/g, "");
const model: CardModel = { accent: "#285f6a", brandLine: "우주펭귄상회 스튜디오", badge: "오늘의 과학 질문",
  title: "과학적 근거를 어떻게 확인할까?", blocks, footer: "출처: 확인한 원문 · 확인 2026-10-31" };

describe("card body fitting", () => {
  it("renders all seven lines instead of rejecting the legacy six-line preference", () => {
    const result = plan();
    expect(wrapText(loadFonts().regular, sevenLines, 34, 912)).toHaveLength(7);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bodySize).toBe(34); expect(result.adjusted).toBe(false);
    expect(result.blocks[0].lines).toHaveLength(7);
    expect(normalize(result.blocks[0].lines.join(" "))).toBe(normalize(sevenLines));
    expect(result.endY).toBeLessThanOrEqual(1186);
  });
  it("keeps original typography and positions for an already fitting short card", () => {
    const result = plan([{ ...blocks[0], text: "짧은 배경 설명입니다." }], 420);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.adjusted).toBe(false); expect(result.blocks[0].size).toBe(34);
    expect(result.blocks[0].labelY).toBe(420); expect(result.blocks[0].textY).toBeCloseTo(420 + 52 + 34 * .35);
    expect(result.endY).toBeCloseTo(420 + 52 + 51 + 48 - 51 * .35);
  });
  it("fits the whole body rather than filling background and overlapping the question", () => {
    const result = plan(blocks, 700);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.adjusted).toBe(true); expect(result.bodySize).toBeGreaterThanOrEqual(MIN_CARD_BODY_SIZE);
    expect(result.bodySize).toBeLessThanOrEqual(34);
    expect(result.blocks).toHaveLength(2); expect(result.endY).toBeLessThanOrEqual(1186);
    for (const entry of result.blocks) {
      expect(normalize(entry.lines.join(" "))).toBe(normalize(entry.block.text));
      const lastBaseline = entry.textY + (entry.lines.length - 1) * entry.lineHeight;
      expect(lastBaseline + entry.size * .3).toBeLessThan(entry.endY);
    }
    expect(result.blocks[1].labelY!).toBeGreaterThanOrEqual(result.blocks[0].endY);
  });
  it("measures magazine emphasis boxes and their padding with the same layout plan", () => {
    const result = plan(blocks, 610, true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const question = result.blocks[1];
    expect(question.inset).toBe(28); expect(question.box).not.toBeNull();
    expect(question.box!.top).toBeGreaterThan(result.blocks[0].textY + 6 * result.blocks[0].lineHeight);
    expect(question.textY + (question.lines.length - 1) * question.lineHeight + question.size * .3).toBeLessThan(question.box!.top + question.box!.height);
    expect(question.endY).toBeLessThanOrEqual(1186);
  });
  it("does not mutate text, fields, labels, line preferences or the source model", () => {
    const before = JSON.stringify(model); plan(model.blocks, 700); expect(JSON.stringify(model)).toBe(before);
  });
  it("skips empty blocks without consuming layout space", () => {
    const result = plan([{ ...blocks[0], text: "  \n" }]);
    expect(result).toMatchObject({ ok: true, blocks: [], endY: 420, adjusted: false });
  });
  it("returns an honest readable-limit error rather than shrinking indefinitely or clipping", async () => {
    const huge = [{ ...blocks[0], text: (paragraph + "\n").repeat(80) }];
    const result = plan(huge);
    expect(result).toMatchObject({ ok: false, field: "background" });
    if (!result.ok) expect(result.detail).toContain("내용은 자르지 않았습니다");
    await expect(renderCardJpeg({ ...model, blocks: huge })).rejects.toBeInstanceOf(CardOverflowError);
  });
  it.each(["background", "summary", "audience", "schedules", "discussion_questions"])("fits %s based on pixels instead of an arbitrary old line cap", field => {
    expect(plan([{ ...blocks[0], field, maxLines: 1, text: sevenLines }]).ok).toBe(true);
  });
  it.each(["classic", "header", "magazine", "minimal"] as const)("%s renders a seven-line background with a three-line title and preserves RGB size", async layout => {
    const before = JSON.stringify(model);
    const output = await renderCardJpeg({ ...model, title: "근거를 찾는 첫 번째 질문\n관찰을 비교하는 두 번째 질문\n함께 생각하는 세 번째 질문" }, { layout });
    const meta = await sharp(output.jpeg).metadata();
    expect([meta.format, meta.width, meta.height, meta.channels]).toEqual(["jpeg", 1080, 1350, 3]);
    expect(JSON.stringify(model)).toBe(before);
  });
  it.each(["classic", "header", "magazine", "minimal"] as const)("%s also fits on an uploaded background", async layout => {
    const background = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#142635" } }).jpeg().toBuffer();
    const output = await renderCardJpeg(model, { layout, background, tone: "light", overlay: 20 });
    expect((await sharp(output.jpeg).metadata()).channels).toBe(3);
  });
});

setTestEnv();
const { createApp } = await import("../server/app");
const { closeDb, getPool } = await import("../server/db");
let app: ReturnType<typeof createApp>;
describe("seven-line background through the saved-content API", () => {
  beforeAll(async () => { await resetDb(); app = createApp(); });
  afterAll(async () => { await closeDb(); });
  it("creates the card, reads back its JPEG, and leaves the edited draft and publishing untouched", async () => {
    const { agent, csrf } = await login(app); const headers = { "x-csrf-token": csrf };
    const created = await agent.post("/api/channels/2/items").set(headers).send({ title: "카드 자동 배치 회귀 테스트" });
    expect(created.status).toBe(201);
    const id = created.body.id;
    const before = (await agent.get(`/api/channels/2/items/${id}`)).body;
    // Exactly seven visual lines after cardModel joins the three background sentences.
    let text = "";
    while (wrapText(loadFonts().regular, text, 34, 912).length < 7) text += paragraph + " ";
    expect(wrapText(loadFonts().regular, text, 34, 912)).toHaveLength(7);
    const payload = { topic: "과학적 근거", age_band: "중학생", key_question: "근거를 어떻게 확인할까?",
      background: [text.trim(), "배경을 확인합니다.", "사실과 해석을 구분합니다."],
      discussion_questions: ["어떤 근거가 필요할까?", "관찰을 어떻게 비교할까?", "결과가 다르면 어떻게 할까?"],
      scientific_basis: "확보한 원문의 근거를 검토합니다.", misconceptions: [], parent_hints: [], safe_activity: null, sources: [], evidence: [] };
    const saved = await agent.patch(`/api/channels/2/items/${id}`).set(headers).send({ version: before.item.version, payload });
    expect(saved.status).toBe(200);
    const storedBefore = (await agent.get(`/api/channels/2/items/${id}`)).body;
    const output = await agent.post(`/api/channels/2/items/${id}/card`).set(headers).send({ templateKey: "builtin:classic" });
    expect(output.status, JSON.stringify(output.body)).toBe(200);
    const image = await agent.get(`/api/channels/2/media/${output.body.id}`);
    expect(image.status).toBe(200); expect((await sharp(image.body).metadata()).height).toBe(1350);
    const storedAfter = (await agent.get(`/api/channels/2/items/${id}`)).body;
    expect(storedAfter.current).toEqual(storedBefore.current);
    expect(storedAfter.item.version).toBe(storedBefore.item.version);
    expect(storedAfter.item.publishStatus).toBe(storedBefore.item.publishStatus);
    const count = await getPool().query("SELECT count(*)::int AS n FROM approvals WHERE content_item_id = $1", [id]);
    expect(count.rows[0].n).toBe(0);
  });
});
