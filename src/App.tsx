import { ChevronDown, ChevronRight, Moon, Sun } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  getSettings,
  isTauriRuntime,
  loadManPage,
  setSettings as persistSettings,
  suggestAlias,
} from "./backend";
import {
  buildFilterLines,
  findMatches,
  parseSections,
  splitLines,
  tokenizeLine,
} from "./manParser";
import {
  DEFAULT_SETTINGS,
  MAX_FONT_SCALE,
  type ManDocumentPayload,
  MIN_FONT_SCALE,
  type SearchMode,
  type ViewerSettings,
} from "./types";

const BASE_FONT_SIZE_REM = 0.96;
const LOW_VALUE_SECTION_TITLES = new Set([
  "AUTHOR",
  "AUTHORS",
  "COPYRIGHT",
  "LICENSE",
  "LICENSES",
  "SEE ALSO",
  "COLOPHON",
]);

const DOCUMENT_FONT_FAMILY =
  '"Cascadia Mono", "Consolas", "Lucida Console", monospace';

const TOKEN_KIND_CLASS: Record<string, string> = {
  heading: "font-semibold text-foreground",
  option: "text-sky-600 dark:text-sky-400",
  env: "text-amber-700 dark:text-amber-300",
  path: "text-blue-700 dark:text-blue-300",
  literal: "text-violet-700 dark:text-violet-300",
  command: "text-emerald-700 dark:text-emerald-300",
  plain: "text-foreground",
};

const TAB_WIDTH = 8;
const MAX_WRAP_INDENT_COLUMNS = 40;

function clampFontScale(value: number): number {
  return Math.max(MIN_FONT_SCALE, Math.min(MAX_FONT_SCALE, value));
}

function areSetsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }

  return [...left].every((value) => right.has(value));
}

function normalizeSectionTitle(title: string): string {
  return title.trim().toUpperCase();
}

function countColumns(value: string): number {
  return [...value].reduce(
    (total, character) => total + (character === "\t" ? TAB_WIDTH : 1),
    0,
  );
}

function findHangingWrapStartColumns(line: string): number | null {
  const trimmed = line.trimStart();
  if (!/^[-+]/.test(trimmed)) {
    return null;
  }

  const separatorMatch = /\S([ \t]{2,})\S/.exec(line);
  if (!separatorMatch || separatorMatch.index === undefined) {
    return null;
  }

  const nextTokenCharIndex =
    separatorMatch.index + 1 + separatorMatch[1].length;
  return countColumns(line.slice(0, nextTokenCharIndex));
}

function splitLineIndent(line: string): {
  content: string;
  lineStartColumns: number;
  wrapStartColumns: number;
} {
  const leadingWhitespace = line.match(/^[\t ]+/)?.[0] ?? "";
  const lineStartColumns = countColumns(leadingWhitespace);
  const hangingWrapStart = findHangingWrapStartColumns(line);
  const wrapStartColumns = Math.min(
    Math.max(hangingWrapStart ?? lineStartColumns, lineStartColumns),
    MAX_WRAP_INDENT_COLUMNS,
  );

  return {
    content: line.slice(leadingWhitespace.length),
    lineStartColumns,
    wrapStartColumns,
  };
}

function highlightText(
  text: string,
  query: string,
  keyPrefix: string,
): ReactNode[] {
  const term = query.trim();
  if (!term) {
    return [text];
  }

  const lowerText = text.toLowerCase();
  const lowerTerm = term.toLowerCase();

  const result: ReactNode[] = [];
  let cursor = 0;
  let partIndex = 0;

  while (cursor < text.length) {
    const matchIndex = lowerText.indexOf(lowerTerm, cursor);
    if (matchIndex === -1) {
      result.push(
        <span key={`${keyPrefix}-tail-${partIndex}`}>
          {text.slice(cursor)}
        </span>,
      );
      break;
    }

    if (matchIndex > cursor) {
      result.push(
        <span key={`${keyPrefix}-plain-${partIndex}`}>
          {text.slice(cursor, matchIndex)}
        </span>,
      );
      partIndex += 1;
    }

    const matchEnd = matchIndex + term.length;
    result.push(
      <mark
        key={`${keyPrefix}-mark-${partIndex}`}
        className="rounded-sm bg-amber-300/65 px-0 text-inherit dark:bg-amber-400/35"
      >
        {text.slice(matchIndex, matchEnd)}
      </mark>,
    );
    partIndex += 1;
    cursor = matchEnd;
  }

  return result;
}

