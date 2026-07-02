import { describe, it, expect, vi, afterEach } from "vitest";
import { GoogleVisionOcr } from "../google-vision";
import { getOcrProvider } from "../index";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("GoogleVisionOcr", () => {
  it("returns fullTextAnnotation text on success", async () => {
    const fetchMock = mockFetchOnce({
      responses: [{ fullTextAnnotation: { text: "064/198\nH" } }],
    });
    const ocr = new GoogleVisionOcr("test-key");
    const text = await ocr.readText("base64data");
    expect(text).toBe("064/198\nH");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("key=test-key");
    const payload = JSON.parse(init.body);
    expect(payload.requests[0].image.content).toBe("base64data");
    expect(payload.requests[0].features[0].type).toBe("TEXT_DETECTION");
  });

  it("falls back to textAnnotations[0]", async () => {
    mockFetchOnce({
      responses: [{ textAnnotations: [{ description: "TG15/TG30" }] }],
    });
    const ocr = new GoogleVisionOcr("k");
    expect(await ocr.readText("x")).toBe("TG15/TG30");
  });

  it("returns null on HTTP error", async () => {
    mockFetchOnce({}, false, 403);
    const ocr = new GoogleVisionOcr("k");
    expect(await ocr.readText("x")).toBeNull();
  });

  it("returns null on API-level error", async () => {
    mockFetchOnce({ responses: [{ error: { message: "quota" } }] });
    const ocr = new GoogleVisionOcr("k");
    expect(await ocr.readText("x")).toBeNull();
  });

  it("returns null when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    const ocr = new GoogleVisionOcr("k");
    expect(await ocr.readText("x")).toBeNull();
  });

  it("returns null on empty responses", async () => {
    mockFetchOnce({ responses: [{}] });
    const ocr = new GoogleVisionOcr("k");
    expect(await ocr.readText("x")).toBeNull();
  });
});

describe("getOcrProvider", () => {
  it("returns null without GOOGLE_VISION_API_KEY", () => {
    vi.stubEnv("GOOGLE_VISION_API_KEY", "");
    expect(getOcrProvider()).toBeNull();
  });

  it("returns the Google provider when configured", () => {
    vi.stubEnv("GOOGLE_VISION_API_KEY", "abc");
    expect(getOcrProvider()?.name).toBe("google-cloud-vision");
  });
});
