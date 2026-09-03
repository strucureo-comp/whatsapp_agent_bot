import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptSecret, decryptSecret, maskKey } from "./secrets.js";

describe("secrets AES-256-GCM encryption & masking", () => {
  const originalKey = process.env.CREDENTIALS_ENC_KEY;

  beforeEach(() => {
    process.env.CREDENTIALS_ENC_KEY = "test-encryption-key-for-unit-tests-123456";
  });

  afterEach(() => {
    process.env.CREDENTIALS_ENC_KEY = originalKey;
  });

  it("encrypts and decrypts correctly with string key", () => {
    const plain = "sk-ant-api03-abcdef1234567890";
    const encrypted = encryptSecret(plain);
    expect(encrypted).not.toBe(plain);
    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(plain);
  });

  it("encrypts and decrypts correctly with 64-char hex key", () => {
    process.env.CREDENTIALS_ENC_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const plain = "gsk_my_secret_groq_key_9999";
    const encrypted = encryptSecret(plain);
    expect(encrypted).not.toBe(plain);
    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(plain);
  });

  it("throws if CREDENTIALS_ENC_KEY is missing", () => {
    delete process.env.CREDENTIALS_ENC_KEY;
    expect(() => encryptSecret("secret")).toThrow(/CREDENTIALS_ENC_KEY is not set/);
  });

  it("fails to decrypt tampered ciphertext", () => {
    const encrypted = encryptSecret("hello-world");
    const buf = Buffer.from(encrypted, "base64");
    buf[buf.length - 1] ^= 0x01; // flip a bit
    const tampered = buf.toString("base64");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("masks keys correctly", () => {
    expect(maskKey("sk-proj-12345678abcd")).toBe("****abcd");
    expect(maskKey("abcd")).toBe("****abcd");
    expect(maskKey("ab")).toBe("****ab");
    expect(maskKey("")).toBe("••••");
    expect(maskKey("   ")).toBe("••••");
  });
});
