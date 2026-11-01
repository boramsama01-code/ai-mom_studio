import { eq, sql } from "drizzle-orm";
import type { DB } from "../db";
import { appSettings, channels } from "../../shared/schema";
import { CHANNEL_ORDER_KEY, channelIdsSchema } from "./channelOrder";

export const CHANNEL_REDIRECTS_KEY = "channel_redirects";
const MARKER = "alligodang_consolidated_v1";
/** One transaction, one startup lock; retain every item, revision and historical audit entry. */
export async function consolidateAlligodang(db: DB) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(7193210)`);
    if ((await tx.select().from(appSettings).where(eq(appSettings.key, MARKER))).length) return false;
    const rows = await tx.select().from(channels);
    const source = rows.find(c => c.slug === "science-dialogue");
    const target = rows.find(c => c.slug === "current-dialogue");
    const parent = rows.find(c => c.slug === "penguin");
    if (!source || !target || !parent) return false;
    // Workers must finish before moving their input. Retry at the next deployment.
    const active = await tx.execute(sql`select id from jobs where channel_id in (${source.id},${target.id}) and status = 'running' limit 1`);
    if (active.rows.length) throw new Error("알리고당 통합: 실행 중인 채널 작업이 끝난 뒤 다시 시작해 주세요.");
    // The unique collected URL key stays with the target. A second editorial draft retains
    // its source through a fallback link, including any separate manually pasted source.
    await tx.execute(sql`insert into content_sources(content_item_id,source_document_id,role)
      select s.id,s.primary_source_id,'merged_primary' from content_items s
      where s.channel_id=${source.id} and exists(select 1 from content_items t where t.channel_id=${target.id} and t.primary_source_id=s.primary_source_id)
      on conflict(content_item_id,source_document_id) do update set role=case when content_sources.role='manual_primary' then content_sources.role else 'merged_primary' end`);
    await tx.execute(sql`update content_items s set primary_source_id=null where s.channel_id=${source.id} and exists(select 1 from content_items t where t.channel_id=${target.id} and t.primary_source_id=s.primary_source_id)`);
    await tx.execute(sql`update search_rules s set deleted_at=now(),enabled=false,version=version+1 where s.channel_id=${source.id} and s.deleted_at is null and exists(select 1 from search_rules t where t.channel_id=${target.id} and t.deleted_at is null and t.endpoint=s.endpoint and t.normalized_query=s.normalized_query)`);
    // Keep the old discovery topics as ordinary searchable keywords; the discovery UI
    // supports eight topics and must not silently truncate either channel's list.
    const discovery = source.budget?.discovery;
    for (const query of discovery?.queries ?? []) {
      const normalized = query.trim().replace(/\s+/g," ").toLocaleLowerCase();
      await tx.execute(sql`insert into search_rules(channel_id,query,normalized_query,endpoint,enabled,memo)
        values(${target.id},${query},${normalized},'news',${!!discovery?.enabled},'과학 채널의 자동 화제 탐색 주제에서 통합') on conflict do nothing`);
    }
    // Preserve independently configured records even when display names collide.
    await tx.execute(sql`update official_sources s set name=s.name || ' · 과학 통합 #' || s.id where s.channel_id=${source.id} and exists(select 1 from official_sources t where t.channel_id=${target.id} and t.name=s.name)`);
    await tx.execute(sql`update destinations s set label=s.label || ' · 과학 통합 #' || s.id where s.channel_id=${source.id} and exists(select 1 from destinations t where t.channel_id=${target.id} and t.platform=s.platform and t.label=s.label)`);
    for (const table of ["content_items", "search_rules", "official_sources", "runs", "media_assets", "card_templates", "approvals", "destinations", "deliveries"]) {
      await tx.execute(sql`update ${sql.identifier(table)} set channel_id=${target.id} where channel_id=${source.id}`);
    }
    // Pending collection is redundant after consolidation; explicit item jobs retain their inputs.
    await tx.execute(sql`update jobs set status='cancelled',finished_at=now(),last_error='알리고당 통합 후 수집함에서 다시 수집할 수 있습니다.' where channel_id=${source.id} and type='collect' and status='queued'`);
    await tx.execute(sql`update jobs set channel_id=${target.id},payload=case when payload ? 'channelId' then jsonb_set(payload,'{channelId}',to_jsonb(${target.id}::int)) else payload end where channel_id=${source.id}`);
    await tx.execute(sql`update studio_cards set content=jsonb_set(content,'{channel}','"news"'),version=version+1,updated_at=now() where content->>'channel'='science-dialogue'`);
    await tx.update(channels).set({ active:false, name:"Alligodang · 통합 보관", version:source.version+1, updatedAt:new Date() }).where(eq(channels.id,source.id));
    await tx.update(channels).set({ name:"Alligodang", description:"과학·AI·사회·문화, 아이와 함께 나누는 이슈와 질문", version:target.version+1, updatedAt:new Date() }).where(eq(channels.id,target.id));
    const [oldOrder] = await tx.select().from(appSettings).where(eq(appSettings.key,CHANNEL_ORDER_KEY));
    const parsed = channelIdsSchema.safeParse(oldOrder?.value);
    const order = [parent.id,...new Set([...(parsed.success?parsed.data:rows.map(c=>c.id)),...rows.map(c=>c.id)].map(id=>id===source.id?target.id:id).filter(id=>id!==parent.id))];
    const [redirects] = await tx.select().from(appSettings).where(eq(appSettings.key,CHANNEL_REDIRECTS_KEY));
    for (const [key,value] of [[CHANNEL_ORDER_KEY,order],[CHANNEL_REDIRECTS_KEY,{...(redirects?.value as object ?? {}),[source.id]:target.id}],[MARKER,{sourceId:source.id,targetId:target.id,completedAt:new Date().toISOString()}]] as const) {
      await tx.insert(appSettings).values({key,value}).onConflictDoUpdate({target:appSettings.key,set:{value,updatedAt:new Date()}});
    }
    return true;
  });
}
