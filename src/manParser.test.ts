import { describe, expect, it } from "vitest";
import {
  buildFilterLines,
  findMatches,
  parseSections,
  splitLines,
  tokenizeLine,
} from "./manParser";

const SAMPLE = `LS(1)\n\nNAME\n\nls - list directory contents\n\nSYNOPSIS\n\nls [OPTION]... [FILE]...\n\nOPTIONS\n\n-a, --all show hidden files\nPATH and MANPAGER may affect output\n`;
const SAMPLE_WITH_SUBSECTIONS = `FZF(1)\n\nNAME\n\nfzf - command-line fuzzy finder\n\nOPTIONS\n\nSearch\n\nSearch controls and matching behavior.\n\nPreview\n\nPreview window options.\n\nAUTHOR\n\nMaintainers.\n`;
const SAMPLE_WITH_INDENTED_SUBSECTIONS = `FZF(1)\n\nNAME\n\nfzf - a command-line fuzzy finder\n\nOPTIONS\n   NOTE\n       Most long options have the opposite version with --no- prefix.\n\n   SEARCH\n       -x, --extended\n\n   INPUT/OUTPUT\n       --read0\n\nAUTHOR\n\nMaintainers.\n`;
const SAMPLE_WITH_OPTION_PROSE = `LS(1)\n\nOPTIONS\n\n   -b, --escape\n          print C-style escapes for nongraphic characters\n\n   -q, --hide-control-chars\n          print ? instead of nongraphic characters\n`;

describe("splitLines", () => {
  it("normalizes line endings and removes trailing empty line", () => {
    const lines = splitLines("a\r\nb\n");
    expect(lines).toEqual(["a", "b"]);
  });
});

describe("parseSections", () => {
  it("finds uppercase sections", () => {
    const sections = parseSections(splitLines(SAMPLE));
    const titles = sections.map((section) => section.title);
    expect(titles).toContain("NAME");
    expect(titles).toContain("SYNOPSIS");
    expect(titles).toContain("OPTIONS");
  });

  it("detects subsection hierarchy under top-level sections", () => {
    const sections = parseSections(splitLines(SAMPLE_WITH_SUBSECTIONS));

    const optionsSection = sections.find(
      (section) => section.title === "OPTIONS",
    );
    const searchSection = sections.find(
      (section) => section.title === "Search",
    );
    const previewSection = sections.find(
      (section) => section.title === "Preview",
    );

    expect(sections.some((section) => section.title === "FZF(1)")).toBe(false);
    expect(optionsSection?.level).toBe(1);
    expect(searchSection?.level).toBe(2);
    expect(previewSection?.level).toBe(2);
    expect(searchSection?.parentId).toBe(optionsSection?.id);
    expect(previewSection?.parentId).toBe(optionsSection?.id);
  });

  it("detects indented uppercase subsections under options", () => {
    const sections = parseSections(
      splitLines(SAMPLE_WITH_INDENTED_SUBSECTIONS),
    );

    const optionsSection = sections.find(
      (section) => section.title === "OPTIONS",
    );
    const noteSection = sections.find((section) => section.title === "NOTE");
    const searchSection = sections.find(
      (section) => section.title === "SEARCH",
    );
    const ioSection = sections.find(
      (section) => section.title === "INPUT/OUTPUT",
    );

    expect(noteSection?.level).toBe(2);
    expect(searchSection?.level).toBe(2);
    expect(ioSection?.level).toBe(2);
    expect(noteSection?.parentId).toBe(optionsSection?.id);
    expect(searchSection?.parentId).toBe(optionsSection?.id);
    expect(ioSection?.parentId).toBe(optionsSection?.id);
  });

  it("does not promote option prose lines to subsection headings", () => {
    const sections = parseSections(splitLines(SAMPLE_WITH_OPTION_PROSE));
    const subsectionTitles = sections
      .filter((section) => section.level === 2)
      .map((section) => section.title);

    expect(subsectionTitles).toEqual([]);
  });
});

describe("findMatches + buildFilterLines", () => {
  it("indexes every match and emits unique filter lines", () => {
    const lines = splitLines(SAMPLE);
    const matches = findMatches(lines, "ls");
    const filterLines = buildFilterLines(lines, matches);

    expect(matches.length).toBeGreaterThan(1);
    expect(filterLines.every((entry) => entry.matchCount > 0)).toBe(true);
  });
});

describe("tokenizeLine", () => {
  it("classifies option, env, and path tokens", () => {
    const tokens = tokenizeLine("-a uses PATH and /usr/share/man for output");
    const kinds = tokens.map((token) => token.kind);

    expect(kinds).toContain("option");
    expect(kinds).toContain("env");
    expect(kinds).toContain("path");
  });
});
