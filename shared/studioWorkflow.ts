import { studioContentSchema, type StudioContent, type StudioGeneration } from "./studio";
import { studioPoseGuide } from "./studioCharacters";

/** Local, free proposal. Copy only user-authored publishing text, never private planning notes. */
export function studioCaptionDraft(content: Pick<StudioContent, "title" | "script" | "panels">): string {
  const dialogue = content.panels.map(p => p.dialogue.trim()).filter(Boolean).join("\n\n");
  const body = dialogue || content.script.trim();
  if (!body) return "";
  return [content.title.trim(), body].filter(Boolean).join("\n\n").slice(0, 8000);
}

export function studioInstruction(input: Pick<StudioGeneration, "kind" | "textTarget" | "instruction">): string {
  if (input.instruction.trim()) return input.instruction.trim();
  if (input.kind === "image") return "작성된 장면과 대사의 상황·감정을 바탕으로 이 컷을 그려 주세요. 대사는 그림에 넣지 않습니다.";
  if (input.textTarget === "caption") return "이미 작성된 원고와 컷 구성에 맞는 짧고 자연스러운 게시용 캡션을 작성해 주세요. 새로운 사실은 추가하지 마세요.";
  return "제목·기획·기존 원고와 대사를 바탕으로 원고, 네 컷의 장면·대사, 캡션의 빈칸만 완성해 주세요. 이미 쓴 내용은 그대로 유지하세요.";
}

type TextDraft = Pick<StudioContent, "title" | "script" | "caption"> & { panels: Array<{ scene: string; dialogue: string }> };
export function studioChangedTextFields(before: StudioContent, after: StudioContent): string[] {
  const fields = ([['title', '제목'], ['script', '전체 원고'], ['caption', '게시용 캡션']] as const)
    .filter(([key]) => before[key] !== after[key]).map(([, label]) => String(label));
  after.panels.forEach((p, i) => {
    if (p.scene !== before.panels[i].scene) fields.push(`${i + 1}컷 장면`);
    if (p.dialogue !== before.panels[i].dialogue) fields.push(`${i + 1}컷 대사`);
  });
  return fields;
}
/** Enforce preservation in code, not just in the model's instructions. */
export function applyStudioText(content: StudioContent, generated: TextDraft, target: "rewrite" | "fill"): StudioContent {
  const fill = target === "fill";
  const choose = (old: string, next: string) => fill && old.trim() ? old : next;
  return studioContentSchema.parse({
    ...content,
    title: choose(content.title, generated.title), script: choose(content.script, generated.script),
    caption: choose(content.caption, generated.caption), stage: "review",
    panels: generated.panels.map((p, i) => ({
      scene: choose(content.panels[i].scene, p.scene), dialogue: choose(content.panels[i].dialogue, p.dialogue),
      imageId: fill || content.panels[i].scene === p.scene ? content.panels[i].imageId : null,
      poseRefs: content.panels[i].poseRefs ?? [],
    })),
  });
}

/** Keep context bounded so four long scenes cannot prevent image generation. */
export function studioImageContext(content: StudioContent, panelIndex: number): string {
  const panel = content.panels[panelIndex];
  return `제목: ${content.title}\n전체 흐름:\n${content.panels.map((p, i) => `${i + 1}컷: ${p.scene.slice(0, 700)} / 대사: ${p.dialogue.slice(0, 300)}`).join("\n")}\n이번에는 ${panelIndex + 1}번째 한 컷만 그린다.\n이번 컷 장면: ${panel.scene}\n이번 컷 대사(표정·상황 참고용, 그림에 글자로 넣지 않음): ${panel.dialogue}\n${studioPoseGuide(panel)}`;
}

