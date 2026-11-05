import { describe, expect, it } from "vitest";
import sharp from "sharp";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { cardDesign } from "../shared/cardDesigns";
import { HIGHSCOOP_HANDLE, HIGHSCOOP_OUTRO_THEMES, HIGHSCOOP_OUTRO_THEME_IDS, HIGHSCOOP_PROFILE_ASSET, highscoopOutroTheme } from "../shared/highscoopOutro";
import { layoutHighscoopOutro } from "../server/services/highscoopOutro";
import { planCarousel, renderCarouselPage, renderCarouselPages, type CarouselPlan } from "../server/services/cardCarousel";
import { registeredProfileDataUrl } from "../server/services/characterVariantAssets";
import { collectionSample, renderCollectionPreview } from "../server/services/cardDesignSamples";

const copy = { version: 1, templateKey: "set:r01-blue", cover: { title: "우리의 다음 도전", subtitle: "신청하기 전에 살펴봐요" }, pages: [
  { id: "body-1", title: "참여 대상", subtitle: "대상을 확인해요", body: "중학교 재학생이 참여할 수 있습니다." },
  { id: "body-2", title: "지원 방법", subtitle: "직접 확인해요", body: "공식 공고에서 접수 방법을 확인합니다." },
  { id: "body-3", title: "일정", subtitle: "신청 전에", body: "공식 공고의 날짜와 시간을 확인합니다." },
  { id: "body-4", title: "직접 쓴 마지막 제목", subtitle: "내가 정한 안내", body: "마지막 장에 직접 쓴 문구입니다. 제출 전 서류를 다시 확인하세요." },
] };
const input = { kind: "notice", channelName: "HighScoop", channelSlug: "opportunities", accent: "#2457A6", sourceOrg: "주관 기관", checkedDate: "2026-11-05", payload: { title: "우주 체험 캠프", category: "캠프·체험", cardCopy: copy } };

describe("HighScoop themed closing cards", () => {
  it("uses the saved subcategory before incidental title words and keeps unknown channels separate", () => {
    expect(highscoopOutroTheme("고등입시", input.payload)).toBe("high_admission");
    expect(highscoopOutroTheme("중등입시", input.payload)).toBe("middle_admission");
    expect(highscoopOutroTheme("전국대회", input.payload)).toBe("competition");
    expect(highscoopOutroTheme("캠프·체험 선발모집", input.payload)).toBe("camp");
    expect(highscoopOutroTheme(null, { title: "과학고 입학설명회" })).toBe("high_admission");
    expect(planCarousel({ ...input, channelSlug: "custom-school-notice" }, { layout: "minimal", collection: "r01-blue" }).highscoopOutro).toBeUndefined();
    expect(planCarousel({ ...input, channelSlug: "highway", subcategory: "전국대회" }, { layout: "minimal", collection: "r01-blue" }).highscoopOutro).toBe("competition");
  });

  it("retains every closing field and embeds the exact supplied logo with the real handle and follow button", async () => {
    const before = structuredClone(input), style = { layout: "minimal" as const, collection: "r01-blue" };
    const plan = planCarousel({ ...input, subcategory: "고등입시" }, style);
    expect(plan.count).toBe(5);
    const final = plan.pages.at(-1)!;
    const profile = registeredProfileDataUrl(HIGHSCOOP_PROFILE_ASSET.id);
    const layout = layoutHighscoopOutro(final, style, plan.highscoopOutro!, profile);
    const visible = layout.textRuns.map(run => run.text);
    for (const value of [copy.pages[3].title, copy.pages[3].subtitle, copy.pages[3].body, final.footer, HIGHSCOOP_HANDLE, "+ 팔로우"]) expect(visible).toContain(value);
    expect(layout.svg).toContain(profile);
    expect(createHash("sha256").update(fs.readFileSync(HIGHSCOOP_PROFILE_ASSET.serverPath)).digest("hex")).toBe(HIGHSCOOP_PROFILE_ASSET.sha256);
    expect(input).toEqual(before);
    const pages = await renderCarouselPages(plan, style, null, "");
    expect(pages).toHaveLength(5);
    expect(pages.at(-1)!.altText).toContain("하이스쿱 고등입시 뒷표지");
    expect(await sharp(pages.at(-1)!.bytes).metadata()).toMatchObject({ width: 1080, height: 1350, format: "jpeg" });
  });

  it("renders distinct themes without replacing the chosen palette", async () => {
    const hashes = new Set<string>();
    for (const theme of HIGHSCOOP_OUTRO_THEME_IDS) {
      const sample = collectionSample("r05-amber"), plan: CarouselPlan = sample.plan, style = sample.style;
      plan.highscoopOutro = theme;
      const layout = layoutHighscoopOutro(plan.pages.at(-1)!, style, theme);
      expect(layout.textRuns.map(run => run.text)).toContain(HIGHSCOOP_OUTRO_THEMES[theme].label);
      expect(layout.colors.background).toBe(cardDesign("r05-amber")!.bg);
      expect(layout.colors.accent).toBe(cardDesign("r05-amber")!.accent);
      const bytes = await renderCarouselPage(plan, plan.count - 1, style, null, "");
      hashes.add(createHash("sha256").update(bytes).digest("hex"));
    }
    expect(hashes.size).toBe(HIGHSCOOP_OUTRO_THEME_IDS.length);
    for (const id of ["r01-blue", "r05-amber"]) {
      const pixel = await sharp(await renderCollectionPreview(id, 4)).extract({ left: 30, top: 500, width: 1, height: 1 }).raw().toBuffer();
      const expected = cardDesign(id)!.bg.slice(1).match(/../g)!.map(value => parseInt(value, 16));
      expected.forEach((value, i) => expect(Math.abs(pixel[i] - value)).toBeLessThanOrEqual(3));
    }
  });

  it("continues long source instructions without dropping the last paragraph", () => {
    const long = "원문의 모든 조건을 그대로 보존하고 마지막 제출 사항까지 확인합니다. ".repeat(16).trim();
    const plan = planCarousel({ ...input, payload: { title: "캠프 안내", audience: "중학생", key_details: long, uncertainties: "추가 서류와 시간을 원문에서 확인하세요." } }, { layout: "minimal", collection: "r01-blue" });
    expect(plan.count).toBeGreaterThan(5);
    expect(plan.count).toBeLessThanOrEqual(10);
    expect(plan.pages.flatMap(page => page.blocks).filter(block => block.field === "key_details").map(block => block.text).join("").replace(/\s/g, "")).toBe(long.replace(/\s/g, ""));
    expect(JSON.stringify(plan.pages)).toContain("추가 서류와 시간을 원문에서 확인하세요.");
  });
});
