import {
  addInvoiceAmounts,
  type CatalogServiceRateDto,
  type CreateOrderInput,
  type OrderAddressInput,
} from "@vega/domain";
import { OrderPdfBuilder } from "./order-pdf-builder.js";
import { LEGACY_RZ24_LOGO } from "./legacy-logo.js";
import { orderAgb } from "./order-agb.js";

const PRIMARY = [40, 83, 123] as const;
const SECONDARY = [203, 43, 27] as const;
const PRICE = "Preis, inkl. MwSt";
type PdfService = {
  id: number;
  name: string;
  price: number;
  sort: number;
  kind: "service" | "packaging";
};

export interface OrderPdfInput {
  orderNumber: number;
  data: CreateOrderInput;
  services: PdfService[];
  rates: CatalogServiceRateDto[];
}

const euro = (value: number | undefined) =>
  value === undefined
    ? ""
    : new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: "EUR",
      }).format(value);
const number = (value: number | undefined) =>
  value === undefined ? "" : new Intl.NumberFormat("de-DE").format(value);

/** Conditions are individual gross amounts; the offer total is their sum (PDF and mail). */
export function orderGrossTotal(
  data: Pick<CreateOrderInput, "details">,
): number {
  return addInvoiceAmounts(
    (data.details?.conditions ?? []).map((entry) => entry.amount),
  );
}

export function orderPdfEditDate(
  order: { createdAt: Date; updatedAt: Date },
  latestActivity: { action: string; createdAt: Date } | null,
  lastEdit: { createdAt: Date } | null,
): Date {
  if (
    latestActivity?.action === "ARCHIVED" ||
    latestActivity?.action === "RESTORED"
  ) {
    return lastEdit?.createdAt ?? order.createdAt;
  }
  return order.updatedAt;
}

function date(value: string, weekday = false): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(weekday ? { weekday: "long" as const } : {}),
  }).format(new Date(`${value}T12:00:00Z`));
}

export function orderPdfFilename({
  orderNumber,
  data,
}: Pick<OrderPdfInput, "orderNumber" | "data">): string {
  const basis = data.details?.basis;
  let filename = `${date(data.movingDate)}_${data.customer.lastName || "Auftrag"}_${orderNumber}`;
  if (basis?.workers) filename += `_${basis.workers}`;
  if (basis?.trucks) filename += `+${basis.trucks}x3.5`;
  if (basis?.hours) filename += `_${basis.hours}_Std`;
  const hvz =
    Number(Boolean(data.from.parkingSlot)) +
    Number(Boolean(data.to.parkingSlot));
  if (hvz) filename += `_${hvz}xHVZ`;
  return `${filename.replace(/[/\\\u0000-\u001f\u007f]/gu, "_")}.pdf`;
}

export function generateOrderPdf(
  input: OrderPdfInput,
  lastEditedAt: Date,
): Buffer {
  const { data, orderNumber } = input;
  const pdf = new OrderPdfBuilder();
  pdf.addPngImage(LEGACY_RZ24_LOGO, 20, 8, 34, 36);
  pdf.setNormal();
  pdf.setColor(60, 60, 60);
  pdf.addLeftRight(
    [],
    [
      "Alexander Berent",
      "Am Münchfeld 31, 80999 München",
      "089 30642972 | 0176 10171990",
      "info@umzugruckzuck24.de",
      "Steuernummer: 144/139/21180",
      "",
      "",
    ],
    8,
  );
  pdf.addSpace(5);
  pdf.addLeftRight(
    [],
    [
      `München, ${lastEditedAt.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}`,
    ],
  );
  addTitle(pdf, data, orderNumber);
  addAddresses(pdf, data);
  addConditions(pdf, data);
  addPriceAndFirstPageEnd(pdf, data);
  addSecondPage(pdf, input);
  addInventory(pdf, data);
  addAgb(pdf, input.rates);
  pdf.enumeratePages(orderNumber);
  return Buffer.from(pdf.doc.output("arraybuffer"));
}

