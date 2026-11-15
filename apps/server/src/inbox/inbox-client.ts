import type { HostingerMailConfig } from "../config.js";

export const INBOX_FOLDER = "INBOX";
const INBOX_TIMEOUT_MS = 30_000;

export class InboxError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "InboxError";
  }
}

export interface HostingerAddress {
  name: string;
  address: string;
}

export interface HostingerAttachment {
  id: string;
  contentType: string;
  sizeBytes: number;
  inline: boolean;
  filename: string | null;
  contentId: string | null;
}

export interface HostingerMessage {
  uid: number;
  date: string;
  unseen: boolean;
  subject: string | null;
  from: HostingerAddress | null;
  to: HostingerAddress[];
  cc: HostingerAddress[];
  messageId: string | null;
  attachments: HostingerAttachment[];
}

export interface HostingerMessagePage {
  messages: HostingerMessage[];
  pagination: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
}

export interface InboxMailText {
  text: string;
  html: string;
}

/** Read access to the INBOX; the interface lets tests and routes work without Hostinger. */
export interface InboxReader {
  listMessages(options: {
    page: number;
    perPage: number;
    search?: string;
  }): Promise<HostingerMessagePage>;
  getMessage(uid: number): Promise<HostingerMessage>;
  getText(uid: number): Promise<InboxMailText>;
  findUidByMessageId(messageId: string): Promise<number | null>;
  downloadAttachment(
    uid: number,
    attachmentId: string,
    maxBytes: number,
  ): Promise<Buffer>;
}

export interface InboxReplyReader extends InboxReader {
  getSourceHeaders(uid: number): Promise<string>;
  getMailboxAddress(): Promise<string | null>;
}

/**
 * Read access to the INBOX of the configured Hostinger mailbox. Error bodies are
 * never logged or forwarded because they can contain mail details; callers get
 * a machine-readable code only. Note: Hostinger marks a message as \Seen when
 * its text is fetched.
 */
export class HostingerInboxClient implements InboxReplyReader {
  constructor(
    private readonly config: HostingerMailConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = INBOX_TIMEOUT_MS,
  ) {}

