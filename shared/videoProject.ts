import { z } from "zod";
export const videoSceneSchema = z.object({
  id: z.string().uuid(), mediaId: z.number().int().positive().nullable().default(null),
  title: z.string().max(200).default(""), duration: z.number().min(0.1).max(600).default(3),
  narration: z.string().max(3000).default(""), subtitle: z.string().max(2000).default(""),
  audio: z.string().max(1000).default(""),
}).strict();
export const videoProjectSchema = z.object({
  version: z.literal(1).default(1), ratio: z.enum(["9:16","16:9","1:1"]).default("9:16"),
  scenes: z.array(videoSceneSchema).max(60).default([]),
  audioGuide: z.string().max(4000).default(""),
  coverMediaId: z.number().int().positive().nullable().default(null),
  outputMediaId: z.number().int().positive().nullable().default(null),
}).strict().superRefine((project,ctx) => {
  if (new Set(project.scenes.map(scene => scene.id)).size !== project.scenes.length) ctx.addIssue({ code: "custom", path: ["scenes"], message: "장면 ID가 중복됐습니다." });
});
export type VideoProject = z.infer<typeof videoProjectSchema>;
export type VideoScene = z.infer<typeof videoSceneSchema>;
export const emptyVideoProject = (): VideoProject => videoProjectSchema.parse({});
const timecode = (seconds: number) => {
  const ms = Math.round(seconds * 1000), hours = Math.floor(ms / 3600000), minutes = Math.floor(ms / 60000) % 60, secs = Math.floor(ms / 1000) % 60;
  return `${String(hours).padStart(2,"0")}:${String(minutes).padStart(2,"0")}:${String(secs).padStart(2,"0")},${String(ms % 1000).padStart(3,"0")}`;
};
export function videoSubtitles(project: VideoProject): string {
  let elapsed = 0, index = 0;
  return project.scenes.map(scene => {
    const start = elapsed; elapsed += scene.duration;
    const text = scene.subtitle.trim(); if (!text) return "";
    index++; return `${index}\n${timecode(start)} --> ${timecode(elapsed)}\n${text}\n`;
  }).filter(Boolean).join("\n");
}
