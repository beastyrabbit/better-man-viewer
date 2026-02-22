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

function isTitleLine(value: string): boolean {
  return /^[A-Z0-9_.+-]+\(\d+\)$/.test(value);
}

function getIndentation(rawLine: string): number {
  const match = rawLine.match(/^\s*/);
  return match ? match[0].length : 0;
}

function isLikelyTopLevelHeading(lines: string[], index: number): boolean {
  const rawLine = lines[index] ?? "";
  const line = rawLine.trim();
  const indentation = getIndentation(rawLine);

  if (!line || line.length > 72) {
    return false;
  }

  if (isTitleLine(line)) {
    return false;
  }

  if (indentation > 1) {
    return false;
  }

  if (KNOWN_SECTION_HEADINGS.has(line) && line === line.toUpperCase()) {
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

function isLikelySubHeading(lines: string[], index: number): boolean {
  const rawLine = lines[index] ?? "";
  const line = rawLine.trim();
  const indentation = getIndentation(rawLine);

  if (!line || line.length > 64 || isTitleLine(line)) {
    return false;
  }

  const isUppercase = line === line.toUpperCase();
  const isLowercase = line === line.toLowerCase();
  if (isLowercase) {
    return false;
  }

  if (/^[-*]/.test(line) || /^--?[a-zA-Z0-9]/.test(line)) {
    return false;
  }

  if (/^[a-zA-Z][\w-]*\(\d+\)$/.test(line)) {
    return false;
  }

  if (/[.:;!?]$/.test(line)) {
    return false;
  }

  const words = line.split(/\s+/);
  if (words.length === 0 || words.length > 6) {
    return false;
  }

  if (isUppercase && indentation <= 1) {
    return false;
  }

  const startsUppercaseCount = words.filter((word) =>
    /^[A-Z]/.test(word),
  ).length;
  if (!isUppercase && startsUppercaseCount === 0) {
    return false;
  }

  // Title-cased subsection headings should have a strong uppercase pattern.
  // This avoids promoting ordinary prose lines (often indented option text)
  // into subsection anchors.
  if (!isUppercase) {
    if (indentation > 1) {
      return false;
    }

    const startsUppercaseRatio = startsUppercaseCount / words.length;
    if (startsUppercaseRatio < 0.6) {
      return false;
    }

    const firstWord = words[0] ?? "";
    if (!/^[A-Z]/.test(firstWord)) {
      return false;
    }
  }

  const previous = lines[index - 1]?.trim() ?? "";
  const nextRawLine = lines[index + 1] ?? "";
  const next = nextRawLine.trim();
  const nextIndentation = getIndentation(nextRawLine);

  const hasWhitespaceBoundary = previous === "" || next === "";
  const hasIndentedBody = next !== "" && nextIndentation > indentation;

  return hasWhitespaceBoundary || hasIndentedBody;
}

export function parseSections(lines: string[]): SectionAnchor[] {
  if (lines.length === 0) {
    return [];
  }

  const headingIndexes: Array<{ index: number; title: string; level: 1 | 2 }> =
    [];
  for (let index = 0; index < lines.length; index += 1) {
    if (isLikelyTopLevelHeading(lines, index)) {
      headingIndexes.push({ index, title: lines[index].trim(), level: 1 });
    } else if (isLikelySubHeading(lines, index)) {
      headingIndexes.push({ index, title: lines[index].trim(), level: 2 });
    }
  }

  if (headingIndexes.length === 0) {
    return [
      {
        id: "document",
        title: "DOCUMENT",
        startLine: 0,
        endLine: Math.max(lines.length - 1, 0),
        level: 1,
      },
    ];
  }

  const normalizedHeadings: Array<{
    index: number;
    title: string;
    level: 1 | 2;
  }> = [];
  let seenTopLevel = false;

  headingIndexes.forEach((heading) => {
    if (heading.level === 1) {
      seenTopLevel = true;
      normalizedHeadings.push(heading);
      return;
    }

    if (seenTopLevel) {
      normalizedHeadings.push(heading);
    }
  });

  if (normalizedHeadings.length === 0) {
    return [
      {
        id: "document",
        title: "DOCUMENT",
        startLine: 0,
        endLine: Math.max(lines.length - 1, 0),
        level: 1,
      },
    ];
  }

  const idCounts = new Map<string, number>();

  const sectionAnchors: SectionAnchor[] = normalizedHeadings.map(
    ({ index, title, level }, position) => {
      const baseId = slugify(title) || `section-${position + 1}`;
      const seen = idCounts.get(baseId) ?? 0;
      idCounts.set(baseId, seen + 1);

      const id = seen === 0 ? baseId : `${baseId}-${seen + 1}`;
      return {
        id,
        title,
        startLine: index,
        endLine: Math.max(lines.length - 1, index),
        level,
      };
    },
  );

  sectionAnchors.forEach((section, position) => {
    if (section.level === 2) {
      for (
        let parentPosition = position - 1;
        parentPosition >= 0;
        parentPosition -= 1
      ) {
        if (sectionAnchors[parentPosition].level === 1) {
          section.parentId = sectionAnchors[parentPosition].id;
          break;
        }
      }
    }
  });

  sectionAnchors.forEach((section, position) => {
    let endLine = lines.length - 1;
    for (
      let nextPosition = position + 1;
      nextPosition < sectionAnchors.length;
      nextPosition += 1
    ) {
      if (sectionAnchors[nextPosition].level <= section.level) {
        endLine = sectionAnchors[nextPosition].startLine - 1;
        break;
      }
    }
    section.endLine = Math.max(section.startLine, endLine);
  });

  return sectionAnchors;
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
