import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  appendBylineToTitle,
  deriveTopicTitle,
  extractTagsFromText,
  mergeTags,
  sanitizeParserBodyText,
  sanitizeParserExcerpt,
  sanitizeParserMetaText,
  shouldDiscardParsedHtml
} from "../lib/content-extract.js";
import { buildStableParsedAssets, scheduleAssetCacheWarmup } from "../lib/parsed-assets.js";
import { generateSummary } from "../lib/summarizer.js";
import { buildCanonicalItemUrl, resolveCaptureSourceUrl } from "../lib/url-extract.js";
import type {
  BillingSubscription,
  Collection,
  Highlight,
  Item,
  ItemAsset,
  ItemContent,
  ItemSummarySnapshot,
  Note,
  SyncEvent
} from "../domain/models.js";
import type {
  ClientOperation,
  CreateCollectionInput,
  CreateHighlightInput,
  CreateItemInput,
  CreateNoteInput,
  DataStore,
  ListItemsInput,
  ListItemsResult,
  ParserJobClaim,
  ParserJobDiagnostics,
  ParserResultInput,
  RequestItemSummaryInput,
  SubscribeInput,
  UpdateCollectionInput,
  UpdateNoteInput,
  UpdateItemInput
} from "./store.js";

interface MemoryParserJob {
  jobId: string;
  itemId: string;
  userId: string;
  sourceUrl: string;
  status: "queued" | "running" | "done" | "failed";
  attempts: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

interface InMemoryStoreOptions {
  persistPath?: string;
  persistDebounceMs?: number;
}

interface MemoryStoreSnapshotV1 {
  version: 1;
  syncSeq: number;
  items: Item[];
  collections: Collection[];
  subscriptions: BillingSubscription[];
  contents: ItemContent[];
  assets: Array<[string, ItemAsset[]]>;
  highlights: Highlight[];
  notes: Note[];
  syncEvents: SyncEvent[];
  parserJobs: Array<[string, MemoryParserJob]>;
  summaries: Array<[string, ItemSummarySnapshot]>;
  processedSyncOperationIds: string[];
}

export class InMemoryStore implements DataStore {
  private readonly items = new Map<string, Item>();
  private readonly collections = new Map<string, Collection>();
  private readonly subscriptions = new Map<string, BillingSubscription>();
  private readonly contents = new Map<string, ItemContent>();
  private readonly assets = new Map<string, ItemAsset[]>();
  private readonly highlights = new Map<string, Highlight>();
  private readonly notes = new Map<string, Note>();
  private readonly syncEvents: SyncEvent[] = [];
  private readonly parserJobs = new Map<string, MemoryParserJob>();
  private readonly summaries = new Map<string, ItemSummarySnapshot>();
  private readonly summaryTimers = new Map<string, NodeJS.Timeout>();
  private readonly processedSyncOperationIds = new Set<string>();
  private readonly persistPath?: string;
  private readonly persistDebounceMs: number;
  private persistTimer: NodeJS.Timeout | null = null;
  private persistQueue: Promise<void> = Promise.resolve();
  private syncSeq = 0;

  constructor(options: InMemoryStoreOptions = {}) {
    this.persistPath = options.persistPath?.trim() || undefined;
    this.persistDebounceMs = clampPersistDebounce(options.persistDebounceMs);
  }

  async loadFromDisk(): Promise<void> {
    if (!this.persistPath) {
      return;
    }

    let raw: string;
    try {
      raw = await readFile(this.persistPath, "utf8");
    } catch (error) {
      const maybeError = error as NodeJS.ErrnoException;
      if (maybeError.code === "ENOENT") {
        return;
      }
      console.error("[seedbox] memory store load failed", maybeError);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      console.error("[seedbox] memory store snapshot parse failed", error);
      return;
    }

    const snapshot = parsed as Partial<MemoryStoreSnapshotV1>;
    if (snapshot.version !== 1) {
      return;
    }

    this.restoreSnapshot(snapshot);
  }

  async flushToDisk(): Promise<void> {
    if (!this.persistPath) {
      return;
    }
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    await this.persistNow();
  }

