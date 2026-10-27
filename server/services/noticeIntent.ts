import { sql } from "drizzle-orm";
import { contentItems, sourceDocuments } from "../../shared/schema";
import { NOTICE_PATTERNS as p } from "../../shared/noticeIntent";

/** Same precedence as classifyNotice, applied to old and new items without overwriting edits. */
export function noticeIntentSql() {
  return sql<string>`case
    when ${contentItems.kind} <> 'notice' then null
    when ${contentItems.scheduleStatus} = 'closed' then 'closed'
    when ${contentItems.title} ~* ${p.offTopic} then 'off_topic'
    when ${contentItems.title} ~* ${p.elementary} and not (${contentItems.title} ~* ${p.secondary}) then 'off_topic'
    when ${contentItems.title} ~* ${p.deadlineSoon} then 'candidate'
    when ${contentItems.title} ~* ${p.retrospective} then
      case when (${contentItems.title} || ' ' || coalesce(${sourceDocuments.snippet}, '')) ~* ${p.futureInvitation} then 'uncertain' else 'retrospective' end
    when ${contentItems.title} ~* ${p.recruitment} or coalesce(${sourceDocuments.snippet}, '') ~* ${p.invitation} then 'candidate'
    else 'uncertain' end`;
}
