import { db } from "../storage/database";
import { SECURITY_CHANGE_EVENT } from "./events";
export { SECURITY_CHANGE_EVENT } from "./events";
import {
  decodeBase64,
  encodeBase64,
  equalDigest,
  pinDigest,
  randomBytes,
} from "./crypto";
export type LockDelay = 0 | 1 | 5 | 15;
export interface AppLockConfiguration {
  enabled: boolean;
  delayMinutes: LockDelay;
  credentialId?: string;
}
function notifySecurityChange() {
  window.dispatchEvent(new Event(SECURITY_CHANGE_EVENT));
}
export async function appLockConfiguration(): Promise<AppLockConfiguration> {
  const values = await db.settings.bulkGet([
    "security:enabled",
    "security:delay",
    "security:credential",
  ]);
  const delay = Number(values[1]?.value ?? 1);
  return {
    enabled: values[0]?.value === "true",
    delayMinutes: [0, 1, 5, 15].includes(delay) ? (delay as LockDelay) : 1,
    credentialId: values[2]?.value || undefined,
  };
}
export function shouldLockOnReturn(
  hiddenAt: number | undefined,
  now: number,
  delay: LockDelay,
): boolean {
  return hiddenAt !== undefined && now - hiddenAt >= delay * 60_000;
}
export async function enableAppLock(
  pin: string,
  delay: LockDelay,
): Promise<void> {
  if (!/^\d{6}$/.test(pin)) throw new Error("Choose a 6-digit PIN.");
  if (![0, 1, 5, 15].includes(delay))
    throw new Error("Choose a supported lock delay.");
  const salt = randomBytes(16);
  const digest = await pinDigest(pin, salt);
  await db.transaction("rw", db.settings, async () => {
    await db.settings.bulkPut([
      { key: "security:pinSalt", value: encodeBase64(salt) },
      { key: "security:pinHash", value: digest },
      { key: "security:enabled", value: "true" },
      { key: "security:delay", value: String(delay) },
      { key: "security:attempts", value: "0" },
      { key: "security:retryAt", value: "0" },
    ]);
  });
  notifySecurityChange();
}
export async function verifyAppPin(
  pin: string,
  now = Date.now(),
): Promise<boolean> {
  const values = await db.settings.bulkGet([
    "security:pinSalt",
    "security:pinHash",
    "security:attempts",
    "security:retryAt",
  ]);
  const retryAt = Number(values[3]?.value ?? 0);
  if (retryAt > now) {
    const seconds = Math.ceil((retryAt - now) / 1000);
    throw new Error(
      `Too many attempts. Try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`,
    );
  }
  const salt = values[0]?.value,
    expected = values[1]?.value;
  if (!salt || !expected)
    throw new Error("App lock is not configured on this device.");
  const actual = /^\d{6}$/.test(pin)
    ? await pinDigest(pin, decodeBase64(salt))
    : "";
  const valid = equalDigest(actual, expected);
  const failures = valid ? 0 : Number(values[2]?.value ?? 0) + 1;
  const waitMs =
    failures < 5
      ? 0
      : Math.min(300_000, 30_000 * 2 ** Math.min(4, failures - 5));
  await db.settings.bulkPut([
    { key: "security:attempts", value: String(failures) },
    { key: "security:retryAt", value: String(now + waitMs) },
  ]);
  return valid;
}
export async function disableAppLock(pin: string): Promise<void> {
  if (!(await verifyAppPin(pin))) throw new Error("The PIN is incorrect.");
  await db.settings.where("key").startsWith("security:").delete();
  notifySecurityChange();
}
export async function setLockDelay(delay: LockDelay): Promise<void> {
  if (![0, 1, 5, 15].includes(delay))
    throw new Error("Choose a supported lock delay.");
  await db.settings.put({ key: "security:delay", value: String(delay) });
  notifySecurityChange();
}
export async function platformAuthenticatorAvailable(): Promise<boolean> {
  return (
    window.isSecureContext &&
    typeof PublicKeyCredential !== "undefined" &&
    (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
  );
}
/** Platform credentials are origin-scoped and stay on this device; no server exists. */
export async function registerPlatformAuthenticator(): Promise<void> {
  if (!(await platformAuthenticatorAvailable()))
    throw new Error(
      "Face ID or Touch ID is unavailable in this browser. You can use your PIN.",
    );
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { name: "Feng Finance", id: window.location.hostname },
      user: {
        id: randomBytes(32),
        name: "feng-device",
        displayName: "Feng Finance device",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      attestation: "none",
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("Device authentication was cancelled.");
  const attestation = credential.response as AuthenticatorAttestationResponse;
  const publicKey = attestation.getPublicKey?.();
  const algorithm = attestation.getPublicKeyAlgorithm?.();
  if (!publicKey || ![-7, -257].includes(algorithm))
    throw new Error(
      "This browser cannot save device authentication securely. Keep using your PIN.",
    );
  await db.settings.bulkPut([
    {
      key: "security:credential",
      value: encodeBase64(new Uint8Array(credential.rawId)),
    },
    {
      key: "security:credentialPublicKey",
      value: encodeBase64(new Uint8Array(publicKey)),
    },
    { key: "security:credentialAlgorithm", value: String(algorithm) },
  ]);
  notifySecurityChange();
}
function base64Url(bytes: Uint8Array): string {
  return encodeBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
/** WebAuthn ES256 uses DER signatures; Web Crypto expects the 64-byte r || s form. */
export function webAuthnSignature(
  signature: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  if (
    signature[0] !== 0x30 ||
    signature.length < 8 ||
    signature[1] !== signature.length - 2
  )
    throw new Error("Invalid device signature.");
  let cursor = 2;
  const output = new Uint8Array(64);
  for (let part = 0; part < 2; part++) {
    if (signature[cursor++] !== 0x02)
      throw new Error("Invalid device signature.");
    const length = signature[cursor++];
    if (!length || length > 33 || cursor + length > signature.length)
      throw new Error("Invalid device signature.");
    let integer = signature.subarray(cursor, cursor + length);
    cursor += length;
    if (integer.length === 33) {
      if (integer[0] !== 0) throw new Error("Invalid device signature.");
      integer = integer.subarray(1);
    }
    output.set(integer, part * 32 + 32 - integer.length);
  }
  if (cursor !== signature.length) throw new Error("Invalid device signature.");
  return output;
}
export async function authenticatePlatform(): Promise<void> {
  const configuration = await appLockConfiguration();
  if (!configuration.credentialId)
    throw new Error("Set up Face ID or Touch ID first, or use your PIN.");
  const challenge = randomBytes(32);
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: window.location.hostname,
      allowCredentials: [
        { type: "public-key", id: decodeBase64(configuration.credentialId) },
      ],
      userVerification: "required",
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (
    !credential ||
    !equalDigest(
      encodeBase64(new Uint8Array(credential.rawId)),
      configuration.credentialId,
    )
  )
    throw new Error(
      "Device authentication did not complete. Use your PIN or try again.",
    );
  const response = credential.response as AuthenticatorAssertionResponse;
  const clientData = JSON.parse(
    new TextDecoder().decode(response.clientDataJSON),
  ) as {
    type?: string;
    challenge?: string;
    origin?: string;
    crossOrigin?: boolean;
  };
  const authData = new Uint8Array(response.authenticatorData);
  const rpHash = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(window.location.hostname),
    ),
  );
  if (
    clientData.type !== "webauthn.get" ||
    clientData.challenge !== base64Url(challenge) ||
    clientData.origin !== window.location.origin ||
    clientData.crossOrigin === true ||
    authData.length < 37 ||
    (authData[32] & 5) !== 5 ||
    !equalDigest(encodeBase64(authData.subarray(0, 32)), encodeBase64(rpHash))
  )
    throw new Error(
      "Device authentication could not be verified. Use your PIN.",
    );
  const values = await db.settings.bulkGet([
    "security:credentialPublicKey",
    "security:credentialAlgorithm",
  ]);
  if (!values[0]?.value)
    throw new Error("Set up device authentication again, or use your PIN.");
  const algorithm = Number(values[1]?.value);
  if (![-7, -257].includes(algorithm))
    throw new Error("Device authentication has an unsupported signature.");
  const key = await crypto.subtle.importKey(
    "spki",
    decodeBase64(values[0].value),
    algorithm === -7
      ? { name: "ECDSA", namedCurve: "P-256" }
      : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const dataHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", response.clientDataJSON),
  );
  const signed = new Uint8Array(authData.length + dataHash.length);
  signed.set(authData);
  signed.set(dataHash, authData.length);
  const signature =
    algorithm === -7
      ? webAuthnSignature(new Uint8Array(response.signature))
      : new Uint8Array(response.signature);
  if (
    !(await crypto.subtle.verify(
      algorithm === -7
        ? { name: "ECDSA", hash: "SHA-256" }
        : { name: "RSASSA-PKCS1-v1_5" },
      key,
      signature,
      signed,
    ))
  )
    throw new Error(
      "Device authentication could not be verified. Use your PIN.",
    );
}