  async listMessages(options: {
    page: number;
    perPage: number;
    search?: string;
  }): Promise<HostingerMessagePage> {
    const query = new URLSearchParams({
      page: String(options.page),
      perPage: String(options.perPage),
      sort: "-uid",
    });
    const search = options.search?.trim();
    const body = await this.request(
      `${this.folderPath()}/messages${search ? "/search" : ""}?${query}`,
      search
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: search.slice(0, 1024) }),
          }
        : {},
    );
    const record = asRecord(body);
    const data = Array.isArray(record?.data) ? record.data : [];
    const pagination = asRecord(record?.pagination);
    return {
      messages: data.map(parseMessage).filter(isPresent),
      pagination: {
        page: toInt(pagination?.page, options.page),
        perPage: toInt(pagination?.perPage, options.perPage),
        total: toInt(pagination?.total, 0),
        totalPages: toInt(pagination?.totalPages, 0),
      },
    };
  }

  async getMessage(uid: number): Promise<HostingerMessage> {
    const body = asRecord(
      await this.request(`${this.folderPath()}/messages/${uid}`),
    );
    const message = parseMessage(body?.data);
    if (!message) throw new InboxError("INBOX_BAD_RESPONSE", 502);
    return message;
  }

  async getText(uid: number): Promise<InboxMailText> {
    const body = asRecord(
      await this.request(`${this.folderPath()}/messages/${uid}/text`),
    );
    const data = asRecord(body?.data);
    return {
      text: typeof data?.text === "string" ? data.text : "",
      html: typeof data?.html === "string" ? data.html : "",
    };
  }

  async getSourceHeaders(uid: number): Promise<string> {
    const response = await this.fetchRaw(
      `${this.folderPath()}/messages/${uid}/source`,
      { headers: { Accept: "message/rfc822" } },
    );
    const reader = response.body?.getReader();
    if (!reader) throw new InboxError("INBOX_BAD_SOURCE", 502);

    const decoder = new TextDecoder();
    let source = "";
    let bytesRead = 0;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      void reader.cancel();
    }, this.timeoutMs);
    try {
      while (bytesRead <= 65_536) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        bytesRead += value.byteLength;
        source += decoder.decode(value, { stream: true });
        const endOfHeaders = source.search(/\r?\n\r?\n/u);
        if (endOfHeaders >= 0) return source.slice(0, endOfHeaders);
      }
      if (timedOut) throw new InboxError("INBOX_TIMEOUT", 502);
      throw new InboxError("INBOX_BAD_SOURCE", 502);
    } catch (error) {
      if (error instanceof InboxError) throw error;
      throw new InboxError(
        timedOut ? "INBOX_TIMEOUT" : "INBOX_NETWORK_ERROR",
        502,
      );
    } finally {
      clearTimeout(timeout);
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  async getMailboxAddress(): Promise<string | null> {
    const body = asRecord(await this.request("/api/v1/me"));
    const data = asRecord(body?.data);
    const mailboxes = Array.isArray(data?.mailboxes)
      ? data.mailboxes.map(asRecord).filter(isPresent)
      : [];
    const mailbox = mailboxes.find(
      (item) => item.resourceId === this.config.mailboxResourceId,
    );
    return typeof mailbox?.address === "string" ? mailbox.address : null;
  }

  /** Finds the current UID of a message by its Message-ID; UIDs are not stable. */
  async findUidByMessageId(messageId: string): Promise<number | null> {
    const query = new URLSearchParams({
      page: "1",
      perPage: "5",
      sort: "-uid",
    });
    const body = asRecord(
      await this.request(`${this.folderPath()}/messages/search?${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ header: `Message-ID:${messageId}` }),
      }),
    );
    const data = Array.isArray(body?.data) ? body.data : [];
    const match = data
      .map(parseMessage)
      .find((message) => message?.messageId === messageId);
    return match?.uid ?? null;
  }

  async downloadAttachment(
    uid: number,
    attachmentId: string,
    maxBytes: number,
  ): Promise<Buffer> {
    const response = await this.fetchRaw(
      `${this.folderPath()}/messages/${uid}/attachments/${encodeURIComponent(attachmentId)}`,
    );
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new InboxError("INBOX_ATTACHMENT_TOO_LARGE", 413);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new InboxError("INBOX_BAD_RESPONSE", 502);
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new InboxError("INBOX_ATTACHMENT_TOO_LARGE", 413);
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof InboxError) throw error;
      throw new InboxError("INBOX_NETWORK_ERROR", 502);
    }
    return Buffer.concat(chunks);
  }

  private folderPath(): string {
    return `/api/v1/mailboxes/${encodeURIComponent(this.config.mailboxResourceId)}/folders/${INBOX_FOLDER}`;
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    const response = await this.fetchRaw(path, {
      ...init,
      headers: { Accept: "application/json", ...init.headers },
    });
    try {
      return await response.json();
    } catch {
      throw new InboxError("INBOX_BAD_RESPONSE", 502);
    }
  }

  private async fetchRaw(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(
        new URL(path, this.config.apiBaseUrl),
        {
          ...init,
          headers: {
            ...init.headers,
            Authorization: `Bearer ${this.config.apiToken}`,
          },
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new InboxError(
          response.status === 404
            ? "INBOX_MESSAGE_NOT_FOUND"
            : response.status === 401 || response.status === 403
              ? "INBOX_ACCESS_DENIED"
              : "INBOX_UPSTREAM_ERROR",
          response.status === 404 ? 404 : 502,
        );
      }
      return response;
    } catch (error) {
      if (error instanceof InboxError) throw error;
      throw new InboxError(
        controller.signal.aborted ? "INBOX_TIMEOUT" : "INBOX_NETWORK_ERROR",
        502,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : fallback;
}

function parseAddress(value: unknown): HostingerAddress | null {
  const record = asRecord(value);
  if (!record || typeof record.address !== "string") return null;
  return {
    name: typeof record.name === "string" ? record.name : "",
    address: record.address,
  };
}

function parseMessage(value: unknown): HostingerMessage | null {
  const record = asRecord(value);
  if (!record || typeof record.uid !== "number") return null;
  const attachments = Array.isArray(record.attachments)
    ? record.attachments
        .map((entry): HostingerAttachment | null => {
          const item = asRecord(entry);
          if (!item || typeof item.id !== "string") return null;
          return {
            id: item.id,
            contentType:
              typeof item.contentType === "string"
                ? (item.contentType.toLowerCase().split(";")[0] ?? "").trim()
                : "application/octet-stream",
            sizeBytes: toInt(item.sizeBytes, 0),
            inline: item.inline === true,
            filename: typeof item.filename === "string" ? item.filename : null,
            contentId:
              typeof item.contentId === "string" ? item.contentId : null,
          };
        })
        .filter(isPresent)
    : [];
  return {
    uid: record.uid,
    date: typeof record.date === "string" ? record.date : "",
    unseen: record.unseen === true,
    subject: typeof record.subject === "string" ? record.subject : null,
    from: parseAddress(record.from),
    to: Array.isArray(record.to)
      ? record.to.map(parseAddress).filter(isPresent)
      : [],
    cc: Array.isArray(record.cc)
      ? record.cc.map(parseAddress).filter(isPresent)
      : [],
    messageId: typeof record.messageId === "string" ? record.messageId : null,
    attachments,
  };
}
