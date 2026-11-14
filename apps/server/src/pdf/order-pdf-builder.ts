import { jsPDF } from "jspdf";
import { autoTable, type Table, type UserOptions } from "jspdf-autotable";

interface Margin { top: number; right: number; bottom: number; left: number }
type Align = "left" | "center" | "right" | "justify";

// Preserve the legacy conversion and text flow rather than rounding to 72/25.4.
export class OrderPdfBuilder {
  readonly doc = new jsPDF("portrait", "pt", "a4");
  private x: number;
  private y: number;
  private maxWidth: number;
  private maxHeight: number;

  constructor(private margin: Margin = { left: 20, right: 12, top: 8, bottom: 3 }) {
    this.x = OrderPdfBuilder.mm2pt(margin.left);
    this.y = OrderPdfBuilder.mm2pt(margin.top);
    this.maxWidth = OrderPdfBuilder.mm2pt(210 - margin.right - margin.left);
    this.maxHeight = OrderPdfBuilder.mm2pt(297 - margin.bottom - margin.top);
    this.doc.setFontSize(10);
  }

  static mm2pt(mm: number) { return mm / 0.353; }
  getY() { return this.y * 0.353; }
  setBold() { this.doc.setFont("Helvetica", "normal", "700"); }
  setNormal() { this.doc.setFont("Helvetica", "normal", "normal"); }
  setColor(r: number, g: number, b: number) { this.doc.setTextColor(r, g, b); }
  resetText() { this.doc.setFontSize(10); this.setColor(0, 0, 0); this.setNormal(); }
  addSpace(mm = 8) { this.y += OrderPdfBuilder.mm2pt(mm); }

  addPage(margin?: Margin) {
    if (margin) {
      this.margin = margin;
      this.maxWidth = OrderPdfBuilder.mm2pt(210 - margin.right - margin.left);
      this.maxHeight = OrderPdfBuilder.mm2pt(297 - margin.bottom - margin.top);
    }
    this.doc.addPage("a4", "p");
    this.x = OrderPdfBuilder.mm2pt(this.margin.left);
    this.y = OrderPdfBuilder.mm2pt(this.margin.top);
  }

  addPngImage(data: string, x: number, y: number, width: number, height: number) {
    this.doc.addImage(
      data,
      "PNG",
      OrderPdfBuilder.mm2pt(x),
      OrderPdfBuilder.mm2pt(y),
      OrderPdfBuilder.mm2pt(width),
      OrderPdfBuilder.mm2pt(height),
      undefined,
      "SLOW",
    );
  }

  addLine(x?: number) {
    this.doc.setDrawColor(150, 150, 150);
    this.doc.line(x || this.x, this.y, OrderPdfBuilder.mm2pt(210 - this.margin.right), this.y);
    this.y += 5;
    this.resetText();
  }

  addBlackHeader(text: string) {
    this.setBold();
    this.addSpace(5);
    this.addText(text, 12);
    this.resetText();
  }

  addText(text: string, fontSize?: number, lineHeight?: number, align: Align = "left") {
    const lastX = this.x;
    if (align === "center") this.x = OrderPdfBuilder.mm2pt(105);
    if (align === "right") this.x = OrderPdfBuilder.mm2pt(210 - this.margin.right);
    if (fontSize) this.doc.setFontSize(fontSize);
    const dims = this.doc.getTextDimensions(text);
    let lh = lineHeight || this.doc.getLineHeight();
    let nextY = Math.ceil(dims.w / this.maxWidth) * lh + this.y + lh;
    if (nextY <= this.maxHeight) {
      this.doc.text(text, this.x, this.y + lh, { maxWidth: this.maxWidth, align });
    } else {
      this.doc.addPage("a4", "p");
      this.y = OrderPdfBuilder.mm2pt(this.margin.top);
      this.doc.text(text, this.x, this.y, { maxWidth: this.maxWidth, align });
      lh = this.doc.getLineHeight();
      nextY = Math.ceil(dims.w / this.maxWidth) * lh + this.y + lh / 2;
    }
    this.y = nextY;
    this.x = lastX;
  }

  addLeftRight(left: string[], right: string[], fontSize = 10) {
    const lastY = this.y;
    const lastX = this.x;
    const lh = fontSize / 2 + 2;
    left.forEach((line) => this.addText(line, fontSize, lh));
    this.y = lastY;
    this.x = OrderPdfBuilder.mm2pt(210 - this.margin.right);
    right.forEach((line) => this.addText(line, fontSize, lh, "right"));
    this.maxWidth += OrderPdfBuilder.mm2pt(10);
    this.x = lastX;
  }

  add2Cols(left: string[], right: string[], fontSize: number, lh: number, margin: number) {
    const lastY = this.y;
    const lastX = this.x;
    this.maxWidth -= OrderPdfBuilder.mm2pt(margin);
    this.x += OrderPdfBuilder.mm2pt(margin);
    left.forEach((line) => this.addText(line, fontSize, lh));
    const leftY = this.y;
    this.y = lastY;
    this.x = OrderPdfBuilder.mm2pt(105);
    right.forEach((line) => this.addText(line, fontSize, lh));
    this.x = lastX;
    this.y = Math.max(leftY, this.y);
  }

  addTable(params: Pick<UserOptions, "head" | "body" | "columnStyles" | "headStyles"> & { margin?: number }) {
    autoTable(this.doc, {
      head: params.head ?? [],
      body: params.body ?? [],
      theme: "grid",
      columnStyles: params.columnStyles ?? {},
      headStyles: { fillColor: "#6987a3", textColor: [255, 255, 255], ...params.headStyles },
      bodyStyles: { halign: "left", textColor: [0, 0, 0], lineColor: "#6987a3" },
      styles: { fontSize: 9, cellPadding: 2 },
      startY: this.y,
      margin: {
        top: OrderPdfBuilder.mm2pt(10), right: OrderPdfBuilder.mm2pt(12),
        bottom: OrderPdfBuilder.mm2pt(10), left: OrderPdfBuilder.mm2pt(params.margin ?? 20),
      },
    });
    const tableDoc = this.doc as jsPDF & { lastAutoTable: Table };
    this.y = tableDoc.lastAutoTable.finalY ?? this.y;
  }

  enumeratePages(orderNumber: number) {
    const pageCount = this.doc.getNumberOfPages();
    for (let page = 1; page <= pageCount; page++) {
      this.doc.setPage(page);
      this.doc.setFontSize(7);
      this.doc.setTextColor(85, 85, 85);
      this.doc.text(`${orderNumber} | Seite ${page}/${pageCount}`, OrderPdfBuilder.mm2pt(205), OrderPdfBuilder.mm2pt(292), { align: "right" });
    }
    this.resetText();
  }
}
