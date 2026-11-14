import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import type {
  HostingerMessage,
  InboxReader,
} from "../src/inbox/inbox-client.js";
import {
  ANALYSIS_SYSTEM_INSTRUCTION,
  AnalysisError,
  analyzeMessage,
  mapGeminiOutput,
  type CatalogEntry,
} from "../src/inbox/analysis.js";
import {
  classifyAttachment,
  ATTACHMENT_LIMITS,
  AttachmentError,
  extractCsvText,
  extractXlsxText,
  imageMimeType,
} from "../src/inbox/attachment-reader.js";
import {
  VertexGeminiClient,
  type GeminiClient,
  type GeminiRequest,
} from "../src/inbox/gemini-client.js";
import {
  mailHtml,
  mailPlainText,
  quoteForReply,
  redactContactData,
  splitSenderName,
} from "../src/inbox/mail-content.js";
import { replySubject } from "../src/inbox/reply-context.js";

const catalog: CatalogEntry[] = [
  { id: 1, name: "Couch", volume: 1.5, category: "Wohnzimmer" },
  { id: 2, name: "Bett", volume: 2 },
];

const context = {
  sender: { name: "Max Mustermann", address: "Max@Example.com" },
  phones: ["0171 1234567"],
  catalog,
};

test("mail HTML is rendered safely and HTML-in-text is converted for analysis", () => {
  const rawHtml = '<!doctype html><table width="100%"><tr><td style="color:#123456">Hello <b>there</b><script>alert(1)</script><img src="https://tracker.example/pixel"><a href="javascript:alert(1)" onclick="alert(1)">unsafe</a><a href="https://example.com">safe</a></td></tr></table>';
  const rendered = mailHtml(rawHtml, "");
  assert.match(rendered, /<table width="100%">/u);
  assert.match(rendered, /style="color:#123456"/u);
  assert.match(rendered, /target="_blank" rel="noopener noreferrer"/u);
  assert.doesNotMatch(rendered, /<script|<img|onclick|javascript:/iu);
  assert.match(mailPlainText(rawHtml, ""), /Hello there/u);
  assert.doesNotMatch(mailPlainText(rawHtml, ""), /<table|<script/iu);
});

test("redactContactData removes e-mails and phones but keeps dates", () => {
  const result = redactContactData(
    "Mail max@example.com, Tel +49 171 1234567, Umzug am 12.05.2026",
  );
  assert.ok(!result.text.includes("example.com"));
  assert.ok(!result.text.includes("1234567"));
  assert.ok(result.text.includes("12.05.2026"));
  assert.equal(result.phones.length, 1);
});

test("splitSenderName handles formats", () => {
  assert.deepEqual(splitSenderName("Max Mustermann"), {
    firstName: "Max",
    lastName: "Mustermann",
  });
  assert.deepEqual(splitSenderName("Mustermann, Max"), {
    firstName: "Max",
    lastName: "Mustermann",
  });
  assert.deepEqual(splitSenderName("max@example.com"), {
    firstName: "",
    lastName: "",
  });
});

test("quoteForReply escapes html", () => {
  const html = quoteForReply({
    from: "A <a@b.de>",
    date: "1.1.",
    text: "<script>x</script>\nzwei",
  });
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("<br>"));
});

test("replySubject prefixes once", () => {
  assert.equal(replySubject("AW: Re: Umzug"), "Re: Umzug");
  assert.equal(replySubject(null), "Re: Ihre Anfrage");
});

test("classifyAttachment separates supported, legacy and unknown files", () => {
  assert.equal(
    classifyAttachment("a.docx", "application/octet-stream"),
    "docx",
  );
  assert.equal(
    classifyAttachment("a.doc", "application/msword"),
    "legacy-office",
  );
  assert.equal(
    classifyAttachment("a.xls", "application/vnd.ms-excel"),
    "legacy-office",
  );
  assert.equal(
    classifyAttachment("a.exe", "application/x-msdownload"),
    "unsupported",
  );
  assert.equal(imageMimeType(Buffer.from("not an image")), null);
});

