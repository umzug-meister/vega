import { prisma } from "../prisma.js";

export const SIGNATURE_NAME_MAX = 100;
export const SIGNATURE_COLORS = ["#000000", "#28527A", "#CB722F"] as const;
export type SignatureColor = (typeof SIGNATURE_COLORS)[number];

export function validateSignatureColor(
  input: unknown,
): { ok: true; value: SignatureColor } | { ok: false; message: string } {
  const value = input === undefined ? SIGNATURE_COLORS[0] : input;
  if (
    typeof value !== "string" ||
    !SIGNATURE_COLORS.includes(value as SignatureColor)
  ) {
    return {
      ok: false,
      message: "Bitte wählen Sie Schwarz, Blau oder Orange als Signaturfarbe.",
    };
  }
  return { ok: true, value: value as SignatureColor };
}

export type SignatureNameValidation =
  { ok: true; value: string | null } | { ok: false; message: string };

/** Empty input clears the signature; control characters would break the mail header block. */
export function validateSignatureName(input: unknown): SignatureNameValidation {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== "string")
    return { ok: false, message: "Bitte geben Sie einen gültigen Namen ein." };
  const value = input.trim().replace(/\s+/gu, " ");
  if (!value) return { ok: true, value: null };
  if (value.length > SIGNATURE_NAME_MAX)
    return {
      ok: false,
      message: `Der Name darf höchstens ${SIGNATURE_NAME_MAX} Zeichen lang sein.`,
    };
  if (/\p{Cc}/u.test(value))
    return { ok: false, message: "Bitte geben Sie einen gültigen Namen ein." };
  return { ok: true, value };
}

export async function loadSignature(
  userId: string,
): Promise<{ signatureName: string | null; signatureColor: SignatureColor }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { signatureName: true, signatureColor: true },
  });
  const color = validateSignatureColor(user?.signatureColor);
  return {
    signatureName: user?.signatureName ?? null,
    signatureColor: color.ok ? color.value : SIGNATURE_COLORS[0],
  };
}
