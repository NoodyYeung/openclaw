import { Type } from "@sinclair/typebox";
import { resolveApiKeyForProvider } from "openclaw/plugin-sdk/provider-auth";
import {
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_TIMEOUT_SECONDS,
  getScopedCredentialValue,
  normalizeCacheKey,
  readCache,
  readStringParam,
  resolveCacheTtlMs,
  resolveTimeoutSeconds,
  resolveWebSearchProviderCredential,
  setScopedCredentialValue,
  type WebSearchProviderPlugin,
  writeCache,
} from "openclaw/plugin-sdk/provider-web-search";
import {
  buildAnthropicWebSearchPayload,
  requestAnthropicWebSearch,
  resolveAnthropicWebSearchModel,
} from "./src/web-search-shared.js";

const ANTHROPIC_WEB_SEARCH_CACHE = new Map<
  string,
  { value: Record<string, unknown>; insertedAt: number; expiresAt: number }
>();

function runAnthropicWebSearch(params: {
  query: string;
  model: string;
  apiKey: string;
  timeoutSeconds: number;
  cacheTtlMs: number;
}): Promise<Record<string, unknown>> {
  const cacheKey = normalizeCacheKey(`anthropic-web:${params.model}:${params.query}`);
  const cached = readCache(ANTHROPIC_WEB_SEARCH_CACHE, cacheKey);
  if (cached) {
    return Promise.resolve({ ...cached.value, cached: true });
  }

  return (async () => {
    const startedAt = Date.now();
    const result = await requestAnthropicWebSearch({
      query: params.query,
      model: params.model,
      apiKey: params.apiKey,
      timeoutSeconds: params.timeoutSeconds,
    });
    const payload = buildAnthropicWebSearchPayload({
      query: params.query,
      provider: "anthropic-web",
      model: params.model,
      tookMs: Date.now() - startedAt,
      content: result.content,
      citations: result.citations,
    });

    writeCache(ANTHROPIC_WEB_SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
    return payload;
  })();
}

async function resolveAnthropicCredential(
  searchConfig?: Record<string, unknown>,
  config?: Record<string, unknown>,
): Promise<string | undefined> {
  // 1. Check scoped config credential
  const scopedValue = resolveWebSearchProviderCredential({
    credentialValue: getScopedCredentialValue(searchConfig, "anthropic-web"),
    path: "tools.web.search.anthropic-web.apiKey",
    envVars: ["ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN"],
  });
  if (scopedValue) {
    return scopedValue;
  }

  // 2. Fall back to auth profile (setup-token, OAuth, API key)
  try {
    const auth = await resolveApiKeyForProvider({
      provider: "anthropic",
      cfg: config as Parameters<typeof resolveApiKeyForProvider>[0]["cfg"],
    });
    if (auth?.apiKey) {
      return auth.apiKey;
    }
  } catch {
    // No auth profile available
  }

  return undefined;
}

export function createAnthropicWebSearchProvider(): WebSearchProviderPlugin {
  return {
    id: "anthropic-web",
    label: "Claude Web Search (Anthropic)",
    hint: "Uses Anthropic auth profile, API key, or OAuth token · Claude web-grounded responses",
    credentialLabel: "Anthropic API key or OAuth token",
    requiresCredential: false,
    envVars: ["ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN"],
    placeholder: "sk-ant-...",
    signupUrl: "https://console.anthropic.com/",
    docsUrl: "https://docs.openclaw.ai/tools/web",
    autoDetectOrder: 15,
    credentialPath: "plugins.entries.anthropic.config.webSearch.apiKey",
    inactiveSecretPaths: ["plugins.entries.anthropic.config.webSearch.apiKey"],
    getCredentialValue: (searchConfig?: Record<string, unknown>) =>
      getScopedCredentialValue(searchConfig, "anthropic-web"),
    setCredentialValue: (searchConfigTarget: Record<string, unknown>, value: unknown) =>
      setScopedCredentialValue(searchConfigTarget, "anthropic-web", value),
    createTool: (ctx: {
      searchConfig?: Record<string, unknown>;
      config?: Record<string, unknown>;
    }) => ({
      description:
        "Search the web using Claude (Anthropic). Returns AI-synthesized answers with citations from real-time web search.",
      parameters: Type.Object({
        query: Type.String({ description: "Search query string." }),
      }),
      execute: async (args: Record<string, unknown>) => {
        const apiKey = await resolveAnthropicCredential(ctx.searchConfig, ctx.config);

        if (!apiKey) {
          return {
            error: "missing_anthropic_credential",
            message:
              "web_search (anthropic-web) needs an Anthropic credential. Set up Anthropic auth via `openclaw setup`, set ANTHROPIC_API_KEY or ANTHROPIC_OAUTH_TOKEN, or configure plugins.entries.anthropic.config.webSearch.apiKey.",
            docs: "https://docs.openclaw.ai/tools/web",
          };
        }

        const query = readStringParam(args, "query", { required: true });

        return await runAnthropicWebSearch({
          query,
          model: resolveAnthropicWebSearchModel(ctx.searchConfig),
          apiKey,
          timeoutSeconds: resolveTimeoutSeconds(
            (ctx.searchConfig?.timeoutSeconds as number | undefined) ?? undefined,
            DEFAULT_TIMEOUT_SECONDS,
          ),
          cacheTtlMs: resolveCacheTtlMs(
            (ctx.searchConfig?.cacheTtlMinutes as number | undefined) ?? undefined,
            DEFAULT_CACHE_TTL_MINUTES,
          ),
        });
      },
    }),
  };
}

export const __testing = {
  buildAnthropicWebSearchPayload,
  resolveAnthropicWebSearchModel,
  requestAnthropicWebSearch,
};
