import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
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

test("extractCsvText and extractXlsxText return text", async () => {
  assert.ok(extractCsvText(Buffer.from("Sofa;2\nBett;1")).includes("Sofa"));
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Liste").addRow(["Sofa", 2]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  assert.ok((await extractXlsxText(buffer)).includes("Sofa"));
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