function xlsxFixture(sheets: string[], sharedStrings = ""): Buffer {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>',
    ),
    "xl/workbook.xml": strToU8(
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((_sheet, index) => `<sheet name="Liste ${index + 1}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="strings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    ),
    "xl/styles.xml": strToU8(
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
    ),
    "xl/sharedStrings.xml": strToU8(
      `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${sharedStrings}</sst>`,
    ),
  };
  sheets.forEach((rows, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`,
    );
  });
  return Buffer.from(zipSync(files));
}

test("extractCsvText and extractXlsxText return text with sheet names and tab-separated cells", async () => {
  assert.ok(extractCsvText(Buffer.from("Sofa;2\nBett;1")).includes("Sofa"));
  const buffer = xlsxFixture([
    '<row r="1"><c r="A1" t="inlineStr"><is><t> Sofa </t></is></c><c r="B1"><v>2</v></c></row>',
  ]);
  assert.equal(await extractXlsxText(buffer), "## Liste 1\nSofa\t2");
});

test("XLSX extraction keeps rich strings, cached formulas, dates, booleans and interior gaps", async () => {
  const buffer = xlsxFixture([
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><f>1+2</f><v>3</v></c><c r="D1" t="b"><v>0</v></c><c r="E1" s="1"><v>46023</v></c></row><row r="2"/><row r="3"><c r="A3" t="str"><f>"Bett"</f><v>Bett</v></c><c r="B3" t="b"><v>1</v></c></row>',
  ], "<si><r><t>Grosser </t></r><r><t>Schrank</t></r></si>");
  assert.equal(
    await extractXlsxText(buffer),
    `## Liste 1\nGrosser Schrank\t\t3\tfalse\t${new Date("2026-01-01T00:00:00Z")}\nBett\ttrue`,
  );
});

test("XLSX extraction enforces sheet, nonempty-row, column and text limits", async () => {
  const rows = Array.from({ length: ATTACHMENT_LIMITS.maxRows + 1 }, (_value, index) =>
    `<row r="${index * 2 + 1}"><c r="A${index * 2 + 1}" t="inlineStr"><is><t>Row ${index + 1}</t></is></c><c r="AD${index * 2 + 1}"><v>30</v></c><c r="AE${index * 2 + 1}" t="inlineStr"><is><t>Beyond column limit</t></is></c></row>`,
  ).join("");
  const sheets = await extractXlsxText(xlsxFixture(
    Array(ATTACHMENT_LIMITS.maxSheets + 1).fill('<row r="1"><c r="A1"><v>1</v></c></row>'),
  ));
  assert.equal(sheets.split("\n").filter((line) => line.startsWith("## ")).length, ATTACHMENT_LIMITS.maxSheets);
  assert.doesNotMatch(sheets, /Liste 6/u);
  const text = await extractXlsxText(xlsxFixture([rows]));
  assert.equal(text.split("\n").filter((line) => line.startsWith("Row ")).length, ATTACHMENT_LIMITS.maxRows);
  assert.ok(text.includes("Row 500"));
  assert.doesNotMatch(text, /Row 501|Beyond column limit|Liste 6/u);
  assert.equal(text.split("\n")[1]?.split("\t").length, ATTACHMENT_LIMITS.maxColumns);
  const long = xlsxFixture([
    `<row r="1"><c r="A1" t="inlineStr"><is><t>${"x".repeat(ATTACHMENT_LIMITS.maxExtractedChars + 1)}</t></is></c></row>`,
  ]);
  assert.equal((await extractXlsxText(long)).length, ATTACHMENT_LIMITS.maxExtractedChars);
});

test("XLSX extraction rejects invalid archives and oversized declared ZIP contents before parsing", async () => {
  await assert.rejects(extractXlsxText(Buffer.from("not a ZIP")), AttachmentError);
  const buffer = xlsxFixture(['<row r="1"><c r="A1"><v>1</v></c></row>']);
  const directory = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(directory >= 0);
  buffer.writeUInt32LE(ATTACHMENT_LIMITS.maxUncompressedBytes + 1, directory + 24);
  await assert.rejects(extractXlsxText(buffer), /entpackt zu groß/u);
});

