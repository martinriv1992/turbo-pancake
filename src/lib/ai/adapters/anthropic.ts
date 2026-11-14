// Anthropic (Claude) adapter — text generation with structured outputs.
// API surface per the official TypeScript SDK (@anthropic-ai/sdk): Messages API,
// adaptive thinking by default, output_config.format for JSON, server-side refusal fallback.
import Anthropic from "@anthropic-ai/sdk";
import { SCHEMAS, systemPrompt, taskPrompt } from "../prompts";
import { RetryableProviderError, type Adapter, type ProviderConfig } from "../types";
import { CONTENT_TYPES } from "@/lib/content/catalog";

const DEFAULT_MODEL = "claude-opus-5-5";
const keyEnv = (c: ProviderConfig) => c.api_key_env || "ANTHROPIC_API_KEY";

export const anthropicAdapter: Adapter = {
  key: "anthropic",
  label: "Anthropic Claude",
  description: "Reasoning, strategy, scripts, copy, translation and brand analysis. Main orchestration model.",
  generative: true,
  capabilities: ["text", "translation"],
  defaultConfig: { model: DEFAULT_MODEL, api_key_env: "ANTHROPIC_API_KEY", effort: "medium" },
  // Claude Opus 5.5 list price (USD per million tokens). Edit in the provider panel if you
  // change the model or prices change.
  defaultPricing: { input_per_mtok: 4, output_per_mtok: 20 },
  pricingSource: "Anthropic list price for claude-opus-5-5 as of 2026-11",
  defaultQuality: 5,
  defaultSpeed: 3,

  availability(config) {
    return process.env[keyEnv(config)]
      ? { ok: true }
      : { ok: false, reason: `Environment variable ${keyEnv(config)} is not set on the server.` };
  },

  async run(req, config) {
    const client = new Anthropic({ apiKey: process.env[keyEnv(config)] });
    const model = config.model || DEFAULT_MODEL;
    const schema = req.task ? SCHEMAS[req.task] : undefined;
    const effort = (["low", "medium", "high", "xhigh", "max"].includes(config.effort ?? "") ? config.effort : "medium") as
      "low" | "medium" | "high" | "xhigh" | "max";
    const prompt = taskPrompt(req, { allowedTypes: CONTENT_TYPES.map((c) => c.key) });

    try {
      // Streaming keeps long generations clear of HTTP timeouts; finalMessage() collects the result.
      const stream = client.beta.messages.stream({
        model,
        max_tokens: 32000,
        system: systemPrompt(req.brand),
        messages: [{ role: "user", content: prompt }],
        output_config: { effort, ...(schema ? { format: { type: "json_schema" as const, schema } } : {}) },
        // If a safety classifier declines, let the API retry on its default fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      const message = await stream.finalMessage();

      if (message.stop_reason === "refusal") throw new Error("The model declined this request.");
      if (message.stop_reason === "max_tokens") throw new Error("The response was cut off at the output limit.");
      const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
      if (!text) throw new Error("The model returned no text.");

      let json: unknown;
      if (schema) {
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error("The model returned invalid JSON for a structured task.");
        }
      }
      return {
        text: schema ? undefined : text,
        json,
        model: message.model,
        usage: { input: message.usage.input_tokens, output: message.usage.output_tokens, unit: "tokens" },
      };
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError) {
        throw new RetryableProviderError(`Anthropic is temporarily unavailable: ${e.message}`);
      }
      if (e instanceof Anthropic.AuthenticationError) throw new Error("Anthropic rejected the API key.");
      if (e instanceof Anthropic.APIError) throw new Error(`Anthropic API error ${e.status}: ${e.message}`);
      throw e;
    }
  },
};
