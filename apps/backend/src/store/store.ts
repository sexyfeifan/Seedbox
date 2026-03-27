import type {
  BillingPlan,
  BillingSubscription,
  Collection,
  Highlight,
  Item,
  ItemAsset,
  ItemContent,
  ItemStatus,
  ItemSummarySnapshot,
  Note,
  SyncEvent
} from "../domain/models.js";

export interface CreateItemInput {
  sourceUrl: string;
  titleHint?: string;
  tags?: string[];
  collectionId?: string;
}

export interface UpdateItemInput {
  title?: string;
  tags?: string[];
  isFavorite?: boolean;
  archived?: boolean;
  status?: ItemStatus;
  collectionId?: string | null;
}

export interface ListItemsInput {
  limit: number;
  offset: number;
  status?: ItemStatus;
  archived?: boolean;
  tag?: string;
  collectionId?: string;
}

export interface ListItemsResult {
  items: Item[];
  nextOffset: number | null;
}

export interface ClientOperation {
  opId: string;
  entityType: string;
  action: string;
  payload: Record<string, unknown>;
}

export interface ParserJobClaim {
  jobId: string;
  itemId: string;
  sourceUrl: string;
  userId: string;
}

export interface ParserResultInput {
  title?: string;
  byline?: string;
  excerpt?: string;
  htmlContent?: string;
  markdownContent?: string;
  plainText?: string;
  assets?: Array<{
    type: "image" | "video" | "file";
    url: string;
    width?: number;
    height?: number;
  }>;
  wordCount: number;
  readingMinutes: number;
  parserVersion: string;
}

export interface ParserJobDiagnostics {
  itemId: string;
  status: "idle" | "queued" | "running" | "done" | "failed";
  attempts: number;
  errorMessage?: string;
  jobId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RequestItemSummaryInput {
  force?: boolean;
}

export interface CreateHighlightInput {
  quote: string;
  startOffset?: number;
  endOffset?: number;
  color?: string;
  note?: string;
}

export interface CreateNoteInput {
  title?: string;
  bodyMd: string;
}

export interface UpdateNoteInput {
  title?: string;
  bodyMd?: string;
}

export interface CreateCollectionInput {
  name: string;
  parentId?: string;
  sortOrder?: number;
}

export interface UpdateCollectionInput {
  name?: string;
  parentId?: string | null;
  sortOrder?: number;
}

export interface SubscribeInput {
  plan: BillingPlan;
  provider?: string;
}

export interface DataStore {
  createItem(userId: string, input: CreateItemInput): Promise<Item>;
  getItem(userId: string, itemId: string): Promise<{ item: Item; content?: ItemContent; assets: ItemAsset[] } | null>;
  listItems(userId: string, input: ListItemsInput): Promise<ListItemsResult>;
  updateItem(userId: string, itemId: string, input: UpdateItemInput): Promise<Item | null>;
  clearItemContent(userId: string, itemId: string): Promise<boolean>;
  permanentlyDeleteItem(userId: string, itemId: string): Promise<boolean>;
  purgeArchivedItems(userId: string): Promise<number>;
  searchItems(userId: string, query: string, limit: number): Promise<Item[]>;
  requestItemSummary(
    userId: string,
    itemId: string,
    input?: RequestItemSummaryInput
  ): Promise<ItemSummarySnapshot | null>;
  getItemSummary(userId: string, itemId: string): Promise<ItemSummarySnapshot | null>;
  createHighlight(userId: string, itemId: string, input: CreateHighlightInput): Promise<Highlight | null>;
  listHighlights(userId: string, itemId: string): Promise<Highlight[]>;
  deleteHighlight(userId: string, itemId: string, highlightId: string): Promise<boolean>;
  createNote(userId: string, itemId: string, input: CreateNoteInput): Promise<Note | null>;
  listNotes(userId: string, itemId: string): Promise<Note[]>;
  updateNote(userId: string, itemId: string, noteId: string, input: UpdateNoteInput): Promise<Note | null>;
  deleteNote(userId: string, itemId: string, noteId: string): Promise<boolean>;
  createCollection(userId: string, input: CreateCollectionInput): Promise<Collection>;
  listCollections(userId: string): Promise<Collection[]>;
  updateCollection(userId: string, collectionId: string, input: UpdateCollectionInput): Promise<Collection | null>;
  deleteCollection(userId: string, collectionId: string): Promise<boolean>;
  getSubscription(userId: string): Promise<BillingSubscription>;
  subscribe(userId: string, input: SubscribeInput): Promise<BillingSubscription>;
  cancelSubscription(userId: string): Promise<BillingSubscription>;

  pullSync(userId: string, sinceEventId: number): Promise<{ events: SyncEvent[]; lastEventId: number }>;
  pushSync(
    userId: string,
    operations: ClientOperation[]
  ): Promise<{ accepted: number; rejected: number; lastEventId: number }>;

  claimParserJob(): Promise<ParserJobClaim | null>;
  completeParserJob(jobId: string, result: ParserResultInput): Promise<void>;
  failParserJob(jobId: string, reason: string): Promise<void>;
  requestItemReparse(userId: string, itemId: string): Promise<ParserJobDiagnostics | null>;
  getParserDiagnostics(userId: string, itemId: string): Promise<ParserJobDiagnostics | null>;
}
