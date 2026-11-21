import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma.js";
import { generateOrderPdf, orderPdfEditDate, orderPdfFilename } from "../pdf/order-pdf.js";
import { orderDataWithRelations, type orderRelations } from "./order-relations.js";

type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof orderRelations }>;

/** Renders the saved order state; used for downloads and mail attachments alike. */
export async function renderOrderPdf(order: OrderWithRelations): Promise<{ pdf: Buffer; filename: string }> {
  const data = orderDataWithRelations(order);
  const pricingSnapshot = data.pricingSnapshot;
  const input = {
    orderNumber: order.orderNumber, pdfFilename: order.pdfFilename, data, rates: pricingSnapshot?.rates ?? [],
    services: (pricingSnapshot?.services ?? []).map((service) => ({ ...service, show: true, media: null, description: "" })),
  };
  const [latestActivity, lastEdit] = await Promise.all([
    prisma.orderActivityEvent.findFirst({ where: { orderId: order.id, action: { in: ["UPDATED", "COPIED", "ARCHIVED", "RESTORED"] } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { action: true, createdAt: true } }),
    prisma.orderActivityEvent.findFirst({ where: { orderId: order.id, action: { in: ["UPDATED", "COPIED"] } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { createdAt: true } }),
  ]);
  return { pdf: generateOrderPdf(input, orderPdfEditDate(order, latestActivity, lastEdit)), filename: orderPdfFilename(input) };
}
