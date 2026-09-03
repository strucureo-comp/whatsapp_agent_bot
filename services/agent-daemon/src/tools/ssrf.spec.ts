import { describe, it, expect } from "vitest";
import { validateEndpoint, SsrfError } from "./ssrf.js";

describe("SSRF validation", () => {
  it("rejects non-HTTPS endpoints", async () => {
    await expect(
      validateEndpoint("http://example.com/api"),
    ).rejects.toThrow(SsrfError);
  });

  it("rejects private IP addresses", async () => {
    await expect(
      validateEndpoint("https://192.168.1.1/api"),
    ).rejects.toThrow(SsrfError);
  });

  it("rejects loopback addresses", async () => {
    await expect(
      validateEndpoint("https://127.0.0.1/api"),
    ).rejects.toThrow(SsrfError);
  });

  it("rejects link-local / cloud metadata endpoint", async () => {
    await expect(
      validateEndpoint("https://169.254.169.254/latest/meta-data/"),
    ).rejects.toThrow(SsrfError);
  });

  it("rejects 10.x.x.x addresses", async () => {
    await expect(
      validateEndpoint("https://10.0.0.1/api"),
    ).rejects.toThrow(SsrfError);
  });

  it("rejects 172.16-31.x.x addresses", async () => {
    await expect(
      validateEndpoint("https://172.16.0.1/api"),
    ).rejects.toThrow(SsrfError);
  });
});