  private restoreSnapshot(snapshot: Partial<MemoryStoreSnapshotV1>): void {
    const items = Array.isArray(snapshot.items) ? (snapshot.items as Item[]) : [];
    const collections = Array.isArray(snapshot.collections) ? (snapshot.collections as Collection[]) : [];
    const subscriptions = Array.isArray(snapshot.subscriptions) ? (snapshot.subscriptions as BillingSubscription[]) : [];
    const contents = Array.isArray(snapshot.contents) ? (snapshot.contents as ItemContent[]) : [];
    const assets = Array.isArray(snapshot.assets) ? (snapshot.assets as Array<[string, ItemAsset[]]>) : [];
    const highlights = Array.isArray(snapshot.highlights) ? (snapshot.highlights as Highlight[]) : [];
    const notes = Array.isArray(snapshot.notes) ? (snapshot.notes as Note[]) : [];
    const syncEvents = Array.isArray(snapshot.syncEvents) ? (snapshot.syncEvents as SyncEvent[]) : [];
    const parserJobs = Array.isArray(snapshot.parserJobs)
      ? (snapshot.parserJobs as Array<[string, MemoryParserJob]>)
      : [];
    const summaries = Array.isArray(snapshot.summaries)
      ? (snapshot.summaries as Array<[string, ItemSummarySnapshot]>)
      : [];
    const processedSyncOperationIds = Array.isArray(snapshot.processedSyncOperationIds)
      ? (snapshot.processedSyncOperationIds as string[])
      : [];

    this.items.clear();
    for (const item of items) {
      if (item && typeof item.id === "string") {
        this.items.set(item.id, item);
      }
    }

    this.collections.clear();
    for (const collection of collections) {
      if (collection && typeof collection.id === "string") {
        this.collections.set(collection.id, collection);
      }
    }

    this.subscriptions.clear();
    for (const subscription of subscriptions) {
      if (subscription && typeof subscription.userId === "string") {
        this.subscriptions.set(subscription.userId, subscription);
      }
    }

    this.contents.clear();
    for (const content of contents) {
      if (content && typeof content.itemId === "string") {
        this.contents.set(content.itemId, content);
      }
    }

    this.assets.clear();
    for (const [itemId, itemAssets] of assets) {
      if (typeof itemId !== "string" || !Array.isArray(itemAssets)) {
        continue;
      }
      this.assets.set(itemId, itemAssets);
    }

    this.highlights.clear();
    for (const highlight of highlights) {
      if (highlight && typeof highlight.id === "string") {
        this.highlights.set(highlight.id, highlight);
      }
    }

    this.notes.clear();
    for (const note of notes) {
      if (note && typeof note.id === "string") {
        this.notes.set(note.id, note);
      }
    }

    this.syncEvents.splice(0, this.syncEvents.length, ...syncEvents);

    this.parserJobs.clear();
    for (const [jobId, job] of parserJobs) {
      if (typeof jobId !== "string" || !job) {
        continue;
      }
      this.parserJobs.set(jobId, job);
    }

    this.summaries.clear();
    for (const [key, summary] of summaries) {
      if (typeof key !== "string" || !summary) {
        continue;
      }
      this.summaries.set(key, summary);
    }

    this.processedSyncOperationIds.clear();
    for (const opId of processedSyncOperationIds) {
      if (typeof opId === "string" && opId.trim()) {
        this.processedSyncOperationIds.add(opId);
      }
    }

    const lastEventId = this.syncEvents[this.syncEvents.length - 1]?.id ?? 0;
    const syncSeq = typeof snapshot.syncSeq === "number" ? snapshot.syncSeq : 0;
    this.syncSeq = Math.max(lastEventId, syncSeq);
  }

