import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { aiCardCopySchema, cardCopyLimits, cardCopySchema, preserveCardCopy, type CardCopy } from "../shared/cardCopy";
import { CARD_DESIGNS, cardDesignVariants } from "../shared/cardDesigns";
import { emptyPayload, payloadSchemaFor } from "../shared/payloads";
import { cardCopyFromPayload, planCarousel, renderCarouselCover, renderCarouselPages } from "../server/services/cardCarousel";
import { CardOverflowError, layoutCard, type CardStyle } from "../server/services/card";
import { layoutCollectionBody } from "../server/services/cardCollection";

const copy = (): CardCopy => ({ version: 1, templateKey: "set:n03", cover: { title: "확인한 사실로 읽는 오늘", subtitle: "사실과 아직 모르는 점을 구분해요" }, pages: Array.from({ length: 4 }, (_, i) => ({ id: `body-${i + 1}`, title: `${i + 1}번째 핵심 이야기`, subtitle: "함께 살펴볼 맥락", body: "확보한 원문에서 확인한 사실을 설명합니다. 확인이 필요한 내용은 단정하지 않고, 다음에 어떤 자료를 살펴볼지 함께 생각합니다." })) });
const payload = { ...emptyPayload("science_dialogue", "빛"), key_question: "하늘은 왜 파랄까요?", background: ["태양빛은 여러 색입니다.", "공기를 지나며 빛이 흩어집니다.", "색마다 흩어지는 정도가 다릅니다."], scientific_basis: "짧은 파장의 빛이 더 많이 산란합니다.", misconceptions: ["공기에 파란 물감이 있는 것은 아닙니다."], discussion_questions: ["저녁 하늘은 어떨까요?", "달에서도 같을까요?", "어떻게 관찰할까요?"], parent_hints: ["관찰한 점부터 이야기합니다."], safe_activity: "낮과 저녁의 하늘색을 비교합니다." };
const input = { kind: "science_dialogue", payload, channelName: "과학", accent: "#285f6a", sourceOrg: "확인한 원문", checkedDate: "2026-11-02" };