function addTitle(
  pdf: OrderPdfBuilder,
  data: CreateOrderInput,
  orderNumber: number,
) {
  pdf.setBold();
  pdf.addSpace(5);
  pdf.addText(
    `ANGEBOT / AUFTRAG / ABRECHNUNG - Nr. ${orderNumber}`,
    12,
    12,
    "center",
  );
  pdf.addSpace(3);
  const labelColumn = { 0: { fontStyle: "bold" as const, cellWidth: 75 } };
  if (data.customer.company)
    pdf.addTable({
      body: [["Firma", data.customer.company]],
      columnStyles: labelColumn,
    });
  pdf.addTable({
    body: [
      [
        "Name",
        `${data.customer.salutation || ""} ${data.customer.firstName} ${data.customer.lastName}`,
        `Tel: ${data.customer.phone}`,
      ],
    ],
    columnStyles: labelColumn,
  });
  pdf.addTable({
    body: [
      [
        "Umzugstermin",
        data.movingDate
          ? `${date(data.movingDate, true)} um ${data.movingTime || ""}`
          : "",
        data.orderSource === "check24" ? "CHECK 24" : "",
      ],
    ],
    columnStyles: { ...labelColumn, 2: { fontStyle: "bold" } },
  });
  const volume = data.details?.furniture.volume;
  if (volume && volume > 0)
    pdf.addTable({
      body: [
        ["Volumen", `${number(volume)} m³`, "max Abweichung des Volumens: 10%"],
      ],
      columnStyles: {
        ...labelColumn,
        1: { cellWidth: 100 },
        2: { fontStyle: "bold", textColor: [...SECONDARY] },
      },
    });
  if (data.note)
    pdf.addTable({ body: [["weitere Informationen auf Seite 3"]] });
}

function addressColumn(
  address: OrderAddressInput,
  type: "from" | "to",
): string[] {
  const floors =
    address.movementObject?.toLowerCase() === "haus"
      ? [...(address.stockwerke ?? [])]
      : [address.floor || ""];
  if (address.hasGarage) floors.push("Garage");
  if (address.hasBasement) floors.push("Keller");
  if (address.hasLoft) floors.push("Dachboden");
  const services = [
    address.demontage ? "Möbelabbau" : "",
    address.montage ? "Möbelaufbau" : "",
    address.packservice
      ? type === "from"
        ? "Einpackservice"
        : "Auspackservice"
      : "",
  ];
  return [
    address.street || " ",
    [address.postalCode, address.city].filter(Boolean).join(" ") || " ",
    address.movementObject || "",
    floors.filter(Boolean).join(" + "),
    address.liftType ?? "kein Aufzug",
    address.runningDistance || "",
    address.parkingSlot ? "Ja" : "wird von Kund*innen sichergestellt",
    services.filter(Boolean).join(" + "),
  ];
}

function addAddresses(pdf: OrderPdfBuilder, data: CreateOrderInput) {
  const details = data.details;
  const secondFrom = details?.showSecondaryFrom && details.secondaryFrom;
  const secondTo = details?.showSecondaryTo && details.secondaryTo;
  const headings = [
    " ",
    ...(secondFrom ? ["1. Beladestelle", "2. Beladestelle"] : ["Beladestelle"]),
    ...(secondTo
      ? ["1. Entladestelle", "2. Entladestelle"]
      : ["Entladestelle"]),
  ];
  const columns = [
    [
      "Straße, Nr.",
      "PLZ, Ort",
      "Auszug/Einzug",
      "Etage",
      "Lift",
      "Trageweg",
      "Halteverbot",
      "Leistungen",
    ],
    addressColumn(data.from, "from"),
    ...(secondFrom ? [addressColumn(secondFrom, "from")] : []),
    addressColumn(data.to, "to"),
    ...(secondTo ? [addressColumn(secondTo, "to")] : []),
  ];
  pdf.addSpace();
  pdf.addTable({
    head: [headings],
    body: columns[0]!.map((_, row) => columns.map((column) => column[row]!)),
  });
}