test("XLSX extraction propagates malformed spreadsheet errors instead of returning empty success", async () => {
  const buffer = xlsxFixture([
    '<row r="1"><c r="A1" t="s"><v>99</v></c></row>',
  ]);
  await assert.rejects(extractXlsxText(buffer));
});

test("mapGeminiOutput maps the lift type enum and falls back to hasLift", () => {
  const result = mapGeminiOutput(
    {
      from: { liftType: "Lastenaufzug", movementObject: "Haus" },
      to: { hasLift: false },
    },
    context,
  );
  assert.equal(result.draft.from.liftType, "Lastenaufzug");
  assert.equal(result.draft.from.movementObject, "Haus");
  assert.equal(result.draft.to.liftType, "kein Aufzug");
  const fallback = mapGeminiOutput(
    { from: { hasLift: true, floor: "OG" }, to: { floor: "2. OG" } },
    context,
  );
  assert.equal(fallback.draft.from.liftType, "4 Personen");
  assert.equal(fallback.draft.from.floor, "1. Etage");
  assert.equal(fallback.draft.to.floor, "2. Etage");
});

test("normalizes explicit ground and basement floors for both addresses", () => {
  const result = mapGeminiOutput(
    { from: { floor: "Erdgeschoss" }, to: { floor: "1. Obergeschoss" } },
    context,
  );
  assert.equal(result.draft.from.floor, "EG");
  assert.equal(result.draft.to.floor, "1. Etage");
  assert.ok(result.filledFields.includes("from.floor"));
  const basement = mapGeminiOutput({ from: { floor: "Untergeschoss" } }, context);
  assert.equal(basement.draft.from.floor, "UG");
});

test("forwarded-message prompt specifies source precedence and address-specific floors", () => {
  assert.match(ANALYSIS_SYSTEM_INSTRUCTION, /Weitergeleitete Nachricht/u);
  assert.match(ANALYSIS_SYSTEM_INSTRUCTION, /neuere Korrekturen haben Vorrang/u);
  assert.match(ANALYSIS_SYSTEM_INSTRUCTION, /Auszug: Erdgeschoss/u);
  assert.match(ANALYSIS_SYSTEM_INSTRUCTION, /floor: 'EG'/u);
});

test("mapGeminiOutput maps additional order fields and validates service catalog references", () => {
  const result = mapGeminiOutput(
    {
      from: {
        movementObject: "Haus",
        floor: "1. OG",
        hasLoft: true,
        hasBasement: false,
        hasGarage: true,
        roomsToRelocate: 3,
        bedNumber: 2,
        wardrobeWidth: 3.5,
        kitchenWidth: 4,
        stockwerke: ["EG", "1.OG", "invalid"],
      },
      secondaryFrom: { city: "Berlin", postalCode: "10115" },
      secondaryTo: { street: "Weg 3" },
      movingDate: "2026-11-16",
      dateFixed: true,
      visitWanted: true,
      costsAssumption: true,
      boxes: 25,
      wardrobeBoxes: 2,
      heavyText: "Tresor",
      expensiveText: "Antike Kommode",
      bulkyText: "Klavier",
      packingRequested: true,
      services: [
        { kind: "service", catalogId: 7, quantity: 2, unitPrice: 1 },
        { kind: "packaging", catalogId: 7, quantity: 3 },
        { kind: "service", catalogId: 99, quantity: 1 },
        { kind: "service", catalogId: 7, quantity: -1 },
      ],
    },
    {
      ...context,
      serviceCatalog: [
        { kind: "service", id: 7, name: "Einpacken" },
        { kind: "packaging", id: 7, name: "Karton" },
      ],
    },
  );
  assert.deepEqual(result.draft.from.stockwerke, ["EG", "1.OG"]);
  assert.equal(result.draft.from.roomsToRelocate, 3);
  assert.equal(result.draft.from.hasBasement, false);
  assert.equal(result.draft.from.wardrobeWidth, 3.5);
  assert.equal(result.draft.secondaryFrom?.postalCode, "10115");
  assert.equal(result.draft.secondaryTo?.street, "Weg 3");
  assert.equal(result.draft.dateFixed, true);
  assert.equal(result.draft.visitWanted, true);
  assert.equal(result.draft.costsAssumption, true);
  assert.equal(result.draft.furniture.boxes, 25);
  assert.equal(result.draft.furniture.wardrobeBoxes, 2);
  assert.equal(result.draft.furniture.volumeComplete, false);
  assert.equal(result.draft.furniture.heavyText, "Tresor");
  assert.equal(result.draft.furniture.expensive, true);
  assert.equal(result.draft.furniture.bulky, true);
  assert.deepEqual(result.draft.extras?.services, [
    { kind: "service", catalogId: 7, name: "Einpacken", quantity: 2 },
    { kind: "packaging", catalogId: 7, name: "Karton", quantity: 3 },
  ]);
  assert.equal(result.draft.extras?.packingRequested, true);
});

