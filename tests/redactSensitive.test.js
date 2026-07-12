import test from "node:test";
import assert from "node:assert/strict";
import { redactSensitiveText } from "../src/analysis/redactSensitive.js";

test("redacts email addresses", () => {
  assert.equal(redactSensitiveText("yaz bana ozge.kiter@gmail.com tamam mi"), "yaz bana [email] tamam mi");
});

test("redacts Turkish and international phone numbers", () => {
  assert.equal(redactSensitiveText("numaram 0532 123 45 67 kaydet"), "numaram [number] kaydet");
  assert.equal(redactSensitiveText("call +49 176 1234567 pls"), "call [number] pls");
  assert.equal(redactSensitiveText("kartim 4111 1111 1111 1111"), "kartim [number]");
});

test("keeps dates, times, and prices intact", () => {
  const text = "12.03.2024 tarihinde saat 19:30 da 250 tl verdim, 3-5 gun surer";
  assert.equal(redactSensitiveText(text), text);
});

test("redacts IBANs", () => {
  assert.equal(redactSensitiveText("TR12 0006 4000 0011 2345 6789 01 hesabima at"), "[account] hesabima at");
});

test("redacts credential tokens after keywords, keeps innocent mentions", () => {
  assert.equal(redactSensitiveText("wifi şifre: Kanka2024!"), "wifi şifre [redacted]");
  assert.equal(redactSensitiveText("username: ozge_kt98 yazdim"), "username [redacted] yazdim");
  assert.equal(redactSensitiveText("otp 483921 geldi"), "otp [redacted] geldi");
  // A normal sentence where the next word is just a word, not a secret.
  assert.equal(redactSensitiveText("şifre neydi ya unuttum"), "şifre neydi ya unuttum");
});

test("redacts credentials embedded in URLs", () => {
  assert.equal(redactSensitiveText("https://ozge:hunter2@site.com/x bak"), "https://[redacted]@site.com/x bak");
});

test("leaves ordinary chat untouched", () => {
  const text = "dun gece ruyamda seni gordum kanka, cok komikti";
  assert.equal(redactSensitiveText(text), text);
});
