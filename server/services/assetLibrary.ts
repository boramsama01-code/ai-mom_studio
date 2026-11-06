import { sql, type SQL } from 'drizzle-orm';
import type { DB } from '../db';
import { HttpError } from '../routes/util';
import type { AssetLibraryApprovalStatus, AssetLibraryItem, AssetLibraryQuery, AssetLibraryReply } from '../../shared/assetLibrary';
import { ASSET_LIBRARY_MAX_OFFSET } from '../../shared/assetLibrary';

type ImageRow = {
  id: number; channelId: number; channelName: string; itemId: number; title: string; origin: string;
  sourceRevisionId: number; sourceRevisionNo: number; currentVersion: number; currentRevisionId: number | null;
  studioCardId: number | null; studioRevisionId: number | null; studioVersion: number | null; currentStudioVersion: number | null;
  createdAt: Date; mimeType: string; sha256: string; width: number; height: number; pageCount: number;
  approvalId: number; approvalStatus: AssetLibraryApprovalStatus; approvedAt: Date; approvedBy: string;
  currentAssetId: number | null; currentMime: string | null; currentApprovalStatus: AssetLibraryApprovalStatus | null;
};
type VideoRow = {
  id: number; channelId: number; channelName: string; title: string; name: string; createdAt: Date; mimeType: string; hasPreview: boolean;
  itemId: number | null; studioCardId: number; studioRevisionId: number; studioVersion: number; currentVersion: number;
  currentAssetId: number | null; currentMime: string | null; currentHasPreview: boolean | null;
};
// Raw SQL execution intentionally has no ORM column decoder; pg returns timestamp strings here.
const iso = (value: Date | string) => new Date(value).toISOString();
const pattern = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
const studioSlug = sql`case card.content->>'channel' when 'highscoop' then 'opportunities' when 'highway' then 'opportunities' when 'news' then 'current-dialogue' when 'science-dialogue' then 'current-dialogue' else card.content->>'channel' end`;
const activeVideoOwner = sql`ch.active = true and card.trashed_at is null and (card.source_item_id is null or (owner.id is not null and owner.channel_id = ch.id and owner.excluded = false and owner.is_sample = false))`;
const mediaReference = sql`(
  exists (select 1 from jsonb_array_elements(case when jsonb_typeof(rev.snapshot->'experience'->'media') = 'array' then rev.snapshot->'experience'->'media' else '[]'::jsonb end) ref where ref->>'id' = media.id::text)
  or rev.snapshot->'videoProject'->>'outputMediaId' = media.id::text
  or rev.snapshot->'videoProject'->>'coverMediaId' = media.id::text
  or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(rev.snapshot->'videoProject'->'scenes') = 'array' then rev.snapshot->'videoProject'->'scenes' else '[]'::jsonb end) scene where scene->>'mediaId' = media.id::text)
)`;

