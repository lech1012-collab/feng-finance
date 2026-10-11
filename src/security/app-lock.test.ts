import { afterEach, describe, expect, it } from "vitest";
import { db } from "../storage/database";
import {
  appLockConfiguration,
  disableAppLock,
  enableAppLock,
  setLockDelay,
  shouldLockOnReturn,
  verifyAppPin,
  webAuthnSignature,
} from "./app-lock";
afterEach(async () => {
  await db.settings.clear();
});
describe("local app lock", () => {
  it("stores only a salted slow PIN digest and validates a configured six-digit PIN", async () => {
    await enableAppLock("638204", 1);
    const stored = await db.settings.toArray();
    expect(JSON.stringify(stored)).not.toContain("638204");
    expect(await appLockConfiguration()).toMatchObject({
      enabled: true,
      delayMinutes: 1,
    });
    expect(await verifyAppPin("638204")).toBe(true);
    expect(await verifyAppPin("638205")).toBe(false);
    await setLockDelay(15);
    expect((await appLockConfiguration()).delayMinutes).toBe(15);
    await expect(disableAppLock("000000")).rejects.toThrow("incorrect");
    await disableAppLock("638204");
    expect((await appLockConfiguration()).enabled).toBe(false);
  });
  it("persists failed-attempt throttling across unlock attempts", async () => {
    await enableAppLock("628391", 5);
    for (let attempt = 0; attempt < 5; attempt++)
      expect(await verifyAppPin("123123", 1_000_000)).toBe(false);
    await expect(verifyAppPin("628391", 1_000_001)).rejects.toThrow(
      "Try again in 30 seconds",
    );
    expect(await verifyAppPin("628391", 1_030_001)).toBe(true);
    expect((await db.settings.get("security:attempts"))?.value).toBe("0");
  });
  it("locks only after the configured elapsed background interval", () => {
    expect(shouldLockOnReturn(undefined, 1000, 0)).toBe(false);
    expect(shouldLockOnReturn(1000, 1000, 0)).toBe(true);
    expect(shouldLockOnReturn(1000, 60999, 1)).toBe(false);
    expect(shouldLockOnReturn(1000, 121000, 1)).toBe(true);
  });
  it("rejects unsupported PIN lengths and converts authenticator DER signatures safely", async () => {
    await expect(enableAppLock("1234", 1)).rejects.toThrow("6-digit");
    const encoded = new Uint8Array([0x30, 6, 0x02, 1, 0x01, 0x02, 1, 0x02]);
    const output = webAuthnSignature(encoded);
    expect(output.length).toBe(64);
    expect(output[31]).toBe(1);
    expect(output[63]).toBe(2);
    expect(() => webAuthnSignature(new Uint8Array([0, 1, 2]))).toThrow(
      "Invalid device signature",
    );
  });
});
it("verifies a device assertion signature, origin, challenge and user-verification flag locally", async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const rawId = new Uint8Array([1, 3, 5, 7]);
  const publicKey = new Uint8Array(
    await crypto.subtle.exportKey("spki", pair.publicKey),
  );
  const { encodeBase64 } = await import("./crypto");
  const { authenticatePlatform } = await import("./app-lock");
  await db.settings.bulkPut([
    { key: "security:credential", value: encodeBase64(rawId) },
    { key: "security:credentialPublicKey", value: encodeBase64(publicKey) },
    { key: "security:credentialAlgorithm", value: "-7" },
  ]);
  let userVerification = true;
  const get = async (options: CredentialRequestOptions) => {
    const challenge = options.publicKey!.challenge as Uint8Array;
    const clientDataJSON = new TextEncoder().encode(
      JSON.stringify({
        type: "webauthn.get",
        challenge: encodeBase64(challenge)
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replaceAll("=", ""),
        origin: window.location.origin,
      }),
    );
    const authenticatorData = new Uint8Array(37);
    authenticatorData.set(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(window.location.hostname),
        ),
      ),
    );
    authenticatorData[32] = userVerification ? 5 : 1;
    const clientHash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", clientDataJSON),
    );
    const signed = new Uint8Array(69);
    signed.set(authenticatorData);
    signed.set(clientHash, 37);
    const rawSignature = new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        pair.privateKey,
        signed,
      ),
    );
    const integer = (bytes: Uint8Array) => {
      let first = 0;
      while (first < bytes.length - 1 && bytes[first] === 0) first++;
      const result = Array.from(bytes.subarray(first));
      if (result[0] & 0x80) result.unshift(0);
      return [2, result.length, ...result];
    };
    const parts = [
      ...integer(rawSignature.subarray(0, 32)),
      ...integer(rawSignature.subarray(32)),
    ];
    const signature = new Uint8Array([0x30, parts.length, ...parts]);
    return {
      rawId: rawId.buffer,
      response: {
        clientDataJSON: clientDataJSON.buffer,
        authenticatorData: authenticatorData.buffer,
        signature: signature.buffer,
      },
    };
  };
  const original = Object.getOwnPropertyDescriptor(navigator, "credentials");
  Object.defineProperty(navigator, "credentials", {
    configurable: true,
    value: { get },
  });
  try {
    await expect(authenticatePlatform()).resolves.toBeUndefined();
    userVerification = false;
    await expect(authenticatePlatform()).rejects.toThrow(
      "could not be verified",
    );
  } finally {
    if (original) Object.defineProperty(navigator, "credentials", original);
    else Reflect.deleteProperty(navigator, "credentials");
  }
});
