/** Safe publication prerequisites; contains no credential values or references. */
export type PublicationReadiness = {
  ready: boolean;
  blockers: string[];
  dryRun: boolean;
  autoPublish: boolean;
  /** Deprecated response field tolerated from older servers; never gates approval. */
  dailyLimit?: number;
  expectedUsername: string | null;
  destinations: Array<{ id: number; label: string; platform: string; configured: boolean }>;
};

export type PublicationOrphan = {
  ap: { id: number; scheduledAt: string; status: string; revisionId: number };
  item: { id: number; title: string; channelId: number };
  reason: string;
};
