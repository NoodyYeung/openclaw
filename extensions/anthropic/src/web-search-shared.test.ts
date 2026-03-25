import { describe, expect, it } from "vitest";
import {
  extractAnthropicWebSearchContent,
  buildAnthropicWebSearchPayload,
  resolveAnthropicWebSearchModel,
  ANTHROPIC_DEFAULT_WEB_SEARCH_MODEL,
  type AnthropicWebSearchResponse,
} from "./web-search-shared.js";

describe("extractAnthropicWebSearchContent", () => {
  it("extracts text and citations from a typical response", () => {
    const response: AnthropicWebSearchResponse = {
      content: [
        {
          type: "web_search_tool_result",
          tool_use_id: "toolu_1",
          content: [
            {
              type: "web_search_result",
              url: "https://example.com/article1",
              title: "Article 1",
              encrypted_content: "...",
            },
            {
              type: "web_search_result",
              url: "https://example.com/article2",
              title: "Article 2",
              encrypted_content: "...",
            },
          ],
        },
        {
          type: "text",
          text: "Based on the search results, here is what I found.",
        },
      ],
    };

    const result = extractAnthropicWebSearchContent(response);
    expect(result.text).toBe("Based on the search results, here is what I found.");
    expect(result.citations).toEqual([
      "https://example.com/article1",
      "https://example.com/article2",
    ]);
  });

  it("deduplicates citation URLs", () => {
    const response: AnthropicWebSearchResponse = {
      content: [
        {
          type: "web_search_tool_result",
          content: [
            { type: "web_search_result", url: "https://example.com/a" },
            { type: "web_search_result", url: "https://example.com/a" },
            { type: "web_search_result", url: "https://example.com/b" },
          ],
        },
        { type: "text", text: "Answer" },
      ],
    };

    const result = extractAnthropicWebSearchContent(response);
    expect(result.citations).toEqual(["https://example.com/a", "https://example.com/b"]);
  });

  it("handles empty response", () => {
    const result = extractAnthropicWebSearchContent({});
    expect(result.text).toBeUndefined();
    expect(result.citations).toEqual([]);
  });

  it("handles response with no text blocks", () => {
    const response: AnthropicWebSearchResponse = {
      content: [
        {
          type: "web_search_tool_result",
          content: [{ type: "web_search_result", url: "https://example.com" }],
        },
      ],
    };

    const result = extractAnthropicWebSearchContent(response);
    expect(result.text).toBeUndefined();
    expect(result.citations).toEqual(["https://example.com"]);
  });

  it("concatenates multiple text blocks", () => {
    const response: AnthropicWebSearchResponse = {
      content: [
        { type: "text", text: "First part." },
        { type: "text", text: "Second part." },
      ],
    };

    const result = extractAnthropicWebSearchContent(response);
    expect(result.text).toBe("First part.\n\nSecond part.");
  });

  it("handles multiple web_search_tool_result blocks", () => {
    const response: AnthropicWebSearchResponse = {
      content: [
        {
          type: "web_search_tool_result",
          content: [{ type: "web_search_result", url: "https://a.com" }],
        },
        {
          type: "web_search_tool_result",
          content: [{ type: "web_search_result", url: "https://b.com" }],
        },
        { type: "text", text: "Combined results." },
      ],
    };

    const result = extractAnthropicWebSearchContent(response);
    expect(result.citations).toEqual(["https://a.com", "https://b.com"]);
    expect(result.text).toBe("Combined results.");
  });
});

describe("buildAnthropicWebSearchPayload", () => {
  it("wraps content with security metadata", () => {
    const payload = buildAnthropicWebSearchPayload({
      query: "test query",
      provider: "anthropic-web",
      model: "claude-sonnet-4-6",
      tookMs: 1234,
      content: "Some answer",
      citations: ["https://example.com"],
    });

    expect(payload.query).toBe("test query");
    expect(payload.provider).toBe("anthropic-web");
    expect(payload.model).toBe("claude-sonnet-4-6");
    expect(payload.tookMs).toBe(1234);
    expect(payload.citations).toEqual(["https://example.com"]);
    expect(payload.externalContent).toEqual({
      untrusted: true,
      source: "web_search",
      provider: "anthropic-web",
      wrapped: true,
    });
    expect(typeof payload.content).toBe("string");
  });
});

describe("resolveAnthropicWebSearchModel", () => {
  it("returns default model when no config", () => {
    expect(resolveAnthropicWebSearchModel()).toBe(ANTHROPIC_DEFAULT_WEB_SEARCH_MODEL);
    expect(resolveAnthropicWebSearchModel({})).toBe(ANTHROPIC_DEFAULT_WEB_SEARCH_MODEL);
  });

  it("reads model from scoped config", () => {
    const config = { "anthropic-web": { model: "claude-haiku-4-5" } };
    expect(resolveAnthropicWebSearchModel(config)).toBe("claude-haiku-4-5");
  });

  it("ignores empty model string", () => {
    const config = { "anthropic-web": { model: "  " } };
    expect(resolveAnthropicWebSearchModel(config)).toBe(ANTHROPIC_DEFAULT_WEB_SEARCH_MODEL);
  });
});