function addConditions(pdf: OrderPdfBuilder, data: CreateOrderInput) {
  pdf.addSpace(5);
  // Each order position carries its gross amount; this does not recalculate the quote.
  pdf.addTable({
    head: [{ a: "Leistungen", b: "Einzelpreis", c: "Menge", d: PRICE }],
    body: (data.details?.conditions ?? []).map((entry) => ({
      a: entry.description,
      b: euro(entry.amount),
      c: "1",
      d: euro(entry.amount),
    })),
    columnStyles: {
      1: { cellWidth: 75, halign: "right" },
      2: { cellWidth: 75, halign: "right" },
      3: { cellWidth: 75, halign: "right" },
    },
  });
}

function signature(pdf: OrderPdfBuilder, label: string) {
  pdf.addText("___________________", 8, 6, "right");
  pdf.addText(label, 8, 4, "right");
  pdf.resetText();
}

function addPriceAndFirstPageEnd(pdf: OrderPdfBuilder, data: CreateOrderInput) {
  if (pdf.getY() < 195) pdf.addSpace(195 - pdf.getY());
  pdf.setColor(...SECONDARY);
  pdf.setBold();
  pdf.addText(
    "Die Preise sind inklusive gesetzlicher Haftung in Höhe von 620,0 Euro / m³.",
    8,
  );
  pdf.resetText();
  pdf.setBold();
  const gross = orderGrossTotal(data);
  const net = gross / 1.19;
  pdf.addText(`Netto: ${euro(net)}`, 9, 6, "right");
  pdf.addText(`MwSt. 19%: ${euro(gross - net)}`, 9, 6, "right");
  pdf.addLine(OrderPdfBuilder.mm2pt(100));
  pdf.setBold();
  const basis = data.details?.basis;
  if (basis?.hours && basis.hours > 0) {
    pdf.addText(
      `Gesamtpreis für ${basis.hours} Stunden: ${euro(gross)}`,
      14,
      10,
      "right",
    );
    pdf.setNormal();
    pdf.addText(
      `Je angefangene weitere Stunde: ${euro(basis.extraHourPrice)} inkl. MwSt.`,
      9,
      6,
      "right",
    );
    pdf.addText(
      "Bei einer Zeitüberschreitung von bis zu 20 min ist 1/2 Stunde zu bezahlen, ab 20 min wird eine volle Stunde berechnet.",
      9,
      6,
      "left",
    );
  } else {
    pdf.addText(`Gesamt: ${euro(gross)}`, 14, 10, "right");
  }
  pdf.resetText();
  pdf.addText(
    "Zahlungsart: An unsere Mitarbeiter vor Ort nach dem Umzug in Bar oder per Überweisung\n(Zahlungseingang auf unser Konto spätestens 1 Tag vor dem Umzug).",
    9,
  );
  signature(pdf, "Kundenunterschrift");
  pdf.addLine();
  pdf.setBold();
  pdf.addText(
    "Empfänger: Alexander Berent  |  Stadtsparkasse München  |  IBAN: DE41 7015 0000 1005 7863 20",
    9,
  );
  pdf.addLine();
  pdf.addText(
    "Hiermit beauftrage ich den Umzug zu den vereinbarten Konditionen und akzeptiere die AGB von Umzug Ruck sowie die Haftungsbedingungen gemäß § 451 HGB.",
    9,
  );
  signature(pdf, "Kundenunterschrift");
  pdf.setColor(...PRIMARY);
  pdf.addText(
    "Bitte beachten Sie: Auflistung weiterer Leistungen befindet sich auf der nächsten Seite.",
    9,
  );
  pdf.addPage();
}

