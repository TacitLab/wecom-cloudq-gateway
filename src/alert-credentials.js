"use strict";

function credentialRedactor(...credentials) {
  const variants = new Set();
  for (const credential of credentials) for (const value of [credential?.secretId, credential?.secretKey].filter(Boolean)) {
    variants.add(value);
    variants.add(JSON.stringify(value).slice(1, -1));
    variants.add(encodeURIComponent(value));
    variants.add(Buffer.from(value).toString("base64"));
  }
  const secrets = [...variants].sort((a, b) => b.length - a.length);
  return (value) => secrets.reduce((result, secret) => result.split(secret).join("[REDACTED]"), String(value ?? ""));
}


module.exports = { credentialRedactor };
