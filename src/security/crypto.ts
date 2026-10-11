/** Local cryptography only. Passwords and PINs never enter a network request. */
export const PBKDF2_ITERATIONS = 600_000;
export function encodeBase64(bytes: Uint8Array): string {
  let output = "";
  for (let start = 0; start < bytes.length; start += 32_768)
    output += String.fromCharCode(...bytes.subarray(start, start + 32_768));
  return btoa(output);
}
export function decodeBase64(
  value: string,
  maximumBytes = 100_000_000,
): Uint8Array<ArrayBuffer> {
  if (
    value.length > Math.ceil(maximumBytes / 3) * 4 ||
    value.length % 4 !== 0 ||
    /[^A-Za-z0-9+/]/.test(value.replace(/={1,2}$/, ""))
  )
    throw new Error("The encrypted file is invalid or too large.");
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}
export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}
export async function deriveKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  if (!crypto.subtle)
    throw new Error("Secure cryptography needs HTTPS or localhost.");
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function pinDigest(
  pin: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const digest = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    material,
    256,
  );
  return encodeBase64(new Uint8Array(digest));
}
export function equalDigest(left: string, right: string): boolean {
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index++)
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return mismatch === 0;
}
