import {
  withTrustedWebSearchEndpoint,
  wrapWebContent,
} from "openclaw/plugin-sdk/provider-web-search";

export const ANTHROPIC_WEB_SEARCH_ENDPOINT = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_DEFAULT_WEB_SEARCH_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_API_VERSION = "2023-06-01";

export type AnthropicWebSearchContentBlock =
  | {
      type: "web_search_tool_result";
      tool_use_id?: string;
      content?: Array<{
        type?: string;
        url?: string;
        title?: string;
        encrypted_content?: string;
        page_content?: string;
      }>;
    }
  | {
      type: "text";
      text?: string;
    }
  | {
      type: string;
      [key: string]: unknown;
    };

export type AnthropicWebSearchResponse = {
  content?: AnthropicWebSearchContentBlock[];
};

export type AnthropicWebSearchResult = {
  content: string;
  citations: string[];
};

export function extractAnthropicWebSearchContent(data: AnthropicWebSearchResponse): {
  text: string | undefined;
  citations: string[];
} {
  const citations: string[] = [];
  const textParts: string[] = [];

  for (const block of data.content ?? []) {
    if (
      block.type === "web_search_tool_result" &&
      "content" in block &&
      Array.isArray(block.content)
    ) {
      for (const result of block.content) {
        if (result.type === "web_search_result" && typeof result.url === "string" && result.url) {
          citations.push(result.url);
        }
      }
    }
    if (block.type === "text" && "text" in block && typeof block.text === "string" && block.text) {
      textParts.push(block.text);
    }
  }

  return {
    text: textParts.length > 0 ? textParts.join("\n\n") : undefined,
    citations: [...new Set(citations)],
  };
}

export function buildAnthropicWebSearchPayload(params: {
  query: string;
  provider: string;
  model: string;
  tookMs: number;
  content: string;
  citations: string[];
}): Record<string, unknown> {
  return {
    query: params.query,
    provider: params.provider,
    model: params.model,
    tookMs: params.tookMs,
    externalContent: {
      untrusted: true,
      source: "web_search",
      provider: params.provider,
      wrapped: true,
    },
    content: wrapWebContent(params.content, "web_search"),
    citations: params.citations,
  };
}

export function resolveAnthropicWebSearchModel(searchConfig?: Record<string, unknown>): string {
  const config =
    searchConfig && typeof searchConfig === "object" && !Array.isArray(searchConfig)
      ? ((searchConfig as Record<string, unknown>)["anthropic-web"] as
          | Record<string, unknown>
          | undefined)
      : undefined;
  return typeof config?.model === "string" && config.model.trim()
    ? config.model.trim()
    : ANTHROPIC_DEFAULT_WEB_SEARCH_MODEL;
}

function isOAuthToken(credential: string): boolean {
  return credential.startsWith("sk-ant-oat") || credential.startsWith("ey");
}

function buildAuthHeaders(credential: string): Record<string, string> {
  if (isOAuthToken(credential)) {
    return { Authorization: `Bearer ${credential}` };
  }
  return { "x-api-key": credential };
}

export async function requestAnthropicWebSearch(params: {
  query: string;
  model: string;
  apiKey: string;
  timeoutSeconds: number;
}): Promise<AnthropicWebSearchResult> {
  return await withTrustedWebSearchEndpoint(
    {
      url: ANTHROPIC_WEB_SEARCH_ENDPOINT,
      timeoutSeconds: params.timeoutSeconds,
      init: {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...buildAuthHeaders(params.apiKey),
          "anthropic-version": ANTHROPIC_API_VERSION,
        },
        body: JSON.stringify({
          model: params.model,
          max_tokens: 4096,
          tools: [{ type: "web_search_20260209", name: "web_search" }],
          messages: [{ role: "user", content: params.query }],
        }),
      },
    },
    async (response) => {
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `Anthropic Web Search API error (${response.status}): ${detail || response.statusText}`,
        );
      }
      const data = (await response.json()) as AnthropicWebSearchResponse;
      const { text, citations } = extractAnthropicWebSearchContent(data);
      return {
        content: text ?? "No response",
        citations,
      };
    },
  );
}

export const __testing = {
  buildAnthropicWebSearchPayload,
  extractAnthropicWebSearchContent,
  resolveAnthropicWebSearchModel,
  requestAnthropicWebSearch,
  ANTHROPIC_DEFAULT_WEB_SEARCH_MODEL,
} as const;