test("box volume is calculated from server settings, not the model", () => {
  const result = mapGeminiOutput(
    { boxes: 10, wardrobeBoxes: 2, volume: 999 },
    { ...context, boxVolumes: { box: 0.1, wardrobeBox: 0.5 } },
  );
  assert.equal(result.draft.furniture.volume, 2);
  assert.equal(result.draft.furniture.volumeComplete, true);
});

test("house floor fallback and missing or invalid additional values", () => {
  const result = mapGeminiOutput(
    {
      from: { movementObject: "Haus", floor: "OG", roomsToRelocate: 2.5 },
      secondaryFrom: {},
      boxes: -1,
      wardrobeBoxes: 2.5,
      dateFixed: true,
      services: [{ kind: "service", catalogId: 7, quantity: 1 }],
    },
    context,
  );
  assert.deepEqual(result.draft.from.stockwerke, ["1.OG"]);
  assert.equal(result.draft.from.roomsToRelocate, undefined);
  assert.equal(result.draft.secondaryFrom, undefined);
  assert.equal(result.draft.dateFixed, undefined);
  assert.equal(result.draft.furniture.boxes, undefined);
  assert.equal(result.draft.furniture.wardrobeBoxes, undefined);
  assert.equal(result.draft.extras, undefined);
});

test("mapGeminiOutput maps a flexible date range and uses its start as moving date", () => {
  const result = mapGeminiOutput(
    { flexibleDateFrom: "2026-11-16", flexibleDateTo: "2026-11-20" },
    context,
  );
  assert.equal(result.draft.dateFrom, "2026-11-16");
  assert.equal(result.draft.dateTo, "2026-11-20");
  assert.equal(result.draft.dateFixed, false);
  assert.equal(result.draft.movingDate, "2026-11-16");
  const invalid = mapGeminiOutput(
    { flexibleDateFrom: "2026-11-20", flexibleDateTo: "2026-11-16" },
    context,
  );
  assert.equal(invalid.draft.dateFrom, undefined);
});

test("mapGeminiOutput extracts the postal code from prefixed or combined values", () => {
  const result = mapGeminiOutput(
    {
      from: { postalCode: "D-50667 Köln", city: "50667 Köln" },
      to: { postalCode: "10115", city: "Berlin" },
    },
    context,
  );
  assert.equal(result.draft.from.postalCode, "50667");
  assert.equal(result.draft.from.city, "Köln");
  assert.equal(result.draft.to.postalCode, "10115");
});

