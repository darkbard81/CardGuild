import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";

import type {
  ContentSourceCategory,
  ContentSourceLocations,
  ContentValidationIssue,
} from "./content-types";

const CATEGORIES = new Set<ContentSourceCategory>([
  "manifest",
  "traits",
  "conditions",
  "actions",
  "cards",
  "equipment",
  "actors",
  "scenario",
]);

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function categoryFor(error: ErrorObject): ContentSourceCategory {
  const segment = error.instancePath.split("/").filter(Boolean)[0];
  return segment && CATEGORIES.has(segment as ContentSourceCategory)
    ? segment as ContentSourceCategory
    : "manifest";
}

function definitionIdFor(value: unknown, category: ContentSourceCategory, instancePath: string): string | undefined {
  const root = asRecord(value);
  const categoryValue = root?.[category];
  const indexText = instancePath.split("/").filter(Boolean)[1];
  if (Array.isArray(categoryValue) && indexText !== undefined) {
    const definition = asRecord(categoryValue[Number(indexText)]);
    return typeof definition?.id === "string" ? definition.id : undefined;
  }
  if (category === "scenario") {
    const scenario = asRecord(categoryValue);
    return typeof scenario?.id === "string" ? scenario.id : undefined;
  }
  return undefined;
}

function packIdFor(value: unknown): string | undefined {
  const manifest = asRecord(asRecord(value)?.manifest);
  return typeof manifest?.id === "string" ? manifest.id : undefined;
}

function pathFor(error: ErrorObject): string {
  const base = error.instancePath || "/";
  if (error.keyword === "required") {
    const missing = (error.params as { readonly missingProperty?: string }).missingProperty;
    return missing ? `${base === "/" ? "" : base}/${missing}` : base;
  }
  if (error.keyword === "additionalProperties") {
    const property = (error.params as { readonly additionalProperty?: string }).additionalProperty;
    return property ? `${base === "/" ? "" : base}/${property}` : base;
  }
  return base;
}

export function validateContentPackStructure(
  value: unknown,
  schema: object,
  locations: ContentSourceLocations = {},
): readonly ContentValidationIssue[] {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  if (validate(value)) return [];

  return (validate.errors ?? [])
    .map((error) => {
      const category = categoryFor(error);
      return {
        packId: packIdFor(value),
        source: locations[category] ?? category,
        path: pathFor(error),
        definitionId: definitionIdFor(value, category, error.instancePath),
        code: `SCHEMA_${error.keyword.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}`,
        message: error.message ?? `Schema keyword ${error.keyword} failed.`,
      } satisfies ContentValidationIssue;
    })
    .sort(
      (left, right) =>
        left.source.localeCompare(right.source) ||
        left.path.localeCompare(right.path) ||
        left.code.localeCompare(right.code),
    );
}
