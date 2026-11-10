import type { AppConfig } from "../config.js";
import { HostingerInboxClient, InboxError, type InboxReader } from "./inbox-client.js";
import { mailPlainText, quoteForReply } from "./mail-content.js";

export interface ReplyContext {
  uid: number;
  to: string;
  subject: string;
  quoteHtml: string;
}

export function replySubject(subject: string | null): string {
  const base = (subject ?? "").replace(/^(?:(?:re|aw):\s*)+/iu, "").trim();
  return `Re: ${base || "Ihre Anfrage"}`.slice(0, 200);
}

/**
 * Resolves the original mail by its Message-ID (the UID can change) and builds
 * the reply recipient, subject and quoted original. The recipient is the
 * sender because the mail API exposes no Reply-To.
 */
export async function loadReplyContext(
  inbox: InboxReader,
  messageId: string,
): Promise<ReplyContext> {
  const uid = await inbox.findUidByMessageId(messageId);
  if (!uid) throw new InboxError("SOURCE_MAIL_NOT_FOUND", 409);
  const [message, content] = await Promise.all([
    inbox.getMessage(uid),
    inbox.getText(uid),
  ]);
  if (!message.from?.address) throw new InboxError("SOURCE_MAIL_NO_SENDER", 409);
  return {
    uid,
    to: message.from.address.trim().toLowerCase(),
    subject: replySubject(message.subject),
    quoteHtml: quoteForReply({
      from: message.from.name
        ? `${message.from.name} <${message.from.address}>`
        : message.from.address,
      date: new Date(message.date).toLocaleString("de-DE", {
        timeZone: "Europe/Berlin",
      }),
      text: mailPlainText(content.text, content.html),
    }),
  };
}

export function createReplyInbox(
  config: Pick<AppConfig, "mail">,
): InboxReader | null {
  return config.mail ? new HostingerInboxClient(config.mail) : null;
}
