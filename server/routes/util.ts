import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { z, type ZodType } from "zod";
import { getDb } from "../db";
import { appSettings, channels, type Channel } from "../../shared/schema";

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next);

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "입력"}: ${i.message}`).join(", ");
    throw new HttpError(400, `입력값 오류 — ${msg}`);
  }
  return r.data;
}

export function intParam(v: unknown, name = "id"): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${name} 값이 올바르지 않습니다.`);
  return n;
}

/** 쓰기 작업은 반드시 하나의 채널을 명시해야 한다 */
export async function loadChannel(cid: unknown): Promise<Channel> {
  if (cid === "all") throw new HttpError(400, "'전체' 보기에서는 쓰기 작업을 할 수 없습니다. 채널을 하나 선택하세요.");
  let id = intParam(cid, "channelId");
  const [redirects] = await getDb().select().from(appSettings).where(eq(appSettings.key, "channel_redirects"));
  const target = (redirects?.value as Record<string, number> | undefined)?.[id];
  if (typeof target === "number" && Number.isInteger(target) && target > 0) id = target;
  const [ch] = await getDb().select().from(channels).where(eq(channels.id, id));
  if (!ch) throw new HttpError(404, "채널을 찾을 수 없습니다.");
  return ch;
}

/** 낙관적 잠금 충돌 */
export function conflict(current: unknown): never {
  throw new HttpError(409, "다른 곳에서 먼저 수정되었습니다. 최신 내용을 확인한 뒤 다시 저장하세요.", { current });
}

export const zVersion = z.number().int().positive();

