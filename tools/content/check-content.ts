import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { compileContentPack, ContentCompilationError } from "../../src/content/compile-content";
import {
  assembleContentPackSource,
  type ContentPackFiles,
  type ContentPackSource,
  type ContentSourceCategory,
  type ContentSourceLocations,
  type ContentValidationIssue,
} from "../../src/content/content-types";
import { validateContentPackStructure } from "../../src/content/validate-content";
import { formatContentValidationIssue } from "../../src/content/validate-semantics";

const CATEGORIES: readonly ContentSourceCategory[] = [
  "manifest",
  "traits",
  "conditions",
  "actions",
  "cards",
  "equipment",
  "actors",
  "scenario",
];

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

function parseIssue(source: string, error: unknown): ContentValidationIssue {
  return {
    source,
    path: "/",
    code: error instanceof SyntaxError ? "JSON_PARSE_ERROR" : "CONTENT_READ_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
}

async function checkPack(
  packDirectory: string,
  schema: object,
): Promise<{ readonly success?: string; readonly issues: readonly ContentValidationIssue[] }> {
  const locations = Object.fromEntries(
    CATEGORIES.map((category) => [category, path.relative(process.cwd(), path.join(packDirectory, `${category}.json`))]),
  ) as ContentSourceLocations;
  const filePaths = Object.fromEntries(
    CATEGORIES.map((category) => [category, path.join(packDirectory, `${category}.json`)]),
  ) as Readonly<Record<ContentSourceCategory, string>>;
  const values: Partial<Record<ContentSourceCategory, unknown>> = {};
  const parseIssues: ContentValidationIssue[] = [];

  await Promise.all(
    CATEGORIES.map(async (category) => {
      const filePath = filePaths[category];
      try {
        values[category] = await readJson(filePath);
      } catch (error) {
        parseIssues.push(parseIssue(locations[category] ?? filePath, error));
      }
    }),
  );
  if (parseIssues.length > 0) return { issues: parseIssues.sort((left, right) => left.source.localeCompare(right.source)) };

  const assembled = assembleContentPackSource(values as unknown as ContentPackFiles);
  const structuralIssues = validateContentPackStructure(assembled, schema, locations);
  if (structuralIssues.length > 0) return { issues: structuralIssues };

  try {
    const compiled = compileContentPack(assembled as ContentPackSource, locations);
    return {
      success: `${compiled.manifest.id}@${compiled.manifest.version} ${compiled.fingerprint}`,
      issues: [],
    };
  } catch (error) {
    if (error instanceof ContentCompilationError) return { issues: error.issues };
    throw error;
  }
}

async function main(): Promise<void> {
  const repositoryRoot = process.cwd();
  const contentRoot = path.join(repositoryRoot, "content");
  const schema = await readJson(path.join(contentRoot, "schema", "content-pack.schema.json"));
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error("content-pack.schema.json must contain a JSON object.");
  }

  const directories = (await readdir(contentRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name !== "schema")
    .map((entry) => path.join(contentRoot, entry.name))
    .sort((left, right) => left.localeCompare(right));
  if (directories.length === 0) throw new Error("No content packs were found.");

  let failed = false;
  for (const directory of directories) {
    const result = await checkPack(directory, schema);
    if (result.success) process.stdout.write(`Content OK: ${result.success}\n`);
    if (result.issues.length > 0) {
      failed = true;
      for (const issue of result.issues) process.stderr.write(`${formatContentValidationIssue(issue)}\n\n`);
    }
  }
  if (failed) process.exitCode = 1;
}

await main();
