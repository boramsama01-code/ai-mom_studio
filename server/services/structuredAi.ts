import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import type { ProviderExecution } from "../../shared/aiProvenance";

type JsonSchema = Record<string, unknown>;
const object = (value: unknown): value is JsonSchema => !!value && typeof value === "object" && !Array.isArray(value);
function nullable(schema: JsonSchema): JsonSchema {
  if (schema.type === "null" || Array.isArray(schema.type) && schema.type.includes("null")) return schema;
  if (Array.isArray(schema.anyOf) && schema.anyOf.some(value => object(value) && value.type === "null")) return schema;
  return { anyOf: [schema, { type: "null" }] };
}

/** OpenAI strict JSON: recursively close objects and express optional properties with null. */
export function strictOpenAiSchema(input: JsonSchema): JsonSchema {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!object(value)) return value;
    const result = Object.fromEntries(Object.entries(value).filter(([key]) => !["$schema", "default"].includes(key)).map(([key, child]) => [key, walk(child)]));
    if (object(value.properties)) {
      const required = new Set(Array.isArray(value.required) ? value.required : []);
      result.properties = Object.fromEntries(Object.entries(value.properties).map(([key, child]) => {
        const schema = walk(child) as JsonSchema;
        return [key, required.has(key) ? schema : nullable(schema)];
      }));
      result.required = Object.keys(value.properties);
      result.additionalProperties = false;
    }
    if (result.type === "object" || Array.isArray(result.type) && result.type.includes("object")) result.additionalProperties = false;
    return result;
  };
  const output = walk(input) as JsonSchema;
  if (output.type !== "object" || output.anyOf) throw new Error("Structured output root must be an object.");
  return output;
}

/** The SDK removes unsupported grammar constraints; our original Zod schema still enforces them. */
export function strictClaudeSchema(input: JsonSchema): JsonSchema {
  const cloned = structuredClone(input);
  if (cloned.type !== "object" || cloned.anyOf) throw new Error("Structured output root must be an object.");
  return jsonSchemaOutputFormat(cloned as { type: "object" }).schema;
}

/** Nullable wire placeholders must not turn a legacy optional non-nullable field into a value. */
export function omitOptionalWireNulls(payload: unknown, schema: JsonSchema): unknown {
  if (Array.isArray(payload)) return object(schema.items) ? payload.map(value => omitOptionalWireNulls(value, schema.items as JsonSchema)) : payload;
  if (!object(payload) || !object(schema.properties)) return payload;
  const properties = schema.properties;
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.fromEntries(Object.entries(payload).flatMap(([key, value]) => {
    const child = properties[key] as JsonSchema | undefined;
    if (!object(child)) return [[key, value]];
    const allowsNull = child.type === "null" || Array.isArray(child.type) && child.type.includes("null") || Array.isArray(child.anyOf) && child.anyOf.some(v => object(v) && v.type === "null");
    if (value === null && !required.has(key) && !allowsNull) return [];
    return [[key, omitOptionalWireNulls(value, child)]];
  }));
}

export function providerUsage(input: unknown, output: unknown): Pick<ProviderExecution, "usageStatus" | "inputTokens" | "outputTokens"> {
  const valid = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
  return { usageStatus: valid(input) && valid(output) ? "known" : "usage_unknown", inputTokens: valid(input) ? input : null, outputTokens: valid(output) ? output : null };
}
export function providerResponseId(value: unknown): string | null {
  return typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,200}$/.test(value) ? value : null;
}