test("mapGeminiOutput maps catalog furniture, validates fields and flags unknown furniture", () => {
  const result = mapGeminiOutput(
    {
      movingDate: "2026-02-30",
      movingTime: "09:30",
      from: {
        street: "Weg 1",
        postalCode: "12345",
        city: "Berlin",
        floor: "3. Etage",
        hasLift: false,
        movementObject: "Wohnung",
      },
      to: { postalCode: "abc", floor: "Dachboden", runningDistance: "x" },
      furniture: [
        { catalogId: 1, quantity: 2, confidence: "high" },
        { catalogId: 1, quantity: 1, confidence: "low" },
        { catalogId: 999, quantity: 1, confidence: "high" },
      ],
      unmatchedFurniture: [
        { name: "Klavier", quantity: 1, estimatedVolumeM3: 1.24 },
      ],
      note: "Halteverbot nötig",
    },
    context,
  );
  assert.equal(result.draft.movingDate, undefined);
  assert.equal(result.draft.movingTime, "09:30");
  assert.equal(result.draft.from.floor, "3. Etage");
  assert.equal(result.draft.to.postalCode, undefined);
  assert.equal(result.draft.to.floor, undefined);
  assert.equal(result.draft.customer.email, "max@example.com");
  assert.equal(result.draft.customer.lastName, "Mustermann");
  assert.equal(result.draft.furniture.items.length, 1);
  assert.equal(result.draft.furniture.items[0]?.quantity, 3);
  assert.equal(result.draft.furniture.volume, 4.5);
  assert.equal(result.draft.furniture.volumeComplete, false);
  assert.ok(result.draft.note.includes("Klavier"));
  assert.ok(result.draft.note.includes("ca. 1,2 m³"));
});

test("mapGeminiOutput rejects non-object output", () => {
  assert.throws(() => mapGeminiOutput("x", context), AnalysisError);
});

function fakeInbox(
  message: Partial<HostingerMessage> = {},
  files: Record<string, Buffer> = {},
): InboxReader {
  const full: HostingerMessage = {
    uid: 5,
    date: "2026-01-01T10:00:00Z",
    unseen: true,
    subject: "Umzug",
    from: { name: "Max Mustermann", address: "max@example.com" },
    to: [],
    messageId: "<id@example.com>",
    attachments: [],
    ...message,
  };
  return {
    listMessages: async () => ({
      messages: [full],
      pagination: { page: 1, perPage: 25, total: 1, totalPages: 1 },
    }),
    getMessage: async () => full,
    getText: async () => ({
      text: "Ich habe ein Sofa. max@example.com 0171 1234567",
      html: "",
    }),
    findUidByMessageId: async () => 5,
    downloadAttachment: async (_uid, id) => files[id] ?? Buffer.alloc(0),
  };
}

test("analyzeMessage redacts contact data before Gemini and reports skipped attachments", async () => {
  let seen: GeminiRequest | undefined;
  const gemini: GeminiClient = {
    generateJson: async (request) => {
      seen = request;
      return {
        from: {},
        to: {},
        furniture: [{ catalogId: 1, quantity: 1, confidence: "high" }],
        unmatchedFurniture: [],
      };
    },
  };
  const inbox = fakeInbox(
    {
      attachments: [
        {
          id: "a",
          contentType: "application/msword",
          sizeBytes: 100,
          inline: false,
          filename: "alt.doc",
          contentId: null,
        },
        {
          id: "b",
          contentType: "text/csv",
          sizeBytes: 20,
          inline: false,
          filename: "liste.csv",
          contentId: null,
        },
      ],
    },
    { b: Buffer.from("Sofa;1;kontakt@example.org") },
  );
  const result = await analyzeMessage(
    {
      inbox,
      gemini,
      loadCatalog: async () => catalog,
      loadServiceCatalog: async () => [
        { id: 7, name: "Einpacken", kind: "service" },
      ],
    },
    5,
  );
  const payload = JSON.stringify(seen?.parts);
  assert.ok(!payload.includes("max@example.com"));
  assert.ok(!payload.includes("kontakt@example.org"));
  assert.ok(!payload.includes("1234567"));
  assert.ok(!payload.includes("Mustermann"));
  assert.ok(payload.includes("service, 7: Einpacken"));
  assert.equal(result.skippedAttachments.length, 1);
  assert.equal(result.skippedAttachments[0]?.filename, "alt.doc");
  assert.equal(result.draft.customer.phone, "0171 1234567");
  assert.equal(result.draft.furniture.items[0]?.name, "Couch");
});

