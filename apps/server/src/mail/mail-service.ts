import {
  htmlToPlainText,
  passwordResetEmail,
  renderEmailLayout,
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
  subject: string;
  contentHtml: string;
  text?: string;
  attachments?: MailAttachment[];
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
    if (!recipients.length || recipients.some((address) => !isEmail(address))) {
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
    const message: OutgoingMail = {
      to: recipients,
      subject: input.subject.trim(),
      html: renderEmailLayout(
        input.contentHtml,
        input.signatureName,
        input.signatureColor,
      ),
      text: input.text ?? htmlToPlainText(input.contentHtml),
      ...(displayName ? { displayName } : {}),
      ...(settings?.emailFromAddress
        ? { expectedFromAddress: settings.emailFromAddress }
        : {}),
      ...(input.attachments ? { attachments: input.attachments } : {}),
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
