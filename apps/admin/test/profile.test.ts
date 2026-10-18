import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { ProfilePage, RecoveryCodesPanel } from "../src/profile/ProfilePage.js";
import type { StaffUser } from "../src/types.js";

test("profile uses five visible cards without tabs and keeps separate forms and a plain-text name", () => {
  const previous = Reflect.get(globalThis, "React");
  Reflect.set(globalThis, "React", React);
  try {
    const user: StaffUser = {
      id: "test-user",
      name: "root_user",
      email: "test@example.test",
      role: "Admin",
      mustChangePassword: false,
      twoFactorEnabled: true,
      blocked: false,
    };
    const html = renderToStaticMarkup(createElement(ProfilePage, { user }));
    assert.match(
      html,
      /width:100%;max-width:760px;margin-left:auto;margin-right:auto/u,
    );
    assert.doesNotMatch(html, /role="tab(?:list|panel)?"/u);
    assert.equal([...html.matchAll(/<section\b/gu)].length, 5);
    assert.equal([...html.matchAll(/<form\b/gu)].length, 4);
    for (const heading of [
      "Profil",
      "Darstellung",
      "Signatur",
      "Passwort",
      "OTP-Einstellungen",
    ]) {
      assert.match(html, new RegExp(`<h2[^>]*>${heading}</h2>`, "u"));
    }
    assert.ok(html.indexOf(">Signatur</h2>") < html.indexOf(">Passwort</h2>"));
    assert.match(
      html,
      /<input[^>]*placeholder="z\. B\. Max Meier"[^>]*maxLength="100"|<input[^>]*maxLength="100"[^>]*placeholder="z\. B\. Max Meier"/u,
    );
    assert.match(html, /Signaturfarbe/u);
    assert.match(html, /Schwarz/u);
    assert.match(html, /Blau/u);
    assert.match(html, /Orange/u);
    assert.doesNotMatch(html, /Blau \(#28527A\)|Orange \(#CB722F\)/u);
    assert.match(html, /value="#000000"/u);
    assert.match(html, /value="#28527A"/u);
    assert.match(html, /value="#CB722F"/u);
    assert.match(html, /aria-label="Live-Vorschau der Signatur"/u);
    assert.match(html, />Ihr Name<\/p>/u);
    assert.match(html, /Neues Passwort wiederholen/u);
    assert.match(
      html,
      /role="radiogroup" aria-labelledby="appearance-heading"/u,
    );
    for (const value of ["light", "dark", "system"]) {
      assert.match(
        html,
        new RegExp(`<input[^>]*type="radio"[^>]*value="${value}"`, "u"),
      );
    }
    const systemInput = html.match(/<input\b[^>]*value="system"[^>]*>/u)?.[0];
    assert.ok(systemInput);
    assert.ok(systemInput.includes('checked=""'));
    assert.doesNotMatch(
      html,
      /Mindestens 8 Zeichen, inklusive Großbuchstabe, Kleinbuchstabe und Zahl\./u,
    );
    assert.match(html, /padding-top:8px/u);
    assert.match(html, /Codes neu erzeugen/u);
    assert.doesNotMatch(html, /aria-label="Codes herunterladen"/u);
    assert.match(html, /<dt[^>]*>Name<\/dt>/u);
    assert.match(html, /<dd[^>]*>root_user<\/dd>/u);
    assert.doesNotMatch(html, /<input[^>]*value="root_user"/u);
    assert.match(html, /<dt[^>]*>Rolle<\/dt>/u);
    assert.match(html, /<dd[^>]*>Admin<\/dd>/u);
    assert.doesNotMatch(html, /<input[^>]*value="Admin"/u);
    assert.ok(html.indexOf(">root_user</dd>") < html.indexOf(">Rolle</dt>"));
    assert.ok(html.indexOf(">Admin</dd>") < html.indexOf("<form"));
    assert.match(
      html,
      /<input[^>]*type="email"[^>]*value="test@example.test"/u,
    );
    for (const hint of [
      "Für die Änderung",
      "Sitzungen laufen",
      "Das neue Passwort",
      "Wiederherstellungscodes sind einmalig",
    ]) {
      assert.match(
        html,
        new RegExp(`<p class="[^"]*MuiTypography-body2[^"]*">${hint}`, "u"),
      );
    }
    for (const label of [
      "E-Mail-Adresse ändern",
      "Signatur speichern",
      "Passwort ändern",
      "Codes neu erzeugen",
    ]) {
      const button = html.match(
        new RegExp(
          `<button\\b[^>]*class="([^"]+)"[^>]*aria-label="${label}"`,
          "u",
        ),
      );
      assert.ok(button);
      const buttonClass = button[1]
        ?.split(" ")
        .find((className) => className.startsWith("css-"));
      assert.ok(buttonClass);
      assert.ok(html.includes(`.${buttonClass}{`));
      assert.match(
        html.slice(
          html.indexOf(`.${buttonClass}{`),
          html.indexOf("}", html.indexOf(`.${buttonClass}{`)),
        ),
        /align-self:flex-end/u,
      );
    }
    assert.equal(
      [
        ...html.matchAll(
          /aria-hidden="true"[^>]*>E-Mail-Adresse ändern<\/span>/gu,
        ),
      ].length,
      4,
    );
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, "React");
    else Reflect.set(globalThis, "React", previous);
  }
});

test("Kundenberater can set up optional TOTP or disable it with password confirmation; admins cannot disable it", () => {
  const previous = Reflect.get(globalThis, "React");
  Reflect.set(globalThis, "React", React);
  try {
    const base: StaffUser = {
      id: "u",
      name: "Berater",
      email: "b@example.test",
      role: "Kundenberater",
      mustChangePassword: false,
      twoFactorEnabled: false,
      blocked: false,
    };
    const without = renderToStaticMarkup(
      createElement(ProfilePage, { user: base, onSetupTotp: () => {} }),
    );
    assert.match(without, /nicht eingerichtet \(optional\)/u);
    assert.match(without, />TOTP einrichten</u);
    assert.doesNotMatch(without, /TOTP deaktivieren/u);
    const withTotp = renderToStaticMarkup(
      createElement(ProfilePage, {
        user: { ...base, twoFactorEnabled: true },
        onSetupTotp: () => {},
      }),
    );
    assert.doesNotMatch(withTotp, />TOTP einrichten</u);
    assert.match(withTotp, /aria-label="TOTP deaktivieren"/u);
    assert.match(withTotp, /Aktuelles Passwort bestätigen/u);
    const admin = renderToStaticMarkup(
      createElement(ProfilePage, {
        user: { ...base, role: "Admin", twoFactorEnabled: true },
        onSetupTotp: () => {},
      }),
    );
    assert.doesNotMatch(admin, /TOTP deaktivieren|TOTP einrichten|optional/u);
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, "React");
    else Reflect.set(globalThis, "React", previous);
  }
});

test("recovery codes are shown with a download action only when codes are available", () => {
  const previous = Reflect.get(globalThis, "React");
  Reflect.set(globalThis, "React", React);
  try {
    const html = renderToStaticMarkup(
      createElement(RecoveryCodesPanel, {
        codes: ["AAAAA-11111", "BBBBB-22222"],
        onDownload: () => {},
      }),
    );
    assert.match(
      html,
      /<button[^>]*type="button"[^>]*aria-label="Codes herunterladen"/u,
    );
    assert.match(html, /<code[^>]*>AAAAA-11111<\/code>/u);
    assert.match(html, /<code[^>]*>BBBBB-22222<\/code>/u);
    assert.equal(
      renderToStaticMarkup(
        createElement(RecoveryCodesPanel, {
          codes: [],
          onDownload: () => {},
        }),
      ),
      "",
    );
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, "React");
    else Reflect.set(globalThis, "React", previous);
  }
});