test("forwarded partial addresses and floors survive redaction and reach the order draft", async () => {
  const inbox = fakeInbox({ subject: "Fwd: Umzugsanfrage" });
  inbox.getText = async () => ({
    text: [
      "-------- Weitergeleitete Nachricht --------",
      "Von: kunde@example.org",
      "Von Neustadt (Beispielstraße) nach Musterstadt.",
      "Auszug: Erdgeschoss in Neustadt",
      "Einzug: 1. Obergeschoss in Musterstadt, Aufzug vorhanden",
    ].join("\n"),
    html: "",
  });
  const gemini: GeminiClient = {
    generateJson: async (request) => {
      const input = JSON.stringify(request.parts);
      assert.match(input, /Erdgeschoss in Neustadt/u);
      assert.match(input, /1\. Obergeschoss in Musterstadt/u);
      assert.ok(!input.includes("kunde@example.org"));
      assert.match(request.systemInstruction, /Adressbestandteil einzeln/u);
      const properties = request.responseSchema.properties;
      assert.ok(properties && typeof properties === "object");
      const schema = Reflect.get(properties, "from");
      assert.ok(schema && typeof schema === "object");
      assert.deepEqual(Reflect.get(schema, "required"), [
        "street", "postalCode", "city", "floor", "movementObject", "liftType",
      ]);
      return {
        from: { street: "Beispielstraße", city: "Neustadt", floor: "EG", postalCode: null },
        to: { city: "Musterstadt", floor: "1. Etage", liftType: "4 Personen", street: null },
        furniture: [],
        unmatchedFurniture: [],
      };
    },
  };
  const { draft, filledFields } = await analyzeMessage(
    { inbox, gemini, loadCatalog: async () => catalog },
    5,
  );
  assert.equal(draft.from.street, "Beispielstraße");
  assert.equal(draft.from.city, "Neustadt");
  assert.equal(draft.from.floor, "EG");
  assert.equal(draft.from.postalCode, undefined);
  assert.equal(draft.to.city, "Musterstadt");
  assert.equal(draft.to.floor, "1. Etage");
  assert.equal(draft.to.liftType, "4 Personen");
  assert.equal(draft.to.street, undefined);
  assert.ok(filledFields.includes("from.floor"));
});

test("analyzeMessage fails with an empty catalog", async () => {
  const gemini: GeminiClient = { generateJson: async () => ({}) };
  await assert.rejects(
    analyzeMessage(
      { inbox: fakeInbox(), gemini, loadCatalog: async () => [] },
      5,
    ),
    (error: unknown) =>
      error instanceof AnalysisError && error.code === "CATALOG_EMPTY",
  );
});

test("VertexGeminiClient retries once on 503 and parses JSON", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    if (calls === 1) return new Response("{}", { status: 503 });
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  const client = new VertexGeminiClient(
    { projectId: "p", location: "europe-west4", model: "m" },
    fetchImpl,
    { getAccessToken: async () => "t" },
  );
  const result = await client.generateJson({
    systemInstruction: "s",
    parts: [{ text: "x" }],
    responseSchema: {},
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
});

test("VertexGeminiClient reports rejected requests without a body", async () => {
  const client = new VertexGeminiClient(
    { projectId: "p", location: "europe-west4", model: "m" },
    (async () => new Response("secret", { status: 400 })) as typeof fetch,
    { getAccessToken: async () => "t" },
  );
  await assert.rejects(
    client.generateJson({
      systemInstruction: "s",
      parts: [],
      responseSchema: {},
    }),
    (error: unknown) =>
      error instanceof Error && error.message === "GEMINI_REQUEST_REJECTED",
  );
});