/** Both branches project bounded metadata only. Image/video bodies never enter this response or Node's heap. */
export async function listAssetLibrary(db: DB, query: AssetLibraryQuery): Promise<AssetLibraryReply> {
  if (query.channelId !== 'all') {
    const channels = await db.execute<{ id: number }>(sql`select id from channels where id = ${query.channelId} and active = true`);
    if (!channels.rows.length) throw new HttpError(404, '사용 중인 채널을 찾을 수 없습니다.');
  }
  const limit = query.offset + query.limit + 1;
  const channel = query.channelId === 'all' ? sql`true` : sql`ch.id = ${query.channelId}`;
  const imageCurrent = sql`coalesce(media.revision_id = item.current_revision_id, false) and (item.origin <> 'studio' or (studio_rev.id is not null and studio_rev.version = card.version))`;
  const imageLatest = sql`(${imageCurrent}) and approval.status in ('active', 'completed')`;
  const view = (latest: SQL) => query.view === 'latest' ? latest : query.view === 'history' ? sql`not (${latest})` : sql`true`;
  const images = query.kind === 'video' ? [] : (await db.execute<ImageRow>(sql`
    select media.id, media.channel_id as "channelId", ch.name as "channelName", item.id as "itemId", item.title, item.origin,
      media.revision_id as "sourceRevisionId", revision.revision_no as "sourceRevisionNo", item.version as "currentVersion", item.current_revision_id as "currentRevisionId",
      card.id as "studioCardId", studio_rev.id as "studioRevisionId", studio_rev.version as "studioVersion", card.version as "currentStudioVersion",
      media.created_at as "createdAt", media.mime as "mimeType", media.sha256, media.width, media.height,
      case when jsonb_typeof(media.carousel->'pages') = 'array' then jsonb_array_length(media.carousel->'pages') else 1 end as "pageCount",
      approval.id as "approvalId", approval.status as "approvalStatus", approval.created_at as "approvedAt", approval.approved_by as "approvedBy",
      current_asset.id as "currentAssetId", current_asset.mime as "currentMime", current_approval.status as "currentApprovalStatus"
    from media_assets media
    join content_items item on item.id = media.content_item_id and item.channel_id = media.channel_id
    join channels ch on ch.id = item.channel_id
    join content_revisions revision on revision.id = media.revision_id and revision.content_item_id = item.id
    join lateral (select approval.id, approval.status, approval.created_at, approval.approved_by from approvals approval
      where approval.media_asset_id = media.id and approval.channel_id = media.channel_id and approval.content_item_id = item.id
        and approval.revision_id = media.revision_id and approval.card_sha256 = media.sha256
        and approval.status in ('active', 'completed', 'invalidated', 'cancelled')
      order by approval.id desc limit 1) approval on true
    left join studio_cards card on card.source_item_id = item.id
    left join lateral (select rev.id, rev.version from studio_revisions rev where item.origin = 'studio' and rev.card_id = card.id and rev.applied = true
      and revision.payload->>'studioCardId' = card.id::text and revision.payload->>'studioVersion' = rev.version::text order by rev.id desc limit 1) studio_rev on true
    left join lateral (select latest.id, latest.mime, latest.sha256 from media_assets latest
      join content_revisions latest_rev on latest_rev.id = latest.revision_id and latest_rev.content_item_id = item.id
      where latest.content_item_id = item.id and latest.channel_id = ch.id and latest.revision_id = item.current_revision_id
        and latest.kind = 'card' and latest.mime like 'image/%'
        and (item.origin <> 'studio' or (latest_rev.payload->>'studioCardId' = card.id::text and latest_rev.payload->>'studioVersion' = card.version::text))
      order by latest.id desc limit 1) current_asset on true
    left join lateral (select ap.status from approvals ap where ap.media_asset_id = current_asset.id and ap.revision_id = item.current_revision_id
      and ap.channel_id = ch.id and ap.content_item_id = item.id and ap.card_sha256 = current_asset.sha256
      and ap.status in ('active', 'completed', 'invalidated', 'cancelled') order by ap.id desc limit 1) current_approval on true
    where ch.active = true and item.excluded = false and item.is_sample = false and (card.id is null or card.trashed_at is null)
      and media.kind = 'card' and media.mime like 'image/%' and ${channel} and ${view(imageLatest)}
      and ${query.q ? sql`item.title ilike ${pattern(query.q)}` : sql`true`}
    order by media.created_at desc, media.id desc limit ${limit}
  `)).rows;
  const videoLatest = sql`matched.version = card.version`;
  const videos = query.kind === 'image' ? [] : (await db.execute<VideoRow>(sql`
    select media.id, ch.id as "channelId", ch.name as "channelName", card.content->>'title' as title, media.name, media.created_at as "createdAt",
      media.mime_type as "mimeType", media.preview is not null as "hasPreview", card.source_item_id as "itemId", card.id as "studioCardId",
      matched.id as "studioRevisionId", matched.version as "studioVersion", card.version as "currentVersion",
      current_media.id as "currentAssetId", current_media.mime_type as "currentMime", current_media.preview is not null as "currentHasPreview"
    from studio_media media
    join studio_cards card on card.id = media.card_id
    join channels ch on ch.slug = ${studioSlug}
    left join content_items owner on owner.id = card.source_item_id
    join lateral (select rev.id, rev.version from studio_revisions rev where rev.card_id = card.id and rev.applied = true and ${mediaReference}
      order by rev.version desc, rev.id desc limit 1) matched on true
    left join studio_media current_media on current_media.card_id = card.id and current_media.kind = 'video'
      and card.content->'videoProject'->>'outputMediaId' = current_media.id::text
    where ${activeVideoOwner} and media.kind = 'video' and media.mime_type in ('video/mp4', 'video/webm', 'video/quicktime')
      and ${channel} and ${view(videoLatest)}
      and ${query.q ? sql`(card.content->>'title' ilike ${pattern(query.q)} or media.name ilike ${pattern(query.q)})` : sql`true`}
    order by media.created_at desc, media.id desc limit ${limit}
  `)).rows;
  const imageItems: AssetLibraryItem[] = images.map(row => {
    const sourceHistory = `/items/${row.channelId}/${row.itemId}?tab=history&revision=${row.sourceRevisionId}`;
    const studioHistory = row.studioCardId && row.studioRevisionId ? `/studio/${row.studioCardId}?tab=history&revision=${row.studioRevisionId}` : null;
    return {key: `image:${row.id}`, kind: 'image', assetId: row.id, title: row.title, name: `${row.pageCount}장 이미지`, channelId: row.channelId, channelName: row.channelName,
      createdAt: iso(row.createdAt), mimeType: row.mimeType, sha256: row.sha256, width: row.width, height: row.height, pageCount: row.pageCount,
      previewUrl: `/api/channels/${row.channelId}/media/${row.id}`, downloadUrl: `/api/channels/${row.channelId}/media/${row.id}?download=1`,
      bundleDownloadUrl: row.pageCount > 1 ? `/api/channels/${row.channelId}/media/${row.id}/deck.zip` : null,
      current: row.sourceRevisionId === row.currentRevisionId && (row.origin !== 'studio' || row.studioVersion !== null && row.studioVersion === row.currentStudioVersion),
      approval: {id: row.approvalId, status: row.approvalStatus, approvedAt: iso(row.approvedAt), approvedBy: row.approvedBy},
      source: {itemId: row.itemId, sourceRevisionId: row.sourceRevisionId, sourceRevisionNo: row.sourceRevisionNo, studioCardId: row.studioCardId,
        studioRevisionId: row.studioRevisionId, studioVersion: row.studioVersion, currentVersion: row.origin === 'studio' ? row.currentStudioVersion ?? row.currentVersion : row.currentVersion},
      editorUrl: row.studioCardId ? `/studio/${row.studioCardId}` : `/items/${row.channelId}/${row.itemId}`,
      historyUrl: row.origin === 'studio' ? studioHistory : sourceHistory,
      currentPreview: row.currentAssetId ? {assetId: row.currentAssetId, kind: 'image', previewUrl: `/api/channels/${row.channelId}/media/${row.currentAssetId}`,
        downloadUrl: `/api/channels/${row.channelId}/media/${row.currentAssetId}?download=1`, mimeType: row.currentMime!, sourceRevisionId: row.currentRevisionId,
        studioVersion: row.origin === 'studio' ? row.currentStudioVersion : null, approvalStatus: row.currentApprovalStatus} : null,
    };
  });
  const videoItems: AssetLibraryItem[] = videos.map(row => ({key: `video:${row.id}`, kind: 'video', assetId: row.id, title: row.title, name: row.name,
    channelId: row.channelId, channelName: row.channelName, createdAt: iso(row.createdAt), mimeType: row.mimeType, sha256: null, width: null, height: null, pageCount: 1,
    previewUrl: row.hasPreview ? `/api/assets/library/videos/${row.id}/preview` : null, downloadUrl: `/api/studio/media/${row.id}?download=1`, current: row.studioVersion === row.currentVersion,
    approval: null, source: {itemId: row.itemId, sourceRevisionId: null, sourceRevisionNo: null, studioCardId: row.studioCardId,
      studioRevisionId: row.studioRevisionId, studioVersion: row.studioVersion, currentVersion: row.currentVersion},
    editorUrl: `/studio/${row.studioCardId}`, historyUrl: `/studio/${row.studioCardId}?tab=history&revision=${row.studioRevisionId}`,
    currentPreview: row.currentAssetId ? {assetId: row.currentAssetId, kind: 'video', previewUrl: row.currentHasPreview ? `/api/assets/library/videos/${row.currentAssetId}/preview` : null,
      downloadUrl: `/api/studio/media/${row.currentAssetId}?download=1`, mimeType: row.currentMime!, sourceRevisionId: null, studioVersion: row.currentVersion, approvalStatus: null} : null,
  }));
  const combined = [...imageItems, ...videoItems].sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.kind.localeCompare(b.kind) || b.assetId - a.assetId);
  const hasMore = combined.length > query.offset + query.limit;
  const nextOffset = query.offset + query.limit;
  return {items: combined.slice(query.offset, nextOffset), hasMore,
    nextOffset: hasMore && nextOffset <= ASSET_LIBRARY_MAX_OFFSET ? nextOffset : null, filters: query};
}