function mergeSettings(
  current: ViewerSettings,
  update: Partial<ViewerSettings>,
): ViewerSettings {
  return {
    ...current,
    ...update,
    windowState: {
      ...current.windowState,
      ...update.windowState,
    },
  };
}

function App() {
  const [settings, setSettings] = useState<ViewerSettings>(DEFAULT_SETTINGS);
  const [topicInput, setTopicInput] = useState("ls");
  const [documentData, setDocumentData] = useState<ManDocumentPayload | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState<SearchMode>(
    DEFAULT_SETTINGS.lastSearchMode,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [activeFilterIndex, setActiveFilterIndex] = useState(0);
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(
    new Set(),
  );
  const [aliasSnippet, setAliasSnippet] = useState<string | null>(null);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<Array<HTMLDivElement | null>>([]);
  const pendingAnchorRef = useRef<number | null>(null);
  const settingsInitializedRef = useRef(false);
  const lastAutoCollapsedDocumentRef = useRef<string | null>(null);

  const lines = useMemo(
    () => splitLines(documentData?.rawText ?? ""),
    [documentData],
  );
  const sections = useMemo(() => parseSections(lines), [lines]);

  const allMatches = useMemo(
    () => findMatches(lines, searchQuery),
    [lines, searchQuery],
  );
  const filterLines = useMemo(
    () => buildFilterLines(lines, allMatches),
    [lines, allMatches],
  );

  const firstMatchIndexByLine = useMemo(() => {
    const map = new Map<number, number>();
    allMatches.forEach((match, index) => {
      if (!map.has(match.lineIndex)) {
        map.set(match.lineIndex, index);
      }
    });
    return map;
  }, [allMatches]);

  const visibleSections = useMemo(() => {
    const hiddenTopLevelIds = new Set(
      sections
        .filter(
          (section) =>
            section.level === 1 &&
            LOW_VALUE_SECTION_TITLES.has(normalizeSectionTitle(section.title)),
        )
        .map((section) => section.id),
    );

    return sections.filter((section) => {
      if (section.level === 1) {
        return !hiddenTopLevelIds.has(section.id);
      }

      if (section.parentId && hiddenTopLevelIds.has(section.parentId)) {
        return false;
      }

      return true;
    });
  }, [sections]);

  const sectionChildrenByParentId = useMemo(() => {
    const map = new Map<string, number>();
    visibleSections.forEach((section) => {
      if (!section.parentId) {
        return;
      }

      map.set(section.parentId, (map.get(section.parentId) ?? 0) + 1);
    });
    return map;
  }, [visibleSections]);

  const renderedSections = useMemo(
    () =>
      visibleSections.filter((section) => {
        if (section.level === 1 || !section.parentId) {
          return true;
        }

        return !collapsedSectionIds.has(section.parentId);
      }),
    [collapsedSectionIds, visibleSections],
  );

  const documentFontSize = `${BASE_FONT_SIZE_REM * settings.fontScale}rem`;

  const activeMatch =
    allMatches[
      Math.min(activeMatchIndex, Math.max(allMatches.length - 1, 0))
    ] ?? null;

  const scrollToLine = useCallback(
    (lineIndex: number, behavior: "start" | "center" = "center") => {
      const viewport = viewportRef.current;
      const lineNode = lineRefs.current[lineIndex];
      if (!viewport || !lineNode) {
        return;
      }

      let nextScrollTop = lineNode.offsetTop;
      if (behavior === "center") {
        nextScrollTop -= (viewport.clientHeight - lineNode.offsetHeight) / 2;
      }

      const maxScroll = Math.max(
        viewport.scrollHeight - viewport.clientHeight,
        0,
      );
      viewport.scrollTop = Math.max(0, Math.min(nextScrollTop, maxScroll));
    },
    [],
  );

  const loadTopic = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setErrorMessage(
        "Enter a command or topic (for example: ls, printf, or 2 open).",
      );
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const payload = await loadManPage(trimmed);
      setDocumentData(payload);
      setTopicInput(payload.query);
      setSearchQuery("");
      setActiveMatchIndex(0);
      setActiveFilterIndex(0);
      pendingAnchorRef.current = 0;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load man page.";
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const saved = await getSettings();
        setSettings(saved);
        setSearchMode(saved.lastSearchMode);
      } catch {
        setSettings(DEFAULT_SETTINGS);
      } finally {
        settingsInitializedRef.current = true;
        await loadTopic("ls");
      }
    })();
  }, [loadTopic]);

  useEffect(() => {
    if (!settingsInitializedRef.current) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void persistSettings({
        ...settings,
        lastSearchMode: searchMode,
      });
    }, 180);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [searchMode, settings]);

  useEffect(() => {
    document.documentElement.classList.toggle(
      "dark",
      settings.theme === "dark",
    );
  }, [settings.theme]);

  useEffect(() => {
    setCollapsedSectionIds((current) => {
      const documentKey = documentData?.fetchedAt ?? null;
      const nextParentIds = new Set(sectionChildrenByParentId.keys());

      if (documentKey && lastAutoCollapsedDocumentRef.current !== documentKey) {
        lastAutoCollapsedDocumentRef.current = documentKey;
        return nextParentIds;
      }

      if (sectionChildrenByParentId.size === 0) {
        return current.size === 0 ? current : new Set();
      }

      const next = new Set(
        [...current].filter((sectionId) =>
          sectionChildrenByParentId.has(sectionId),
        ),
      );

      if (areSetsEqual(next, current)) {
        return current;
      }

      return next;
    });
  }, [documentData?.fetchedAt, sectionChildrenByParentId]);

  useEffect(() => {
    lineRefs.current = lineRefs.current.slice(0, lines.length);
  }, [lines.length]);

  useEffect(() => {
    const onResize = () => {
      setSettings((current) =>
        mergeSettings(current, {
          windowState: {
            width: window.innerWidth,
            height: window.innerHeight,
          },
        }),
      );
    };

    onResize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    if (pendingAnchorRef.current === null || lines.length === 0) {
      return;
    }

    if (searchMode === "filter" && searchQuery.trim() !== "") {
      return;
    }

    scrollToLine(pendingAnchorRef.current, "center");
    pendingAnchorRef.current = null;
  }, [lines.length, scrollToLine, searchMode, searchQuery]);

  useEffect(() => {
    if (searchMode !== "find" || searchQuery.trim() === "" || !activeMatch) {
      return;
    }

    scrollToLine(activeMatch.lineIndex, "center");
  }, [activeMatch, scrollToLine, searchMode, searchQuery]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const accelPressed = event.ctrlKey || event.metaKey;
      if (!accelPressed) {
        return;
      }

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setSettings((current) =>
          mergeSettings(current, {
            fontScale: clampFontScale(current.fontScale + 0.1),
          }),
        );
      }

      if (event.key === "-") {
        event.preventDefault();
        setSettings((current) =>
          mergeSettings(current, {
            fontScale: clampFontScale(current.fontScale - 0.1),
          }),
        );
      }

      if (event.key === "0") {
        event.preventDefault();
        setSettings((current) => mergeSettings(current, { fontScale: 1 }));
      }
    };

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, []);

  const toggleSectionCollapse = (sectionId: string) => {
    setCollapsedSectionIds((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void loadTopic(topicInput);
  };

  const changeSearchMode = (mode: SearchMode) => {
    if (
      searchMode === "filter" &&
      mode !== "filter" &&
      filterLines[activeFilterIndex]
    ) {
      pendingAnchorRef.current = filterLines[activeFilterIndex].lineIndex;
    }

    setActiveMatchIndex(0);
    setActiveFilterIndex(0);
    setSearchMode(mode);
    setSettings((current) => mergeSettings(current, { lastSearchMode: mode }));
  };

  const goToMatch = (direction: 1 | -1) => {
    if (allMatches.length === 0) {
      return;
    }

    setActiveMatchIndex(
      (current) =>
        (current + direction + allMatches.length) % allMatches.length,
    );
  };

  const handleSearchInputKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    if (searchMode === "find") {
      goToMatch(event.shiftKey ? -1 : 1);
      return;
    }

    const focusedFilterLine = filterLines[activeFilterIndex] ?? filterLines[0];
    if (focusedFilterLine) {
      const selectedIndex = filterLines.findIndex(
        (entry) => entry.lineIndex === focusedFilterLine.lineIndex,
      );
      selectFilterLine(
        focusedFilterLine.lineIndex,
        selectedIndex === -1 ? 0 : selectedIndex,
      );
    }
  };

  const clearSearch = () => {
    if (searchMode === "filter" && filterLines[activeFilterIndex]) {
      pendingAnchorRef.current = filterLines[activeFilterIndex].lineIndex;
      setSearchMode("find");
      setSettings((current) =>
        mergeSettings(current, { lastSearchMode: "find" }),
      );
    }

    setSearchQuery("");
  };

  const selectFilterLine = (lineIndex: number, filterIndex: number) => {
    setActiveFilterIndex(filterIndex);
    const matchIndex = firstMatchIndexByLine.get(lineIndex);
    if (matchIndex !== undefined) {
      setActiveMatchIndex(matchIndex);
    }
    pendingAnchorRef.current = lineIndex;
    setSearchMode("find");
    setSettings((current) =>
      mergeSettings(current, { lastSearchMode: "find" }),
    );
  };

  const activeMatchLine = activeMatch?.lineIndex;

  const visibleLines = Array.from(lines.entries()).map(
    ([lineIndex, sourceLine]) => {
      const {
        content: lineContent,
        lineStartColumns,
        wrapStartColumns,
      } = splitLineIndent(sourceLine);
      const tokens = tokenizeLine(lineContent);
      let tokenOffset = 0;
      const tokenSpans = tokens.map((token) => {
        const currentOffset = tokenOffset;
        tokenOffset += token.text.length;
        return { token, offset: currentOffset };
      });

      return (
        <div
          key={`line-${lineIndex}`}
          ref={(node) => {
            lineRefs.current[lineIndex] = node;
          }}
          className={cn(
            "px-3 py-0.5",
            searchMode === "find" &&
              searchQuery.trim() !== "" &&
              activeMatchLine === lineIndex
              ? "bg-accent/45"
              : "hover:bg-accent/20",
          )}
        >
          <span
            className="block whitespace-pre-wrap break-words [tab-size:8]"
            style={
              wrapStartColumns > 0 || lineStartColumns !== wrapStartColumns
                ? {
                    paddingInlineStart: `${wrapStartColumns}ch`,
                    textIndent: `${lineStartColumns - wrapStartColumns}ch`,
                  }
                : undefined
            }
          >
            {tokenSpans.map(({ token, offset }) => (
              <span
                key={`line-${lineIndex}-token-${offset}-${token.kind}-${token.text.length}`}
                className={
                  TOKEN_KIND_CLASS[token.kind] ?? TOKEN_KIND_CLASS.plain
                }
              >
                {highlightText(
                  token.text,
                  searchMode === "find" ? searchQuery : "",
                  `${lineIndex}-${offset}`,
                )}
              </span>
            ))}
          </span>
        </div>
      );
    },
  );

  const renderedFilterLines = filterLines.slice(0, 1200);

  return (
    <main className="h-screen w-screen bg-background text-foreground">
      <div className="flex h-full min-h-0 flex-col gap-3 p-3">
        <Card className="border-border/70 bg-card/95 shadow-sm">
          <CardContent className="space-y-3 p-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h1 className="text-base font-semibold tracking-tight">
                  Better Man Viewer
                </h1>
                <p className="text-xs text-muted-foreground">
                  {documentData?.title || "No page loaded"}
                  {isTauriRuntime() ? "" : " (browser fallback)"}
                </p>
              </div>

              <form
                className="flex w-full max-w-xl items-center gap-2"
                onSubmit={handleSubmit}
              >
                <Input
                  aria-label="Man topic"
                  value={topicInput}
                  onChange={(event) => setTopicInput(event.currentTarget.value)}
                  placeholder="Try: fzf, ls, printf, or 2 open"
                  className="font-mono"
                />
                <Button type="submit" size="sm" disabled={loading}>
                  {loading ? "Loading..." : "Open"}
                </Button>
              </form>
            </div>

            <Separator />

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-muted/40 p-1">
                <Button
                  type="button"
                  size="sm"
                  variant={searchMode === "find" ? "default" : "ghost"}
                  onClick={() => changeSearchMode("find")}
                  className="h-7"
                >
                  Find
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={searchMode === "filter" ? "default" : "ghost"}
                  onClick={() => changeSearchMode("filter")}
                  className="h-7"
                >
                  Filter
                </Button>
              </div>

              <Input
                aria-label="Search"
                value={searchQuery}
                onKeyDown={handleSearchInputKeyDown}
                onChange={(event) => {
                  setActiveMatchIndex(0);
                  setActiveFilterIndex(0);
                  setSearchQuery(event.currentTarget.value);
                }}
                placeholder={
                  searchMode === "find"
                    ? "Find text (Enter for next, Shift+Enter for previous)"
                    : "Filter matching lines"
                }
                className="min-w-[280px] flex-1 font-mono"
              />

              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => goToMatch(-1)}
                disabled={allMatches.length === 0}
              >
                Prev
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => goToMatch(1)}
                disabled={allMatches.length === 0}
              >
                Next
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={clearSearch}
                disabled={searchQuery.length === 0}
              >
                Clear
              </Button>

              <span className="w-16 text-center text-xs tabular-nums text-muted-foreground">
                {allMatches.length === 0
                  ? "0"
                  : `${Math.min(activeMatchIndex + 1, allMatches.length)}/${allMatches.length}`}
              </span>

              <Separator
                orientation="vertical"
                className="mx-1 hidden h-6 md:block"
              />

              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setSettings((current) =>
                    mergeSettings(current, {
                      fontScale: clampFontScale(current.fontScale - 0.1),
                    }),
                  )
                }
                aria-label="Zoom out"
              >
                A-
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setSettings((current) =>
                    mergeSettings(current, { fontScale: 1 }),
                  )
                }
              >
                Reset
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setSettings((current) =>
                    mergeSettings(current, {
                      fontScale: clampFontScale(current.fontScale + 0.1),
                    }),
                  )
                }
                aria-label="Zoom in"
              >
                A+
              </Button>

              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  setSettings((current) =>
                    mergeSettings(current, {
                      theme: current.theme === "dark" ? "light" : "dark",
                    }),
                  )
                }
                className="gap-2"
              >
                {settings.theme === "dark" ? (
                  <Sun className="size-4" />
                ) : (
                  <Moon className="size-4" />
                )}
                {settings.theme === "dark" ? "Light" : "Dark"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  void suggestAlias("zsh").then((snippet) =>
                    setAliasSnippet(snippet),
                  );
                }}
              >
                Alias
              </Button>
            </div>
          </CardContent>
        </Card>

        {aliasSnippet ? (
          <Card className="border-border/70 bg-card/95 shadow-sm">
            <CardContent className="flex flex-col gap-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Optional shell override</p>
                  <p className="text-xs text-muted-foreground">
                    Use this after validation if you want `man` to open this
                    app.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setAliasSnippet(null)}
                >
                  Close
                </Button>
              </div>
              <pre className="overflow-x-auto rounded-md border border-border/70 bg-muted/40 p-2 text-xs">
                {aliasSnippet}
              </pre>
            </CardContent>
          </Card>
        ) : null}

        {errorMessage ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorMessage}
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(280px,32vw)_minmax(0,1fr)] xl:grid-cols-[minmax(320px,30vw)_minmax(0,1fr)]">
          <Card className="min-h-0 border-border/70 bg-card/95 shadow-sm">
            <CardContent className="flex h-full min-h-0 flex-col p-0">
              <div className="border-b border-border/70 px-3 py-2">
                <h2 className="text-xs font-semibold tracking-[0.18em] text-muted-foreground">
                  Sections
                </h2>
              </div>

              {visibleSections.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">
                  No sections detected.
                </p>
              ) : (
                <ScrollArea className="h-full px-2 py-2">
                  <ul className="space-y-1" aria-label="Sections">
                    {renderedSections.map((section) => {
                      const hasChildren =
                        (sectionChildrenByParentId.get(section.id) ?? 0) > 0;
                      const collapsed = collapsedSectionIds.has(section.id);

                      return (
                        <li key={section.id}>
                          <div
                            className={cn(
                              "grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-1 rounded-md",
                              section.level === 2 &&
                                "ml-3 border-l border-border/55 pl-3",
                            )}
                          >
                            {hasChildren ? (
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleSectionCollapse(section.id);
                                }}
                                aria-label={
                                  collapsed
                                    ? `Expand ${section.title}`
                                    : `Collapse ${section.title}`
                                }
                                className="size-5 text-muted-foreground"
                              >
                                {collapsed ? (
                                  <ChevronRight className="size-3" />
                                ) : (
                                  <ChevronDown className="size-3" />
                                )}
                              </Button>
                            ) : (
                              <span className="block size-5" />
                            )}

                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                scrollToLine(section.startLine, "start")
                              }
                              className={cn(
                                "h-8 justify-start px-2",
                                section.level === 1
                                  ? "text-sm font-semibold"
                                  : "text-sm text-muted-foreground",
                              )}
                            >
                              {section.title}
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          <Card className="min-h-0 border-border/70 bg-card/95 shadow-sm">
            <CardContent className="h-full min-h-0 p-0">
              {searchMode === "filter" && searchQuery.trim() !== "" ? (
                <ScrollArea className="h-full px-2 py-2">
                  <div
                    role="listbox"
                    aria-label="Filtered lines"
                    className="grid gap-1"
                    style={{
                      fontSize: documentFontSize,
                      fontFamily: DOCUMENT_FONT_FAMILY,
                    }}
                  >
                    {renderedFilterLines.length === 0 ? (
                      <p className="px-2 py-1 text-sm text-muted-foreground">
                        No lines match this filter.
                      </p>
                    ) : (
                      renderedFilterLines.map((entry, index) => {
                        const selected = index === activeFilterIndex;
                        const {
                          content: lineContent,
                          lineStartColumns,
                          wrapStartColumns,
                        } = splitLineIndent(entry.text || "");
                        return (
                          <button
                            type="button"
                            key={`filter-${entry.lineIndex}`}
                            className={cn(
                              "w-full rounded-md border border-border/60 px-2 py-1 text-left hover:bg-accent/40",
                              selected && "border-primary/45 bg-accent/55",
                            )}
                            onClick={() =>
                              selectFilterLine(entry.lineIndex, index)
                            }
                          >
                            <span
                              className="block whitespace-pre-wrap break-words [tab-size:8]"
                              style={
                                wrapStartColumns > 0 ||
                                lineStartColumns !== wrapStartColumns
                                  ? {
                                      paddingInlineStart: `${wrapStartColumns}ch`,
                                      textIndent: `${lineStartColumns - wrapStartColumns}ch`,
                                    }
                                  : undefined
                              }
                            >
                              {highlightText(
                                lineContent || "(blank line)",
                                searchQuery,
                                `filter-${index}`,
                              )}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </ScrollArea>
              ) : (
                <div
                  ref={viewportRef}
                  className="h-full overflow-y-auto overflow-x-hidden"
                  style={{
                    fontSize: documentFontSize,
                    fontFamily: DOCUMENT_FONT_FAMILY,
                  }}
                >
                  <div className="pb-2">{visibleLines}</div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}

export default App;
