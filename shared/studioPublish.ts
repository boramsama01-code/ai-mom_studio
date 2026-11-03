export type StudioPublishPreview = {
  cardId: number; version: number; channelId: number; itemId: number; revisionId: number; assetId: number;
  caption: string; pages: Array<{ id: number; title: string; altText: string }>;
};
export type StudioPublishStatus = {
  channelId: number; channelName: string; expectedUsername: string | null;
  ready: boolean; blockers: string[]; dailyLimit: number; dryRun: boolean; autoPublish: boolean;
  destinations: Array<{ id: number; label: string; enabled: boolean; configured: boolean }>;
  deliveries: Array<{ id: number; approvalId: number; approvalStatus: string; status: string; lastError: string | null; externalUrl: string | null; scheduledAt: string }>;
};

