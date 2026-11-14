import {
  htmlToPlainText,
  passwordResetEmail,
  renderEmailLayout,
  renderReplyEmail,
} from "./email-template.js";
import {
  MailDeliveryError,
  type MailAttachment,
  type OutgoingMail,
} from "./hostinger-mail-client.js";
import type { AppSettingsDto } from "@vega/domain";
import { isValidEmailAddress } from "@vega/domain";

export type EmailKind =
  | "INQUIRY_RECEIVED"
  | "INBOX_REPLY"
  | "INBOX_OFFER"
  | "OFFER"
  | "ORDER_MESSAGE"
  | "INVOICE"
  | "CREDIT_NOTE"
  | "PAYMENT_REMINDER"
  | "INQUIRY_DECLINED"
  | "PASSWORD_RESET";

export interface SendMailInput {
  kind: EmailKind;
  to: string[];
  cc?: string[];
  subject: string;
  contentHtml: string;
  text?: string;
  attachments?: MailAttachment[];
  replyToMailUid?: number;
  displayName?: string;
  signatureName?: string | null;
  signatureColor?: "#000000" | "#28527A" | "#CB722F";
}

export interface MailTransport {
  send(message: OutgoingMail): Promise<void>;
}

export class MailService {
  constructor(
    private readonly transport: MailTransport,
    private readonly settingsProvider?: () => Promise<AppSettingsDto>,
  ) {}

  async send(input: SendMailInput): Promise<void> {
    const recipients = [
      ...new Set(input.to.map((address) => address.trim().toLowerCase())),
    ];
    const toRecipients = recipients.filter(isEmail);
    const toSet = new Set(toRecipients);
    const ccRecipients = [
      ...new Set((input.cc ?? []).map((address) => address.trim().toLowerCase())),
    ].filter((address) => !toSet.has(address));
    if (
      toRecipients.length + ccRecipients.length === 0 ||
      recipients.some((address) => !isEmail(address)) ||
      ccRecipients.some((address) => !isEmail(address))
    ) {
      throw new MailDeliveryError("INVALID_EMAIL_RECIPIENT", false);
    }
    if (
      !input.subject.trim() ||
      input.subject.length > 998 ||
      !input.contentHtml.trim()
    ) {
      throw new MailDeliveryError("INVALID_EMAIL_CONTENT", false);
    }
    const settings = await this.settingsProvider?.().catch(() => {
      throw new MailDeliveryError("MAIL_SETTINGS_UNAVAILABLE", true);
    });
    const displayName = input.displayName ?? settings?.emailFromName;
    const html = input.kind === "INBOX_REPLY" || input.kind === "INBOX_OFFER"
      ? renderReplyEmail(input.contentHtml, input.signatureName, input.signatureColor ?? "#000000")
      : renderEmailLayout(input.contentHtml, input.signatureName, input.signatureColor);
    const message: OutgoingMail = {
      to: toRecipients,
      ...(ccRecipients.length ? { cc: ccRecipients } : {}),
      subject: input.subject.trim(),
      html,
      text: input.text ?? htmlToPlainText(
        input.kind === "INBOX_REPLY" || input.kind === "INBOX_OFFER"
          ? html
          : input.contentHtml,
      ),
      ...(displayName ? { displayName } : {}),
      ...(settings?.emailFromAddress
        ? { expectedFromAddress: settings.emailFromAddress }
        : {}),
      ...(input.attachments ? { attachments: input.attachments } : {}),
      ...(input.replyToMailUid ? { replyToMailUid: input.replyToMailUid } : {}),
    };
    await this.transport.send(message);
  }

  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    const draft = passwordResetEmail(resetUrl);
    await this.send({ kind: "PASSWORD_RESET", to: [to], ...draft });
  }
}

function isEmail(value: string): boolean {
  return isValidEmailAddress(value);
}
