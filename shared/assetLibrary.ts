import { z } from 'zod';

export const ASSET_LIBRARY_MAX_OFFSET = 1000;
export const assetLibraryQuerySchema = z.object({
  channelId: z.union([z.literal('all'), z.coerce.number().int().positive()]).default('all'),
  kind: z.enum(['all', 'image', 'video']).default('all'),
  view: z.enum(['latest', 'history', 'all']).default('latest'),
  q: z.string().trim().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(40).default(24),
  offset: z.coerce.number().int().min(0).max(ASSET_LIBRARY_MAX_OFFSET).default(0),
}).strict();
export type AssetLibraryQuery = z.infer<typeof assetLibraryQuerySchema>;
export type AssetLibraryApprovalStatus = 'active' | 'completed' | 'invalidated' | 'cancelled';
export type AssetLibraryPreview = {
  assetId: number;
  kind: 'image' | 'video';
  previewUrl: string | null;
  downloadUrl: string;
  bundleDownloadUrl?: string | null;
  mimeType: string;
  sourceRevisionId: number | null;
  studioVersion: number | null;
  approvalStatus: AssetLibraryApprovalStatus | null;
};
export type AssetLibraryItem = {
  key: string;
  kind: 'image' | 'video';
  assetId: number;
  title: string;
  name: string;
  channelId: number;
  channelName: string;
  createdAt: string;
  mimeType: string;
  sha256: string | null;
  width: number | null;
  height: number | null;
  pageCount: number;
  previewUrl: string | null;
  downloadUrl: string;
  bundleDownloadUrl?: string | null;
  current: boolean;
  approval: {
    id: number;
    status: AssetLibraryApprovalStatus;
    approvedAt: string;
    approvedBy: string;
  } | null;
  source: {
    itemId: number | null;
    sourceRevisionId: number | null;
    sourceRevisionNo: number | null;
    studioCardId: number | null;
    studioRevisionId: number | null;
    studioVersion: number | null;
    currentVersion: number;
  };
  editorUrl: string;
  /** Opens the actual saved revision; manuscript restoration does not restore an approval. */
  historyUrl: string | null;
  /** A real current-revision artifact, which may still need approval; never an old fallback. */
  currentPreview: AssetLibraryPreview | null;
};
export type AssetLibraryReply = {
  items: AssetLibraryItem[];
  hasMore: boolean;
  nextOffset: number | null;
  filters: AssetLibraryQuery;
};