const secondPageText = [
  "Die Anzahl der benötigten Ladehelfer sowie die voraussichtliche Arbeitsdauer werden auf Basis der Angaben im Online-Formular „Umzugsanfrage/Umzugsgutliste“ berechnet. Insbesondere werden Trageweg, Zimmeranzahl, Stockwerk und Umzugsvolumen berücksichtigt",
  "Liegt kein Formular vor, erfolgt die Berechnung gemäß der aktuellen Preisliste und den Allgemeinen Geschäftsbedingungen (AGB), insbesondere den Regelungen zu „Erweiterungen des Leistungsumfangs“",
  "Aufgrund der körperlichen Belastung sind pro Arbeitsstunde 5 Minuten Pause vorgesehen. Diese Pausen sind bereits im Angebot enthalten",
  "Sollten keine ausreichenden schriftlichen Informationen zum Umzug vorliegen, behält sich Umzug Ruck das Recht vor, den Auftrag bzw. die Möbelliste um relevante Positionen wie Volumen (m³), Schwertransport etc. zu ergänzen und den Preis entsprechnend der Preisliste anzupassen",
];

function addSecondPage(pdf: OrderPdfBuilder, input: OrderPdfInput) {
  pdf.resetText();
  for (const block of secondPageText)
    pdf.addTable({
      body: [[` • ${block}`]],
      columnStyles: { 0: { lineColor: [255, 255, 255] } },
    });
  for (const [kind, title] of [
    ["service", "Leistungen"],
    ["packaging", "Verpackung (wird nach Verbrauch berechnet)"],
  ] as const) {
    pdf.addBlackHeader(title);
    const selected = input.data.details?.extras.services ?? [];
    const catalog = input.services
      .filter((service) => service.kind === kind)
      .toSorted((a, b) => a.sort - b.sort || a.id - b.id);
    const rows = catalog.map((service) => {
      const selection = selected.find(
        (item) => item.kind === kind && item.catalogId === service.id,
      );
      const quantity = selection?.quantity;
      return [
        service.name,
        euro(service.price),
        number(quantity),
        quantity === undefined ? "" : euro(service.price * quantity),
      ];
    });
    // Free-text selections and removed catalog items remain visible without invented prices.
    for (const service of selected.filter(
      (item) =>
        item.kind === kind &&
        !catalog.some((entry) => entry.id === item.catalogId),
    )) {
      rows.push([service.name, "", number(service.quantity), ""]);
    }
    pdf.addTable({
      head: [["Artikel", "E-Preis", "Menge", PRICE]],
      body: rows,
      columnStyles: {
        1: { cellWidth: 45, halign: "right" },
        2: { cellWidth: 40, halign: "right" },
        3: { cellWidth: 75, halign: "right" },
      },
    });
  }
  pdf.resetText();
  pdf.setBold();
  pdf.addText(
    "Nach der Besichtigung wurden Mängel festgestellt: [ ] keine   [ ] Wände   [ ] Möbel   [ ] Fußböden",
  );
  pdf.addText("Auszugsadresse");
  pdf.resetText();
  pdf.setColor(...PRIMARY);
  pdf.addText(
    "    Umzugsgut vollständig beladen:                                       (Kundenunterschrift) ___________________________",
  );
  pdf.resetText();
  pdf.setBold();
  pdf.addText("Einzugsadresse");
  pdf.resetText();
  pdf.setColor(...PRIMARY);
  pdf.addText(
    "    Auftrag vollständig und zufriedenstellend ausgeführt:      (Kundenunterschrift) ___________________________",
  );
  pdf.resetText();
  pdf.setBold();
  pdf.addText(
    "Gesamtbetrag dankend erhalten:                          (Unterschrift des Fahrers) ___________________________",
  );
  pdf.resetText();
}

