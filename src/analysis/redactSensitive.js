// ─────────────────────────────────────────────────────────────────
// REDACT SENSITIVE — strips contact info and credentials from chat text
// BEFORE it is sampled into any AI request. Runs entirely client-side:
// redacted values never leave the device.
//
// Applied at the three funnels every AI-bound message passes through:
// window/snapshot formatting, candidate-moment quotes, and the
// relationship-confirm snippets. Local math and on-device rendering are
// intentionally untouched (users may see their own data; the AI may not).
//
// Pure JS, no imports (node-testable).
// ─────────────────────────────────────────────────────────────────

const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;

// user:pass@host in URLs — credentials part only.
const URL_CREDENTIALS_RE = /(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi;

// IBANs: two letters, two digits, then a long alnum tail (TR IBANs are often
// typed with spaces).
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{2,4}){3,8}\b/g;

// Phone/card/account numbers: digit runs (with optional separators) that
// contain 10+ digits total. Dates (8 digits), times, and prices stay intact.
const LONG_NUMBER_RE = /\+?\d[\d ().\-/]{6,}\d/g;

// "password: hunter2", "şifre 1234", "pin: 0000", "kullanıcı adı: ozge98" —
// keyword followed by the secret token. The keyword survives, the token goes.
const CREDENTIAL_KEYWORD_RE = /(?<![\p{L}\p{N}])(password|passwd|pwd|pass ?code|parola|şifre|sifre|pin kodu|pin|verification code|auth code|otp|doğrulama kodu|dogrulama kodu|kullanıcı adı|kullanici adi|username|login|user id|hesap no|account number|iban)(?![\p{L}\p{N}])[\s:=\-–]*([^\s,;]{3,})/giu;

function countDigits(text) {
  return (String(text).match(/\d/g) || []).length;
}

export function redactSensitiveText(text) {
  let value = String(text ?? "");
  if (!value) return value;

  value = value.replace(URL_CREDENTIALS_RE, "$1[redacted]@");
  value = value.replace(EMAIL_RE, "[email]");
  value = value.replace(IBAN_RE, "[account]");
  value = value.replace(CREDENTIAL_KEYWORD_RE, (match, keyword, token) => {
    // Keep innocent uses like "şifre neydi ya" (token is a normal word after
    // a question) — only redact tokens that look like actual secrets:
    // digits, mixed case+digits, or symbol-bearing strings.
    const secretLike = /\d/.test(token) || /[^\p{L}\s]/u.test(token) || /^[A-Za-z0-9]{8,}$/.test(token);
    return secretLike ? `${keyword} [redacted]` : match;
  });
  value = value.replace(LONG_NUMBER_RE, match => (countDigits(match) >= 10 ? "[number]" : match));

  return value;
}
