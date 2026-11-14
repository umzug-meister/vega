import type { AppConfig } from "../config.js";
import { isValidEmailAddress } from "@vega/domain";
import {
  HostingerInboxClient,
  InboxError,
  type HostingerAddress,
  type InboxReader,
  type InboxReplyReader,
} from "./inbox-client.js";
import { mailPlainText, quoteForReply } from "./mail-content.js";

export interface ReplyContext {
  uid: number;
  to: string;
  subject: string;
  quoteHtml: string;
}

export interface ReplyAllContext {
  uid: number;
  to: HostingerAddress[];
  cc: HostingerAddress[];
  subject: string;
  quoteHtml: string;
  quoteText: string;
}

export function replySubject(subject: string | null): string {
  const base = (subject ?? "").replace(/^(?:(?:re|aw):\s*)+/iu, "").trim();
  return `Re: ${base || "Ihre Anfrage"}`.slice(0, 200);
}

export function parseReplyToAddresses(sourceHeaders: string): string[] {
  const unfolded = sourceHeaders.replace(/\r?\n[\t ]+/gu, " ");
  const header = unfolded.split(/\r?\n/u).find((line) => {
    const separator = line.indexOf(":");
    return separator > 0 && line.slice(0, separator).trim().toLowerCase() === "reply-to";
  });
  const value = header?.slice((header.indexOf(":") ?? -1) + 1);
  if (!value) return [];
  const addresses = value.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+/giu) ?? [];
  return uniqueEmails(addresses);
}

export async function loadReplyAllContext(
  inbox: InboxReplyReader,
  uid: number,
): Promise<ReplyAllContext> {
  const [message, sourceHeaders, mailboxAddress, content] = await Promise.all([
    inbox.getMessage(uid),
    inbox.getSourceHeaders(uid),
    inbox.getMailboxAddress(),
    inbox.getText(uid),
  ]);
  const replyTo = parseReplyToAddresses(sourceHeaders);
  const primaryRecipients = uniqueEmails(
    replyTo.length ? replyTo : message.from ? [message.from.address] : [],
  );
  if (primaryRecipients.length === 0)
    throw new InboxError("INBOX_MESSAGE_NO_SENDER", 409);

  const ownAddress = mailboxAddress?.trim().toLowerCase();
  const primarySet = new Set(primaryRecipients);
  const cc = uniqueAddresses([...message.to, ...message.cc]).filter(
    (recipient) =>
      recipient.address.trim().toLowerCase() !== ownAddress &&
      !primarySet.has(recipient.address.trim().toLowerCase()),
  );
  const from = message.from
    ? `${message.from.name ? `${message.from.name} ` : ""}<${message.from.address}>`
    : "Unbekannter Absender";
  const date = new Date(message.date).toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
  });
  const originalText = mailPlainText(content.text, content.html).slice(0, 20_000);
  return {
    uid: message.uid,
    to: primaryRecipients.map((address) => ({
      name: address === message.from?.address ? message.from.name : "",
      address,
    })),
    cc,
    subject: replySubject(message.subject),
    quoteHtml: quoteForReply({ from, date, text: originalText }),
    quoteText: `Am ${date} schrieb ${from}:\n${originalText
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")}`,
  };
}

function uniqueEmails(addresses: string[]): string[] {
  return [...new Set(addresses.map((address) => address.trim().toLowerCase()))]
    .filter(isValidEmailAddress);
}

function uniqueAddresses(addresses: HostingerAddress[]): HostingerAddress[] {
  const seen = new Set<string>();
  return addresses.filter((recipient) => {
    const address = recipient.address.trim().toLowerCase();
    if (!isValidEmailAddress(address) || seen.has(address)) return false;
    seen.add(address);
    return true;
  });
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