function addInventory(pdf: OrderPdfBuilder, data: CreateOrderInput) {
  pdf.addPage();
  if (data.note) {
    pdf.addBlackHeader("Weitere Informationen");
    pdf.addTable({
      body: [[data.note]],
      columnStyles: { 0: { lineColor: [255, 255, 255] } },
    });
  }
  if (data.from.demontage) {
    pdf.addBlackHeader("Abbau und Aufbau Liste");
    pdf.addTable({
      body: [
        ["Küche", number(data.from.kitchenWidth), "Meter"],
        ["Betten", number(data.from.bedNumber), "Stück"],
        ["Schränke", number(data.from.wardrobeWidth), "Meter"],
      ],
      columnStyles: { 1: { halign: "right" } },
    });
  }
  const furniture = data.details?.furniture;
  if (!furniture) return;
  for (const [enabled, text, title] of [
    [furniture.expensive, furniture.expensiveText, "Antike & Wertvolle"],
    [furniture.heavy, furniture.heavyText, "Besonders Schwere"],
    [furniture.bulky, furniture.bulkyText, "Sperrige"],
  ] as const) {
    if (!enabled) continue;
    pdf.addBlackHeader(title);
    if (text)
      pdf.addTable({
        head: [
          [
            "Name",
            "Anzahl",
            "Breite (cm)",
            "Tiefe (cm)",
            "Höhe (cm)",
            "Gewicht (kg)",
            "Volumen (m³)",
          ],
        ],
        body: [[text, "", "", "", "", "", ""]],
      });
  }
  if (furniture.ownItems.trim()) {
    pdf.addBlackHeader("Möbelliste");
    pdf.addTable({ body: [[furniture.ownItems]] });
  } else if (furniture.items.length) {
    pdf.addBlackHeader("Möbelliste");
    const body: NonNullable<
      Parameters<OrderPdfBuilder["addTable"]>[0]["body"]
    > = [];
    let category = "";
    for (const item of furniture.items) {
      if (item.quantity === 0) continue;
      if (item.category && item.category !== category) {
        category = item.category;
        body.push({
          desc: {
            colSpan: 2,
            content: category,
            styles: {
              fontStyle: "bold",
              halign: "left",
              textColor: [...SECONDARY],
            },
          },
        });
      }
      body.push([item.name, number(item.quantity)]);
    }
    pdf.addTable({ body });
  }
  const boxes = [
    furniture.boxes ? `Umzugskartons: ca ${furniture.boxes}` : "",
    furniture.wardrobeBoxes
      ? `Kleiderboxen: ca ${furniture.wardrobeBoxes}`
      : "",
  ].filter(Boolean);
  if (boxes.length) {
    pdf.addSpace(5);
    pdf.setBold();
  }
  pdf.addText(boxes.join(" | "), 9);
  pdf.setNormal();
}

function addAgb(pdf: OrderPdfBuilder, rates: CatalogServiceRateDto[]) {
  const rate = (key: CatalogServiceRateDto["key"]) =>
    euro(rates.find((entry) => entry.key === key)?.price);
  pdf.addPage({ top: 3, left: 8, right: 8, bottom: 3 });
  pdf.setBold();
  pdf.addText("Allgemeine Geschäftsbedingungen der Durchführung des Umzugs", 7);
  pdf.resetText();
  for (const [index, paragraph] of orderAgb.entries()) {
    pdf.addTable({
      head: [[`§${index + 1} ${paragraph.title}`]],
      body: [[paragraph.text]],
      columnStyles: { 0: { fontSize: 7, lineColor: [255, 255, 255] } },
      headStyles: {
        fontSize: 7,
        fillColor: [255, 255, 255],
        textColor: [0, 0, 0],
      },
      margin: 8,
    });
    if (paragraph.prices)
      pdf.add2Cols(
        [
          `Bett Abbau oder Aufbau: ${rate("aBettDeMon")}`,
          `Küche Abbau je 1 m.: ${rate("akitmon")}`,
          `Schrank Abbau oder Aufbau je 1 m.: ${rate("awardmon")}`,
          `Je zusätzliches m³ Ladevolumen: ${rate("acbm")}`,
        ],
        [
          `Je 10 Meter zusätzlichem Laufweg am Auzugsort oder Einzugsort: ${rate("ameter")}`,
          `1 Karton zusätzlich Einpacken oder Auspacken: ${rate("aBoxPack")}`,
          `Jede zusätzliche Etage am Auzugsort oder Einzugsort: ${rate("aetage")}`,
          `Entsorgung: ${rate("disposalCbmPrice")}/m³ zzgl. einmaliger Pauschale in Höhe von ${rate("disposalBasicPrice")}`,
        ],
        7,
        4,
        1,
      );
  }
}
