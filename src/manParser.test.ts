import { describe, expect, it } from "vitest";
import {
  buildFilterLines,
  findMatches,
  parseSections,
  splitLines,
  tokenizeLine,
} from "./manParser";

const SAMPLE = `LS(1)\n\nNAME\n\nls - list directory contents\n\nSYNOPSIS\n\nls [OPTION]... [FILE]...\n\nOPTIONS\n\n-a, --all show hidden files\nPATH and MANPAGER may affect output\n`;

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
