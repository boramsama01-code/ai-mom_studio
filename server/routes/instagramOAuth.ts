import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { actorOf } from "../auth";
import { channels } from "../../shared/schema";
import { expectedInstagramUsername } from "../../shared/channelInstagram";
import { connectInstagram } from "../services/instagramConnection";
import { exchangeUnifiedInstagramCode, instagramAuthorizationUrl, instagramOAuthConfig, newInstagramOAuth, validateInstagramOAuthState } from "../services/instagramOAuth";
import { ah, HttpError, intParam, parse } from "./util";

/** Mounted behind the existing operator + CSRF middleware; callback GET still requires that session. */
export const instagramOAuthRoutes = Router();

instagramOAuthRoutes.get("/studio/instagram/oauth/config", (_req, res) => res.json(instagramOAuthConfig()));

instagramOAuthRoutes.post("/studio/instagram/:cid/oauth/start", ah(async (req, res) => {
  parse(z.object({}).strict(), req.body ?? {});
  if (req.session.demo) throw new HttpError(403, "운영자 계정으로 로그인해 연결하세요.");
  const config = instagramOAuthConfig();
  if (!config.configured) throw new HttpError(409, "Meta 앱 연결 설정을 먼저 완료해 주세요.", { code: "instagram_oauth_not_configured", missing: config.missing });
  const [channel] = await getDb().select().from(channels).where(eq(channels.id, intParam(req.params.cid)));
  if (!channel?.active) throw new HttpError(409, "사용 중인 채널을 선택하세요.");
  const username = expectedInstagramUsername(channel.slug);
  if (!username) throw new HttpError(409, "이 채널의 인스타그램 계정을 먼저 지정해 주세요.");
  const pending = newInstagramOAuth({ channelId: channel.id, username, dailyLimit: channel.budget.dailyPublishLimit });
  req.session.instagramOauth = pending;
  await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
  res.json({ url: instagramAuthorizationUrl(pending) });
}));

instagramOAuthRoutes.get("/studio/instagram/oauth/callback", ah(async (req, res) => {
  const back = (reason?: string) => res.redirect(reason ? `/instagram?instagram=error&reason=${reason}` : "/instagram?instagram=connected");
  const pending = req.session.instagramOauth;
  const state = validateInstagramOAuthState(pending, req.query.state);
  if (state === "state" || !pending) return back("state");
  // Persist consumption before exchanging a one-use code, including denial/error callbacks.
  delete req.session.instagramOauth;
  await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
  if (state === "expired") return back("expired");
  if (req.query.error) return back("denied");
  const code = req.query.code;
  if (typeof code !== "string" || !code || code.length > 4000 || /[\r\n]/.test(code)) return back("invalid_request");
  let credential;
  try { credential = await exchangeUnifiedInstagramCode(code, pending); }
  catch (error) { return back((error as Error).message === "configuration" ? "configuration" : "exchange_failed"); }
  try {
    await connectInstagram(getDb(), pending.channelId, { token: credential.token, expiresAt: credential.expiresAt, username: pending.username, dailyLimit: pending.dailyLimit, authMode: "facebook" }, actorOf(req));
  } catch (error) {
    const code = error instanceof HttpError ? error.extra?.code : null;
    return back(code === "account_mismatch" ? "account_mismatch" : code === "publishing_permission" ? "publishing_permission" : "connect_failed");
  }
  return back();
}));