/** A gallery poster must not select the full video body before discarding it. */
export async function assetLibraryVideoPreview(db: DB, mediaId: number): Promise<Buffer> {
  const result = await db.execute<{ preview: Buffer | null }>(sql`select media.preview from studio_media media
    join studio_cards card on card.id = media.card_id join channels ch on ch.slug = ${studioSlug}
    left join content_items owner on owner.id = card.source_item_id
    where media.id = ${mediaId} and media.kind = 'video' and ${activeVideoOwner}
      and exists (select 1 from studio_revisions rev where rev.card_id = card.id and rev.applied = true and ${mediaReference})`);
  if (!result.rows[0]?.preview) throw new HttpError(404, '이 영상의 저장된 대표 장면을 찾을 수 없습니다.');
  return result.rows[0].preview;
}

/** The ordinary editor returns only its newest 60 revisions; old library links remain scoped and readable. */
export async function assetLibraryStudioRevision(db: DB, cardId: number, revisionId: number) {
  const result = await db.execute<{id: number; cardId: number; version: number; snapshot: unknown; instruction: string; provider: string | null; model: string | null; applied: boolean; createdAt: Date}>(sql`
    select rev.id, rev.card_id as "cardId", rev.version, rev.snapshot, rev.instruction, rev.provider, rev.model, rev.applied, rev.created_at as "createdAt"
    from studio_revisions rev join studio_cards card on card.id = rev.card_id join channels ch on ch.slug = ${studioSlug}
    left join content_items owner on owner.id = card.source_item_id
    where rev.id = ${revisionId} and card.id = ${cardId} and ${activeVideoOwner}`);
  if (!result.rows[0]) throw new HttpError(404, '이 콘텐츠의 저장된 버전을 찾을 수 없습니다.');
  return {...result.rows[0], createdAt: iso(result.rows[0].createdAt)};
}
