import { and, eq, sql } from "drizzle-orm";
import type { DB } from "../db";
import { channels, contentItems } from "../../shared/schema";
import { FRYDAY_IDEAS, WEBTOON_IDEAS } from "../data/ideas";
/** Stable keys make this safe across simultaneous Render startups and future restarts. */
export async function seedIdeaBank(db: DB) {
  return db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(7193211)`);
    const rows=await tx.select().from(channels);
    const fry=rows.find(c=>c.slug==="fryday");
    const web=rows.find(c=>c.contentType==="manual" && /웹툰|webtoon/i.test(c.name+c.slug));
    let added=0;
    for(const [channel,ideas] of [[fry,FRYDAY_IDEAS],[web,WEBTOON_IDEAS]] as const){
      if(!channel) continue;
      const existing=new Set((await tx.select({key:contentItems.topicKey}).from(contentItems).where(and(eq(contentItems.channelId,channel.id),eq(contentItems.origin,"idea")))).map(i=>i.key));
      const missing=ideas.filter(idea=>!existing.has(idea.key));
      if(missing.length) await tx.insert(contentItems).values(missing.map(idea=>({channelId:channel.id,kind:"manual",origin:"idea",title:idea.title,category:idea.category,topicKey:idea.key,edited:{idea},relevance:"unknown",evidenceStatus:"needs_review"})));
      added+=missing.length;
    }
    return added;
  });
}
