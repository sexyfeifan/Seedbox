export type ItemStatus = "queued" | "parsing" | "ready" | "failed";
export type ItemSummaryStatus = "idle" | "queued" | "running" | "ready" | "failed";

export interface Item {
  id: string;
  userId: string;
  collectionId?: string;
  sourceUrl: string;
  canonicalUrl?: string;
  domain?: string;
  title?: string;
  coverImageUrl?: string;
  status: ItemStatus;
  tags: string[];
  isFavorite: boolean;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Collection {
  id: string;
  userId: string;
  parentId?: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ItemContent {
  itemId: string;
  htmlContent?: string;
  markdownContent?: string;
  plainText?: string;
  summaryShort?: string;
  wordCount?: number;
  readingMinutes?: number;
}

export type ItemAssetType = "image" | "video" | "file";

export interface ItemAsset {
  id: string;
  itemId: string;
  type: ItemAssetType;
  url: string;
  width?: number;
  height?: number;
  sortOrder: number;
  createdAt: string;
}

export interface ItemSummarySnapshot {
  itemId: string;
  status: ItemSummaryStatus;
  summaryText?: string;
  keyPoints: string[];
  errorMessage?: string;
  provider?: string;
  model?: string;
  updatedAt: string;
}

export interface Highlight {
  id: string;
  itemId: string;
  userId: string;
  quote: string;
  startOffset?: number;
  endOffset?: number;
  color: string;
  note?: string;
  createdAt: string;
}

export interface Note {
  id: string;
  itemId: string;
  userId: string;
  title?: string;
  bodyMd: string;
  createdAt: string;
  updatedAt: string;
}

export interface SyncEvent {
  id: number;
  userId: string;
  entityType: string;
  entityId: string;
  action: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export type BillingPlan = "free" | "pro_monthly";
export type BillingStatus = "active" | "canceled";

export interface BillingSubscription {
  userId: string;
  plan: BillingPlan;
  status: BillingStatus;
  provider: string;
  startedAt: string;
  currentPeriodEnd?: string;
  canceledAt?: string;
  updatedAt: string;
}
