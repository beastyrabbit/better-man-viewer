import type {
  FilterLine,
  FindMatch,
  SectionAnchor,
  TokenKind,
  TokenSegment,
} from "./types";

const KNOWN_SECTION_HEADINGS = new Set([
  "NAME",
  "SYNOPSIS",
  "DESCRIPTION",
  "OPTIONS",
  "COMMANDS",
  "EXAMPLES",
  "FILES",
  "ENVIRONMENT",
  "EXIT STATUS",
  "RETURN VALUE",
  "STANDARDS",
  "COMPATIBILITY",
  "BUGS",
  "SEE ALSO",
  "AUTHOR",
  "COPYRIGHT",
]);

const TOKEN_PATTERN =
  /(--?[a-zA-Z0-9][\w-]*|\b[A-Z][A-Z0-9_]{2,}\b|(?:~|\/)[\w./-]+|`[^`]+`|\b[a-z]{2,}\(\d\)\b)/g;

export function splitLines(rawText: string): string[] {
  if (!rawText) {
    return [];
  }

  const lines = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 50);
}

function isLikelyHeading(lines: string[], index: number): boolean {
  const line = lines[index]?.trim() ?? "";
  if (!line || line.length > 72) {
    return false;
  }

  if (KNOWN_SECTION_HEADINGS.has(line)) {
    return true;
  }

  const uppercasePattern = /^[A-Z0-9][A-Z0-9\s\-_/(),.+]*$/;
  if (!uppercasePattern.test(line) || line !== line.toUpperCase()) {
    return false;
  }

  const previous = lines[index - 1]?.trim() ?? "";
  const next = lines[index + 1]?.trim() ?? "";
  return previous === "" || next === "";
}

export function parseSections(lines: string[]): SectionAnchor[] {
  if (lines.length === 0) {
    return [];
  }

  const headingIndexes: Array<{ index: number; title: string }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (isLikelyHeading(lines, index)) {
      headingIndexes.push({ index, title: lines[index].trim() });
    }
  }

  if (headingIndexes.length === 0) {
    return [
      {
        id: "document",
        title: "DOCUMENT",
        startLine: 0,
        endLine: Math.max(lines.length - 1, 0),
      },
    ];
  }

  const idCounts = new Map<string, number>();

  return headingIndexes.map(({ index, title }, position) => {
    const baseId = slugify(title) || `section-${position + 1}`;
    const seen = idCounts.get(baseId) ?? 0;
    idCounts.set(baseId, seen + 1);

    return {
      id: seen === 0 ? baseId : `${baseId}-${seen + 1}`,
      title,
      startLine: index,
      endLine: (headingIndexes[position + 1]?.index ?? lines.length) - 1,
    };
  });
}

function classifyToken(token: string): TokenKind {
  if (token.startsWith("--") || token.startsWith("-")) {
    return "option";
  }

  if (token.startsWith("/") || token.startsWith("~/")) {
    return "path";
  }

  if (/^[A-Z][A-Z0-9_]{2,}$/.test(token)) {
    return "env";
  }

  if (token.startsWith("`") && token.endsWith("`")) {
    return "literal";
  }

  if (/^[a-z]{2,}\(\d\)$/.test(token)) {
    return "command";
  }

  return "plain";
}

export function tokenizeLine(line: string): TokenSegment[] {
  const trimmed = line.trim();
  if (
    trimmed !== "" &&
    trimmed.length <= 72 &&
    trimmed === trimmed.toUpperCase()
  ) {
    return [{ text: line, kind: "heading" }];
  }

  const segments: TokenSegment[] = [];
  let lastIndex = 0;

  for (const match of line.matchAll(TOKEN_PATTERN)) {
    const token = match[0];
    const start = match.index ?? 0;

    if (start > lastIndex) {
      segments.push({ text: line.slice(lastIndex, start), kind: "plain" });
    }

    segments.push({ text: token, kind: classifyToken(token) });
    lastIndex = start + token.length;
  }

  if (lastIndex < line.length) {
    segments.push({ text: line.slice(lastIndex), kind: "plain" });
  }

  return segments.length === 0 ? [{ text: line, kind: "plain" }] : segments;
}

function normalizeForSearch(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLowerCase();
}

export function findMatches(
  lines: string[],
  query: string,
  caseSensitive = false,
): FindMatch[] {
  const needleRaw = query.trim();
  if (!needleRaw) {
    return [];
  }

  const needle = normalizeForSearch(needleRaw, caseSensitive);
  const matches: FindMatch[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const haystack = normalizeForSearch(line, caseSensitive);

    let offset = 0;
    while (offset < haystack.length) {
      const nextIndex = haystack.indexOf(needle, offset);
      if (nextIndex === -1) {
        break;
      }

      matches.push({
        lineIndex,
        start: nextIndex,
        end: nextIndex + needleRaw.length,
        preview: line.trim() || "(blank line)",
      });

      offset = nextIndex + Math.max(needleRaw.length, 1);
      if (matches.length > 20_000) {
        return matches;
      }
    }
  }

  return matches;
}

export function buildFilterLines(
  lines: string[],
  matches: FindMatch[],
): FilterLine[] {
  const counts = new Map<number, number>();

  matches.forEach((match) => {
    counts.set(match.lineIndex, (counts.get(match.lineIndex) ?? 0) + 1);
  });

  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([lineIndex, matchCount]) => ({
      lineIndex,
      text: lines[lineIndex] || "",
      matchCount,
    }));
}