  private schedulePersist(): void {
    if (!this.persistPath) {
      return;
    }
    if (this.persistDebounceMs <= 0) {
      void this.persistNow();
      return;
    }
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persistNow();
    }, this.persistDebounceMs);
  }

  private async persistNow(): Promise<void> {
    if (!this.persistPath) {
      return;
    }
    const persistPath = this.persistPath;
    this.persistQueue = this.persistQueue
      .then(async () => {
        const snapshot: MemoryStoreSnapshotV1 = {
          version: 1,
          syncSeq: this.syncSeq,
          items: [...this.items.values()],
          collections: [...this.collections.values()],
          subscriptions: [...this.subscriptions.values()],
          contents: [...this.contents.values()],
          assets: [...this.assets.entries()],
          highlights: [...this.highlights.values()],
          notes: [...this.notes.values()],
          syncEvents: [...this.syncEvents],
          parserJobs: [...this.parserJobs.entries()],
          summaries: [...this.summaries.entries()],
          processedSyncOperationIds: [...this.processedSyncOperationIds.values()]
        };
        await mkdir(dirname(persistPath), { recursive: true });
        const tmpPath = `${persistPath}.tmp`;
        await writeFile(tmpPath, JSON.stringify(snapshot), "utf8");
        await rename(tmpPath, persistPath);
      })
      .catch((error) => {
        console.error("[seedbox] memory store persist failed", error);
      });
    await this.persistQueue;
  }

  async createItem(userId: string, input: CreateItemInput): Promise<Item> {
    const now = new Date().toISOString();
    const canonicalUrl = buildCanonicalItemUrl(input.sourceUrl);
    const existing = [...this.items.values()].find(
      (entry) => entry.userId === userId && entry.canonicalUrl === canonicalUrl
    );
    if (existing) {
      const mergedTags = uniq([...(existing.tags ?? []), ...(input.tags ?? [])]);
      const next: Item = {
        ...existing,
        sourceUrl: input.sourceUrl,
        canonicalUrl,
        domain: safeDomain(input.sourceUrl),
        collectionId: this.resolveCollectionId(userId, input.collectionId) ?? existing.collectionId,
        title: input.titleHint ?? existing.title,
        status: "queued",
        tags: mergedTags,
        archivedAt: undefined,
        updatedAt: now
      };
      this.items.set(existing.id, next);
      const hasActiveJob = [...this.parserJobs.values()].some(
        (job) => job.itemId === existing.id && (job.status === "queued" || job.status === "running")
      );
      if (!hasActiveJob) {
        const jobId = randomUUID();
        this.parserJobs.set(jobId, {
          jobId,
          itemId: existing.id,
          userId,
          sourceUrl: input.sourceUrl,
          status: "queued",
          attempts: 0,
          createdAt: now,
          updatedAt: now
        });
      }
      this.addEvent(userId, "item", existing.id, "updated", {
        sourceUrl: next.sourceUrl,
        canonicalUrl: next.canonicalUrl,
        tags: next.tags
      });
      return next;
    }

    const id = randomUUID();
    const domain = safeDomain(input.sourceUrl);
    const collectionId = this.resolveCollectionId(userId, input.collectionId);
    const item: Item = {
      id,
      userId,
      collectionId,
      sourceUrl: input.sourceUrl,
      canonicalUrl,
      domain,
      title: input.titleHint,
      status: "queued",
      tags: uniq(input.tags ?? []),
      isFavorite: false,
      createdAt: now,
      updatedAt: now
    };
    this.items.set(id, item);
    this.contents.set(id, {
      itemId: id,
      plainText: "",
      markdownContent: "",
      htmlContent: ""
    });
    this.assets.set(id, []);
    const jobId = randomUUID();
    const nowForJob = new Date().toISOString();
    this.parserJobs.set(jobId, {
      jobId,
      itemId: id,
      userId,
      sourceUrl: input.sourceUrl,
      status: "queued",
      attempts: 0,
      createdAt: nowForJob,
      updatedAt: nowForJob
    });
    this.addEvent(userId, "item", id, "created", { sourceUrl: input.sourceUrl });
    return item;
  }

  async getItem(userId: string, itemId: string): Promise<{ item: Item; content?: ItemContent; assets: ItemAsset[] } | null> {
    const item = this.items.get(itemId);
    if (!item || item.userId !== userId) {
      return null;
    }
    return { item, content: this.contents.get(itemId), assets: this.assets.get(itemId) ?? [] };
  }

  async listItems(userId: string, input: ListItemsInput): Promise<ListItemsResult> {
    const filtered = [...this.items.values()]
      .filter((item) => item.userId === userId)
      .filter((item) => (input.status ? item.status === input.status : true))
      .filter((item) => (input.tag ? item.tags.includes(input.tag) : true))
      .filter((item) => (input.collectionId ? item.collectionId === input.collectionId : true))
      .filter((item) => {
        if (input.archived === undefined) {
          return true;
        }
        return input.archived ? Boolean(item.archivedAt) : !item.archivedAt;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const page = filtered.slice(input.offset, input.offset + input.limit);
    const next = input.offset + input.limit < filtered.length ? input.offset + input.limit : null;
    return { items: page, nextOffset: next };
  }

  async updateItem(userId: string, itemId: string, input: UpdateItemInput): Promise<Item | null> {
    const item = this.items.get(itemId);
    if (!item || item.userId !== userId) {
      return null;
    }

    const next: Item = {
      ...item,
      title: input.title ?? item.title,
      tags: input.tags ? uniq(input.tags) : item.tags,
      isFavorite: input.isFavorite ?? item.isFavorite,
      status: input.status ?? item.status,
      collectionId:
        input.collectionId === undefined ? item.collectionId : this.resolveCollectionId(userId, input.collectionId),
      archivedAt:
        input.archived === undefined
          ? item.archivedAt
          : input.archived
            ? new Date().toISOString()
            : undefined,
      updatedAt: new Date().toISOString()
    };

    this.items.set(itemId, next);
    this.addEvent(userId, "item", itemId, "updated", {
      title: next.title,
      tags: next.tags,
      collectionId: next.collectionId,
      isFavorite: next.isFavorite,
      status: next.status,
      archivedAt: next.archivedAt
    });
    return next;
  }

  async clearItemContent(userId: string, itemId: string): Promise<boolean> {
    const item = this.items.get(itemId);
    if (!item || item.userId !== userId) {
      return false;
    }
    this.contents.set(itemId, {
      itemId,
      plainText: undefined,
      markdownContent: undefined,
      htmlContent: undefined,
      summaryShort: undefined,
      wordCount: 0,
      readingMinutes: 0
    });
    this.addEvent(userId, "item", itemId, "content_cleared", {});
    return true;
  }

  async createCollection(userId: string, input: CreateCollectionInput): Promise<Collection> {
    const now = new Date().toISOString();
    const parentId = this.resolveCollectionId(userId, input.parentId);
    const collection: Collection = {
      id: randomUUID(),
      userId,
      parentId,
      name: input.name.trim(),
      sortOrder: input.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now
    };
    this.collections.set(collection.id, collection);
    this.addEvent(userId, "collection", collection.id, "created", {
      name: collection.name,
      parentId: collection.parentId,
      sortOrder: collection.sortOrder
    });
    return collection;
  }

  async listCollections(userId: string): Promise<Collection[]> {
    return [...this.collections.values()]
      .filter((collection) => collection.userId === userId)
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) {
          return a.sortOrder - b.sortOrder;
        }
        return a.createdAt.localeCompare(b.createdAt);
      });
  }

  async updateCollection(userId: string, collectionId: string, input: UpdateCollectionInput): Promise<Collection | null> {
    const collection = this.collections.get(collectionId);
    if (!collection || collection.userId !== userId) {
      return null;
    }

    let nextParentId = collection.parentId;
    if (input.parentId !== undefined) {
      nextParentId =
        input.parentId === null ? undefined : this.resolveCollectionId(userId, input.parentId ?? undefined);
      if (nextParentId === collectionId) {
        nextParentId = undefined;
      }
    }

    const next: Collection = {
      ...collection,
      name: input.name !== undefined ? input.name.trim() : collection.name,
      parentId: nextParentId,
      sortOrder: input.sortOrder ?? collection.sortOrder,
      updatedAt: new Date().toISOString()
    };
    this.collections.set(collectionId, next);
    this.addEvent(userId, "collection", collectionId, "updated", {
      name: next.name,
      parentId: next.parentId,
      sortOrder: next.sortOrder
    });
    return next;
  }

  async deleteCollection(userId: string, collectionId: string): Promise<boolean> {
    const collection = this.collections.get(collectionId);
    if (!collection || collection.userId !== userId) {
      return false;
    }

    this.collections.delete(collectionId);
    const now = new Date().toISOString();
    for (const [id, existing] of this.collections.entries()) {
      if (existing.userId === userId && existing.parentId === collectionId) {
        this.collections.set(id, {
          ...existing,
          parentId: undefined,
          updatedAt: now
        });
      }
    }
    for (const [itemId, item] of this.items.entries()) {
      if (item.userId === userId && item.collectionId === collectionId) {
        this.items.set(itemId, {
          ...item,
          collectionId: undefined,
          updatedAt: now
        });
      }
    }

    this.addEvent(userId, "collection", collectionId, "deleted", {});
    return true;
  }

  async getSubscription(userId: string): Promise<BillingSubscription> {
    return this.subscriptions.get(userId) ?? createDefaultSubscription(userId);
  }

  async subscribe(userId: string, input: SubscribeInput): Promise<BillingSubscription> {
    const now = new Date();
    const subscription: BillingSubscription = {
      userId,
      plan: input.plan,
      status: "active",
      provider: input.provider?.trim() || "mock",
      startedAt: now.toISOString(),
      currentPeriodEnd: input.plan === "pro_monthly" ? addDays(now, 30).toISOString() : undefined,
      canceledAt: undefined,
      updatedAt: now.toISOString()
    };
    this.subscriptions.set(userId, subscription);
    this.addEvent(userId, "billing_subscription", userId, "subscribed", {
      plan: subscription.plan,
      provider: subscription.provider
    });
    return subscription;
  }

  async cancelSubscription(userId: string): Promise<BillingSubscription> {
    const current = this.subscriptions.get(userId) ?? createDefaultSubscription(userId);
    const nowIso = new Date().toISOString();
    const next: BillingSubscription =
      current.plan === "free"
        ? { ...current, updatedAt: nowIso }
        : {
            ...current,
            status: "canceled",
            canceledAt: nowIso,
            updatedAt: nowIso
          };
    this.subscriptions.set(userId, next);
    this.addEvent(userId, "billing_subscription", userId, "canceled", {
      plan: next.plan,
      status: next.status
    });
    return next;
  }

  async permanentlyDeleteItem(userId: string, itemId: string): Promise<boolean> {
    const item = this.items.get(itemId);
    if (!item || item.userId !== userId) {
      return false;
    }

    this.items.delete(itemId);
    this.contents.delete(itemId);
    this.assets.delete(itemId);
    this.clearSummaryRuntimeState(userId, itemId);
    for (const [highlightId, highlight] of this.highlights.entries()) {
      if (highlight.itemId === itemId) {
        this.highlights.delete(highlightId);
      }
    }
    for (const [noteId, note] of this.notes.entries()) {
      if (note.itemId === itemId) {
        this.notes.delete(noteId);
      }
    }
    for (const [jobId, job] of this.parserJobs.entries()) {
      if (job.itemId === itemId) {
        this.parserJobs.delete(jobId);
      }
    }
    this.addEvent(userId, "item", itemId, "deleted", { permanent: true });
    return true;
  }

  async purgeArchivedItems(userId: string): Promise<number> {
    let deleted = 0;
    const toDelete: string[] = [];
    for (const item of this.items.values()) {
      if (item.userId === userId && item.archivedAt) {
        toDelete.push(item.id);
      }
    }

    for (const itemId of toDelete) {
      await this.permanentlyDeleteItem(userId, itemId);
      deleted += 1;
    }
    return deleted;
  }

  async searchItems(userId: string, query: string, limit: number): Promise<Item[]> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [];
    }

    const matches = [...this.items.values()].filter((item) => {
      if (item.userId !== userId || item.archivedAt) {
        return false;
      }
      const title = (item.title ?? "").toLowerCase();
      const sourceUrl = item.sourceUrl.toLowerCase();
      const domain = (item.domain ?? "").toLowerCase();
      return title.includes(normalized) || sourceUrl.includes(normalized) || domain.includes(normalized);
    });

    return matches.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  async requestItemSummary(
    userId: string,
    itemId: string,
    input: RequestItemSummaryInput = {}
  ): Promise<ItemSummarySnapshot | null> {
    const item = this.items.get(itemId);
    if (!item || item.userId !== userId) {
      return null;
    }

    const key = summaryKey(userId, itemId);
    const existing = this.summaries.get(key);
    const shouldReuse =
      !input.force &&
      existing &&
      (existing.status === "queued" || existing.status === "running" || existing.status === "ready");
    if (shouldReuse) {
      return existing;
    }

    this.cancelSummaryTimer(key);
    const queued: ItemSummarySnapshot = {
      itemId,
      status: "queued",
      keyPoints: [],
      updatedAt: new Date().toISOString()
    };
    this.summaries.set(key, queued);
    this.addEvent(userId, "ai_summary", itemId, "queued", { source: "manual" });
    this.summaryTimers.set(
      key,
      setTimeout(() => {
        void this.runSummaryJob(userId, itemId);
      }, 300)
    );

    return queued;
  }

  async getItemSummary(userId: string, itemId: string): Promise<ItemSummarySnapshot | null> {
    const item = this.items.get(itemId);
    if (!item || item.userId !== userId) {
      return null;
    }
    return this.summaries.get(summaryKey(userId, itemId)) ?? null;
  }

  async createHighlight(userId: string, itemId: string, input: CreateHighlightInput): Promise<Highlight | null> {
    const item = this.items.get(itemId);
    if (!item || item.userId !== userId) {
      return null;
    }
    const highlight: Highlight = {
      id: randomUUID(),
      itemId,
      userId,
      quote: input.quote.trim(),
      startOffset: input.startOffset,
      endOffset: input.endOffset,
      color: input.color?.trim() || "yellow",
      note: input.note?.trim() || undefined,
      createdAt: new Date().toISOString()
    };
    this.highlights.set(highlight.id, highlight);
    this.addEvent(userId, "highlight", highlight.id, "created", { itemId });
    return highlight;
  }

  async listHighlights(userId: string, itemId: string): Promise<Highlight[]> {
    const item = this.items.get(itemId);
    if (!item || item.userId !== userId) {
      return [];
    }
    return [...this.highlights.values()]
      .filter((highlight) => highlight.userId === userId && highlight.itemId === itemId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async deleteHighlight(userId: string, itemId: string, highlightId: string): Promise<boolean> {
    const highlight = this.highlights.get(highlightId);
    if (!highlight || highlight.userId !== userId || highlight.itemId !== itemId) {
      return false;
    }
    this.highlights.delete(highlightId);
    this.addEvent(userId, "highlight", highlightId, "deleted", { itemId });
    return true;
  }

  async createNote(userId: string, itemId: string, input: CreateNoteInput): Promise<Note | null> {
    const item = this.items.get(itemId);
    if (!item || item.userId !== userId) {
      return null;
    }
    const now = new Date().toISOString();
    const note: Note = {
      id: randomUUID(),
      itemId,
      userId,
      title: input.title?.trim() || undefined,
      bodyMd: input.bodyMd,
      createdAt: now,
      updatedAt: now
    };
    this.notes.set(note.id, note);
    this.addEvent(userId, "note", note.id, "created", { itemId });
    return note;
  }

  async listNotes(userId: string, itemId: string): Promise<Note[]> {
    const item = this.items.get(itemId);
    if (!item || item.userId !== userId) {
      return [];
    }
    return [...this.notes.values()]
      .filter((note) => note.userId === userId && note.itemId === itemId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async updateNote(userId: string, itemId: string, noteId: string, input: UpdateNoteInput): Promise<Note | null> {
    const existing = this.notes.get(noteId);
    if (!existing || existing.userId !== userId || existing.itemId !== itemId) {
      return null;
    }
    const next: Note = {
      ...existing,
      title: input.title !== undefined ? input.title.trim() || undefined : existing.title,
      bodyMd: input.bodyMd !== undefined ? input.bodyMd : existing.bodyMd,
      updatedAt: new Date().toISOString()
    };
    this.notes.set(noteId, next);
    this.addEvent(userId, "note", noteId, "updated", { itemId });
    return next;
  }

  async deleteNote(userId: string, itemId: string, noteId: string): Promise<boolean> {
    const note = this.notes.get(noteId);
    if (!note || note.userId !== userId || note.itemId !== itemId) {
      return false;
    }
    this.notes.delete(noteId);
    this.addEvent(userId, "note", noteId, "deleted", { itemId });
    return true;
  }

  async pullSync(userId: string, sinceEventId: number): Promise<{ events: SyncEvent[]; lastEventId: number }> {
    const events = this.syncEvents.filter((event) => event.userId === userId && event.id > sinceEventId);
    return { events, lastEventId: this.syncSeq };
  }

  async pushSync(
    userId: string,
    operations: ClientOperation[]
  ): Promise<{ accepted: number; rejected: number; lastEventId: number }> {
    let accepted = 0;
    let rejected = 0;
    let dirty = false;

    for (const operation of operations) {
      const opKey = `${userId}:${operation.opId}`;
      if (this.processedSyncOperationIds.has(opKey)) {
        accepted += 1;
        continue;
      }

      const applied = await this.applySyncOperation(userId, operation);
      this.processedSyncOperationIds.add(opKey);
      dirty = true;
      if (applied) {
        accepted += 1;
      } else {
        rejected += 1;
      }
    }

    if (dirty) {
      this.schedulePersist();
    }

    return { accepted, rejected, lastEventId: this.syncSeq };
  }

  async claimParserJob(): Promise<ParserJobClaim | null> {
    for (const job of this.parserJobs.values()) {
      if (job.status !== "queued") {
        continue;
      }
      const item = this.items.get(job.itemId);
      if (!item) {
        continue;
      }
      job.status = "running";
      job.attempts += 1;
      job.errorMessage = undefined;
      job.updatedAt = new Date().toISOString();
      item.status = "parsing";
      item.updatedAt = new Date().toISOString();
      this.items.set(item.id, item);
      this.schedulePersist();
      return {
        jobId: job.jobId,
        itemId: job.itemId,
        sourceUrl: job.sourceUrl,
        userId: job.userId
      };
    }
    return null;
  }

  async completeParserJob(jobId: string, result: ParserResultInput): Promise<void> {
    const job = this.parserJobs.get(jobId);
    if (!job) {
      return;
    }
    const item = this.items.get(job.itemId);
    if (!item) {
      return;
    }

    job.status = "done";
    job.errorMessage = undefined;
    job.updatedAt = new Date().toISOString();
    item.status = "ready";
    const cleanedPlainText = sanitizeParserBodyText(result.plainText);
    const cleanedMarkdownContent = sanitizeParserBodyText(result.markdownContent ?? result.plainText);
    const cleanedExcerpt = sanitizeParserExcerpt(result.excerpt);
    const cleanedMetaText = sanitizeParserMetaText(
      [result.markdownContent, result.plainText, result.excerpt].filter(Boolean).join("\n")
    );
    const cleanedHtmlContent = shouldDiscardParsedHtml(result.htmlContent) ? undefined : result.htmlContent;
    const resolvedTitle = deriveTopicTitle({
      currentTitle: item.title,
      parsedTitle: result.title,
      plainText: cleanedPlainText,
      excerpt: cleanedExcerpt
    });
    item.title = appendBylineToTitle(resolvedTitle, result.byline);
    const autoTags = extractTagsFromText(
      [result.title, cleanedExcerpt, cleanedMetaText, result.plainText].filter(Boolean).join("\n")
    );
    item.tags = mergeTags(item.tags, autoTags);
    const normalizedAssets = buildStableParsedAssets(item.id, result.assets);
    const firstImage = normalizedAssets.find((asset) => asset.type === "image");
    item.coverImageUrl = firstImage?.url || item.coverImageUrl;
    item.updatedAt = new Date().toISOString();
    this.items.set(item.id, item);

    this.contents.set(item.id, {
      itemId: item.id,
      htmlContent: cleanedHtmlContent,
      markdownContent: cleanedMetaText || cleanedMarkdownContent,
      plainText: cleanedPlainText,
      wordCount: result.wordCount,
      readingMinutes: result.readingMinutes
    });
    this.assets.set(
      item.id,
      normalizedAssets.map((asset) => ({
          id: asset.id,
          itemId: item.id,
          type: asset.type,
          url: asset.url,
          width: asset.width,
          height: asset.height,
          sortOrder: asset.sortOrder,
          createdAt: new Date().toISOString()
        }))
    );

    this.addEvent(job.userId, "item", item.id, "parsed", {
      parserVersion: result.parserVersion,
      wordCount: result.wordCount
    });
    scheduleAssetCacheWarmup(item.id, job.sourceUrl, normalizedAssets);
  }

  async failParserJob(jobId: string, reason: string): Promise<void> {
    const job = this.parserJobs.get(jobId);
    if (!job) {
      return;
    }
    const item = this.items.get(job.itemId);
    if (!item) {
      return;
    }
    job.status = "failed";
    job.errorMessage = String(reason || "").slice(0, 2000);
    job.updatedAt = new Date().toISOString();
    item.status = "failed";
    item.updatedAt = new Date().toISOString();
    this.items.set(item.id, item);
    this.addEvent(job.userId, "item", item.id, "parse_failed", { reason });
  }

  async requestItemReparse(userId: string, itemId: string): Promise<ParserJobDiagnostics | null> {
    const item = this.items.get(itemId);
    if (!item || item.userId !== userId) {
      return null;
    }

    const activeJob = [...this.parserJobs.values()]
      .filter((job) => job.itemId === itemId && (job.status === "queued" || job.status === "running"))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    if (activeJob) {
      item.status = activeJob.status === "running" ? "parsing" : "queued";
      item.updatedAt = new Date().toISOString();
      this.items.set(itemId, item);
      this.schedulePersist();
      return this.toParserDiagnostics(itemId, activeJob);
    }

    const now = new Date().toISOString();
    const jobId = randomUUID();
    const queuedJob: MemoryParserJob = {
      jobId,
      itemId,
      userId,
      sourceUrl: item.sourceUrl,
      status: "queued",
      attempts: 0,
      createdAt: now,
      updatedAt: now
    };
    this.parserJobs.set(jobId, queuedJob);

    item.status = "queued";
    item.updatedAt = now;
    this.items.set(itemId, item);
    this.addEvent(userId, "item", itemId, "reparse_requested", { jobId });

    return this.toParserDiagnostics(itemId, queuedJob);
  }

  async getParserDiagnostics(userId: string, itemId: string): Promise<ParserJobDiagnostics | null> {
    const item = this.items.get(itemId);
    if (!item || item.userId !== userId) {
      return null;
    }
    const latestJob = [...this.parserJobs.values()]
      .filter((job) => job.itemId === itemId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    return this.toParserDiagnostics(itemId, latestJob);
  }

  private async runSummaryJob(userId: string, itemId: string): Promise<void> {
    const key = summaryKey(userId, itemId);
    this.summaryTimers.delete(key);
    this.updateSummarySnapshot(userId, itemId, {
      status: "running",
      keyPoints: []
    });

    const item = this.items.get(itemId);
    if (!item || item.userId !== userId) {
      this.updateSummarySnapshot(userId, itemId, {
        status: "failed",
        keyPoints: [],
        errorMessage: "条目不存在或无权限访问"
      });
      return;
    }

    if (item.status !== "ready") {
      this.updateSummarySnapshot(userId, itemId, {
        status: "failed",
        keyPoints: [],
        errorMessage: "内容尚未解析完成"
      });
      return;
    }

    const content = this.contents.get(itemId);
    const generated = generateSummary({
      plainText: content?.plainText,
      markdownContent: content?.markdownContent,
      htmlContent: content?.htmlContent
    });

    if (!generated) {
      this.updateSummarySnapshot(userId, itemId, {
        status: "failed",
        keyPoints: [],
        errorMessage: "正文为空，无法生成摘要"
      });
      return;
    }

    const nextContent: ItemContent = {
      ...(content ?? { itemId }),
      summaryShort: generated.summaryShort
    };
    this.contents.set(itemId, nextContent);
    this.updateSummarySnapshot(userId, itemId, {
      status: "ready",
      summaryText: generated.summaryText,
      keyPoints: generated.keyPoints,
      provider: "seedbox-local",
      model: "extractive-v1",
      errorMessage: undefined
    });
    this.addEvent(userId, "ai_summary", itemId, "updated", {
      provider: "seedbox-local",
      model: "extractive-v1"
    });
  }

  private updateSummarySnapshot(
    userId: string,
    itemId: string,
    patch: Omit<ItemSummarySnapshot, "itemId" | "updatedAt"> & Partial<Pick<ItemSummarySnapshot, "updatedAt">>
  ): ItemSummarySnapshot {
    const key = summaryKey(userId, itemId);
    const next: ItemSummarySnapshot = {
      itemId,
      status: patch.status,
      summaryText: patch.summaryText,
      keyPoints: patch.keyPoints,
      errorMessage: patch.errorMessage,
      provider: patch.provider,
      model: patch.model,
      updatedAt: patch.updatedAt ?? new Date().toISOString()
    };
    this.summaries.set(key, next);
    this.schedulePersist();
    return next;
  }

  private cancelSummaryTimer(key: string): void {
    const timer = this.summaryTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.summaryTimers.delete(key);
    }
  }

  private clearSummaryRuntimeState(userId: string, itemId: string): void {
    const key = summaryKey(userId, itemId);
    this.cancelSummaryTimer(key);
    this.summaries.delete(key);
  }

  private addEvent(
    userId: string,
    entityType: string,
    entityId: string,
    action: string,
    payload: Record<string, unknown>
  ): void {
    this.syncSeq += 1;
    this.syncEvents.push({
      id: this.syncSeq,
      userId,
      entityType,
      entityId,
      action,
      payload,
      createdAt: new Date().toISOString()
    });
    this.schedulePersist();
  }

  private toParserDiagnostics(itemId: string, job?: MemoryParserJob): ParserJobDiagnostics {
    if (!job) {
      return {
        itemId,
        status: "idle",
        attempts: 0
      };
    }
    return {
      itemId,
      status: job.status,
      attempts: job.attempts,
      errorMessage: job.errorMessage,
      jobId: job.jobId,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    };
  }

  private async applySyncOperation(userId: string, operation: ClientOperation): Promise<boolean> {
    const action = operation.action;
    const clientTs = readClientTimestamp(operation.payload);
    switch (action) {
      case "create_capture": {
        const sourceUrl = readString(operation.payload, "sourceUrl");
        if (!sourceUrl) {
          return false;
        }
        const resolvedSourceUrl = await resolveCaptureSourceUrl(sourceUrl);
        const titleHint = readString(operation.payload, "titleHint");
        const tags = readStringArray(operation.payload, "tags");
        const collectionId = readString(operation.payload, "collectionId");
        await this.createItem(userId, {
          sourceUrl: resolvedSourceUrl,
          titleHint: titleHint || undefined,
          tags,
          collectionId: collectionId || undefined
        });
        return true;
      }
      case "archive": {
        const itemId = readString(operation.payload, "itemId");
        if (!itemId) {
          return false;
        }
        if (!this.shouldApplyLww(userId, itemId, clientTs)) {
          return false;
        }
        await this.updateItem(userId, itemId, { archived: true });
        return true;
      }
      case "restore": {
        const itemId = readString(operation.payload, "itemId");
        if (!itemId) {
          return false;
        }
        if (!this.shouldApplyLww(userId, itemId, clientTs)) {
          return false;
        }
        await this.updateItem(userId, itemId, { archived: false });
        return true;
      }
      case "permanent_delete": {
        const itemId = readString(operation.payload, "itemId");
        if (!itemId) {
          return false;
        }
        if (!this.shouldApplyLww(userId, itemId, clientTs)) {
          return false;
        }
        await this.permanentlyDeleteItem(userId, itemId);
        return true;
      }
      case "purge_archived": {
        await this.purgeArchivedItems(userId);
        return true;
      }
      default: {
        const entityId = readString(operation.payload, "itemId") || randomUUID();
        this.addEvent(userId, operation.entityType, entityId, action, {
          opId: operation.opId,
          ...operation.payload
        });
        return true;
      }
    }
  }

  private shouldApplyLww(userId: string, itemId: string, clientTs: number | null): boolean {
    const item = this.items.get(itemId);
    if (!item || item.userId !== userId) {
      return false;
    }
    if (clientTs === null) {
      return true;
    }
    const itemUpdatedAt = Date.parse(item.updatedAt);
    if (Number.isNaN(itemUpdatedAt)) {
      return true;
    }
    return clientTs >= itemUpdatedAt;
  }

  private resolveCollectionId(userId: string, collectionId: string | undefined | null): string | undefined {
    if (!collectionId) {
      return undefined;
    }
    const collection = this.collections.get(collectionId);
    if (!collection || collection.userId !== userId) {
      return undefined;
    }
    return collection.id;
  }
}

function safeDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function uniq(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function readStringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
}

function readClientTimestamp(payload: Record<string, unknown>): number | null {
  const raw = payload.clientTs;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) {
    return null;
  }
  return ts;
}

function summaryKey(userId: string, itemId: string): string {
  return `${userId}:${itemId}`;
}

function createDefaultSubscription(userId: string): BillingSubscription {
  const now = new Date().toISOString();
  return {
    userId,
    plan: "free",
    status: "active",
    provider: "none",
    startedAt: now,
    updatedAt: now
  };
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function clampPersistDebounce(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 800;
  }
  return Math.floor(value);
}
