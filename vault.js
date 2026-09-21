const VAULT_ITERATIONS = 250000;

function vaultBytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function vaultBase64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function vaultKey(password, salt) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: VAULT_ITERATIONS, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function encryptVault(vault, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await vaultKey(password, salt);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(vault)));
  return { version: 1, iterations: VAULT_ITERATIONS, salt: vaultBytesToBase64(salt), iv: vaultBytesToBase64(iv), data: vaultBytesToBase64(new Uint8Array(encrypted)) };
}

async function decryptVault(record, password) {
  const salt = vaultBase64ToBytes(record.salt);
  const iv = vaultBase64ToBytes(record.iv);
  const key = await vaultKey(password, salt);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, vaultBase64ToBytes(record.data));
  return JSON.parse(new TextDecoder().decode(decrypted));
}
