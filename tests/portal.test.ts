import { describe, expect, it } from "vitest";
import { normalizeUrl } from "../src/nodes/PortalNode";

describe("portal url", () => {
  it("keeps http/https", () => {
    expect(normalizeUrl("https://github.com")).toBe("https://github.com");
    expect(normalizeUrl("http://localhost:3000/x")).toBe("http://localhost:3000/x");
  });
  it("adds scheme", () => {
    expect(normalizeUrl("github.com")).toBe("https://github.com");
    expect(normalizeUrl("localhost:1420")).toBe("http://localhost:1420");
    expect(normalizeUrl("127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
  });
  it("rejects garbage", () => {
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl("   ")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
  });
});