describe("editable template card copy", () => {
  it("keeps source facts and manually edited copy through every payload schema and source regeneration", () => {
    for (const kind of ["notice", "science_dialogue", "current_dialogue"]) {
      const source = emptyPayload(kind, "원래 제목");
      const parsed = payloadSchemaFor(kind).parse({ ...source, cardCopy: copy() });
      expect(parsed.cardCopy).toEqual(copy());
      const next = preserveCardCopy({ ...source, cardCopy: { ...copy(), cover: { title: "다시 만든 AI 제목", subtitle: "" } } }, parsed);
      expect(next.cardCopy).toEqual(copy());
      expect({ ...next, cardCopy: undefined }).toEqual({ ...source, cardCopy: undefined });
    }
  });

  it("uses Unicode characters for the strict 140-character AI budget while retaining longer legacy manual text", () => {
    const data = copy(); data.pages[0].body = "🐧".repeat(140);
    expect(aiCardCopySchema.safeParse(data).success).toBe(true);
    data.pages[0].body += "🐧";
    expect(aiCardCopySchema.safeParse(data).success).toBe(false);
    expect(cardCopySchema.safeParse(data).success).toBe(true);
    data.pages[0].body = "가".repeat(1001);
    expect(cardCopySchema.safeParse(data).success).toBe(false);
    data.pages[0].body = "본문"; data.pages[1].id = data.pages[0].id;
    expect(cardCopySchema.safeParse(data).success).toBe(false);
    expect(cardCopyLimits("set:n03-mint").layoutId).toBe("n03");
    expect(cardCopyLimits("set:n03-mint").recommended.body).toBe(140);
  });

  it("migrates legacy pages without removing their body text or section labels", () => {
    const long = "긴 문장도 중간을 버리지 않고 다음 카드에 남깁니다. ".repeat(20);
    const legacyInput = { ...input, payload: { ...payload, scientific_basis: long } };
    const style: CardStyle = { layout: "classic" };
    const plan = planCarousel(legacyInput, style);
    const migrated = cardCopyFromPayload(legacyInput, style, "builtin:classic");
    expect(migrated.pages).toHaveLength(plan.pages.length);
    plan.pages.forEach((page, index) => {
      for (const block of page.blocks) {
        expect(migrated.pages[index].body).toContain(block.text);
        if (block.label) expect(migrated.pages[index].subtitle + migrated.pages[index].body).toContain(block.label);
      }
    });
    const before = JSON.stringify(migrated);
    const switched = cardCopyFromPayload({ ...input, payload: { ...payload, cardCopy: migrated } }, { layout: "minimal", collection: "n03" }, "set:n03-sand");
    expect(switched).toEqual({ ...migrated, templateKey: "set:n03-sand" });
    expect(JSON.stringify(migrated)).toBe(before);
  });

  it("uses edited title, subtitle and body as the exact render model without changing facts or captions", () => {
    const data = copy(); const source = { ...payload, cardCopy: data }; const before = JSON.stringify(source);
    const plan = planCarousel({ ...input, payload: source }, { layout: "minimal", collection: "n03" });
    expect(plan.count).toBe(5);
    expect(plan.base).toMatchObject({ title: data.cover.title, subtitle: data.cover.subtitle });
    data.pages.forEach((page, i) => expect(plan.pages[i]).toMatchObject({ title: page.title, subtitle: page.subtitle, blocks: [{ label: page.subtitle, text: page.body }] }));
    expect(JSON.stringify(source)).toBe(before);
    data.pages[0].body = "가".repeat(1000);
    expect(() => planCarousel({ ...input, payload: { ...payload, cardCopy: data } }, { layout: "minimal", collection: "n03" })).toThrow(CardOverflowError);
    expect(data.pages[0].body).toHaveLength(1000);
  });

  it.each(CARD_DESIGNS)("$id fits the AI field limits and actually draws an edited cover subtitle", async design => {
    const data = copy(); data.templateKey = `set:${design.id}`;
    data.cover = { title: "가".repeat(80), subtitle: "나".repeat(60) };
    data.pages[0] = { ...data.pages[0], title: "다".repeat(60), subtitle: "라".repeat(60), body: "마".repeat(140) };
    const style: CardStyle = { layout: "minimal", collection: design.id };
    const plan = planCarousel({ ...input, payload: { ...payload, cardCopy: data } }, style);
    for (const variant of cardDesignVariants(design.id)) expect(() => layoutCollectionBody(plan.pages[0], variant.id)).not.toThrow();
    const cover = await renderCarouselCover(plan.base, plan.count, null, "", style);
    const blank = await renderCarouselCover({ ...plan.base, subtitle: "" }, plan.count, null, "", style);
    expect(cover.equals(blank)).toBe(false);
    expect(await sharp(cover).metadata()).toMatchObject({ width: 1080, height: 1350, format: "jpeg" });
    const body = layoutCollectionBody(plan.pages[0], design.id);
    expect(body).not.toBe(layoutCollectionBody({ ...plan.pages[0], blocks: [{ ...plan.pages[0].blocks[0], label: "수정한 부제" }] }, design.id));
  });

  it("renders wrapped subtitles on custom/builtin layouts and binds body edits to the immutable cover hash", async () => {
    const data = copy(); data.pages[0].subtitle = "부제".repeat(30);
    const style: CardStyle = { layout: "classic" };
    const plan = planCarousel({ ...input, payload: { ...payload, cardCopy: data } }, style);
    expect(() => layoutCard(plan.pages[0], style)).not.toThrow();
    const first = await renderCarouselPages(plan, style, null, "");
    const edited = structuredClone(data); edited.pages[0].body = "사용자가 직접 수정한 본문입니다.";
    const second = await renderCarouselPages(planCarousel({ ...input, payload: { ...payload, cardCopy: edited } }, style), style, null, "");
    expect(first[0].bytes.equals(second[0].bytes)).toBe(false);
    expect(first[1].bytes.equals(second[1].bytes)).toBe(false);
    expect(first[2].bytes.equals(second[2].bytes)).toBe(true);
  });
});
