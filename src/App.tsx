import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  getSettings,
  isTauriRuntime,
  loadManPage,
  setSettings as persistSettings,
  suggestAlias,
} from "./backend";
import { buildFilterLines, findMatches, parseSections, splitLines, tokenizeLine } from "./manParser";
import {
  DEFAULT_SETTINGS,
  MAX_FONT_SCALE,
  MIN_FONT_SCALE,
  type ManDocumentPayload,
  type SearchMode,
  type ViewerSettings,
} from "./types";
import "./App.css";

const BASE_LINE_HEIGHT = 22;
const OVERSCAN_LINES = 10;

function clampFontScale(value: number): number {
  return Math.max(MIN_FONT_SCALE, Math.min(MAX_FONT_SCALE, value));
}

function highlightText(text: string, query: string, keyPrefix: string): ReactNode[] {
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
      result.push(<span key={`${keyPrefix}-tail-${partIndex}`}>{text.slice(cursor)}</span>);
      break;
    }

    if (matchIndex > cursor) {
      result.push(<span key={`${keyPrefix}-plain-${partIndex}`}>{text.slice(cursor, matchIndex)}</span>);
      partIndex += 1;
    }

    const matchEnd = matchIndex + term.length;
    result.push(<mark key={`${keyPrefix}-mark-${partIndex}`}>{text.slice(matchIndex, matchEnd)}</mark>);
    partIndex += 1;
    cursor = matchEnd;
  }

  return result;
}

function mergeSettings(current: ViewerSettings, update: Partial<ViewerSettings>): ViewerSettings {
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
  const [documentData, setDocumentData] = useState<ManDocumentPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState<SearchMode>(DEFAULT_SETTINGS.lastSearchMode);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [activeFilterIndex, setActiveFilterIndex] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [aliasSnippet, setAliasSnippet] = useState<string | null>(null);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const minimapDraggingRef = useRef(false);
  const pendingAnchorRef = useRef<number | null>(null);
  const settingsInitializedRef = useRef(false);

  const lines = useMemo(() => splitLines(documentData?.rawText ?? ""), [documentData]);
  const sections = useMemo(() => parseSections(lines), [lines]);

  const allMatches = useMemo(() => findMatches(lines, searchQuery), [lines, searchQuery]);
  const filterLines = useMemo(() => buildFilterLines(lines, allMatches), [lines, allMatches]);

  const firstMatchIndexByLine = useMemo(() => {
    const map = new Map<number, number>();
    allMatches.forEach((match, index) => {
      if (!map.has(match.lineIndex)) {
        map.set(match.lineIndex, index);
      }
    });
    return map;
  }, [allMatches]);

  const lineHeight = Math.round(BASE_LINE_HEIGHT * settings.fontScale);
  const totalHeight = lines.length * lineHeight;

  const startLine = Math.max(0, Math.floor(scrollTop / lineHeight) - OVERSCAN_LINES);
  const endLine = Math.min(lines.length, Math.ceil((scrollTop + viewportHeight) / lineHeight) + OVERSCAN_LINES);

  const activeMatch = allMatches[Math.min(activeMatchIndex, Math.max(allMatches.length - 1, 0))] ?? null;

  const viewportLines = viewportHeight > 0 ? viewportHeight / lineHeight : 0;
  const longDocument = lines.length > Math.max(60, viewportLines * 1.5);
  const minimapEnabled = settings.minimapVisible && longDocument;

  const scrollToLine = useCallback(
    (lineIndex: number, behavior: "start" | "center" = "center") => {
      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }

      let nextScrollTop = lineIndex * lineHeight;
      if (behavior === "center") {
        nextScrollTop -= viewport.clientHeight / 2;
      }

      const maxScroll = Math.max(totalHeight - viewport.clientHeight, 0);
      viewport.scrollTop = Math.max(0, Math.min(nextScrollTop, maxScroll));
    },
    [lineHeight, totalHeight],
  );

  const loadTopic = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) {
        setErrorMessage("Enter a command or topic (for example: ls, printf, or 2 open).");
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
        const message = error instanceof Error ? error.message : "Unable to load man page.";
        setErrorMessage(message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

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
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      setViewportHeight(viewport.clientHeight);
    });

    resizeObserver.observe(viewport);
    setViewportHeight(viewport.clientHeight);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

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

    // Keep selected filter line anchored when filter view collapses back into full document mode.
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
    setActiveMatchIndex(0);
    setActiveFilterIndex(0);
  }, [searchMode, searchQuery]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const accelPressed = event.ctrlKey || event.metaKey;
      if (!accelPressed) {
        return;
      }

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setSettings((current) => mergeSettings(current, { fontScale: clampFontScale(current.fontScale + 0.1) }));
      }

      if (event.key === "-") {
        event.preventDefault();
        setSettings((current) => mergeSettings(current, { fontScale: clampFontScale(current.fontScale - 0.1) }));
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

  const headingLines = useMemo(() => new Set(sections.map((section) => section.startLine)), [sections]);
  const matchLines = useMemo(() => new Set(filterLines.map((entry) => entry.lineIndex)), [filterLines]);

  useEffect(() => {
    if (!minimapEnabled) {
      return;
    }

    const canvas = minimapRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const pixelRatio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    canvas.width = Math.floor(width * pixelRatio);
    canvas.height = Math.floor(height * pixelRatio);

    context.resetTransform();
    context.scale(pixelRatio, pixelRatio);
    context.clearRect(0, 0, width, height);

    context.fillStyle = settings.theme === "dark" ? "#0b121d" : "#e8edf4";
    context.fillRect(0, 0, width, height);

    if (lines.length === 0) {
      return;
    }

    const step = Math.max(1, Math.floor(lines.length / Math.max(height, 1)));

    for (let index = 0; index < lines.length; index += step) {
      const y = (index / lines.length) * height;
      const blockHeight = Math.max(1, (step / lines.length) * height);

      if (headingLines.has(index)) {
        context.fillStyle = settings.theme === "dark" ? "rgba(138, 184, 255, 0.85)" : "rgba(42, 88, 160, 0.72)";
      } else if (matchLines.has(index)) {
        context.fillStyle = settings.theme === "dark" ? "rgba(255, 205, 80, 0.65)" : "rgba(182, 126, 20, 0.65)";
      } else {
        const line = lines[index];
        const density = Math.min(1, line.trim().length / 66);
        const opacity = 0.08 + density * 0.2;
        context.fillStyle = settings.theme === "dark" ? `rgba(170, 194, 220, ${opacity})` : `rgba(74, 92, 118, ${opacity})`;
      }

      context.fillRect(0, y, width, blockHeight);
    }

    const viewportTop = (scrollTop / Math.max(totalHeight, 1)) * height;
    const viewportBlockHeight = Math.max(20, (viewportHeight / Math.max(totalHeight, 1)) * height);

    context.fillStyle = settings.theme === "dark" ? "rgba(79, 130, 218, 0.2)" : "rgba(45, 87, 170, 0.24)";
    context.fillRect(1, viewportTop, width - 2, viewportBlockHeight);

    context.strokeStyle = settings.theme === "dark" ? "rgba(119, 173, 255, 0.9)" : "rgba(29, 69, 135, 0.9)";
    context.lineWidth = 1.5;
    context.strokeRect(1, viewportTop, width - 2, viewportBlockHeight);
  }, [
    headingLines,
    lines,
    longDocument,
    matchLines,
    minimapEnabled,
    scrollTop,
    settings.theme,
    totalHeight,
    viewportHeight,
  ]);

  const scrollFromMinimapPointer = useCallback(
    (clientY: number) => {
      const canvas = minimapRef.current;
      const viewport = viewportRef.current;
      if (!canvas || !viewport) {
        return;
      }

      const bounds = canvas.getBoundingClientRect();
      const relativeY = Math.max(0, Math.min(clientY - bounds.top, bounds.height));
      const ratio = relativeY / Math.max(bounds.height, 1);

      const nextScrollTop = ratio * totalHeight - viewport.clientHeight / 2;
      const maxScroll = Math.max(totalHeight - viewport.clientHeight, 0);
      viewport.scrollTop = Math.max(0, Math.min(nextScrollTop, maxScroll));
    },
    [totalHeight],
  );

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!minimapDraggingRef.current) {
        return;
      }

      scrollFromMinimapPointer(event.clientY);
    };

    const onMouseUp = () => {
      minimapDraggingRef.current = false;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [scrollFromMinimapPointer]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void loadTopic(topicInput);
  };

  const changeSearchMode = (mode: SearchMode) => {
    if (searchMode === "filter" && mode !== "filter" && filterLines[activeFilterIndex]) {
      pendingAnchorRef.current = filterLines[activeFilterIndex].lineIndex;
    }

    setSearchMode(mode);
    setSettings((current) => mergeSettings(current, { lastSearchMode: mode }));
  };

  const goToMatch = (direction: 1 | -1) => {
    if (allMatches.length === 0) {
      return;
    }

    setActiveMatchIndex((current) => {
      const next = (current + direction + allMatches.length) % allMatches.length;
      return next;
    });
  };

  const clearSearch = () => {
    if (searchMode === "filter" && filterLines[activeFilterIndex]) {
      pendingAnchorRef.current = filterLines[activeFilterIndex].lineIndex;
    }

    setSearchQuery("");
  };

  const selectFilterLine = (lineIndex: number, filterIndex: number) => {
    setActiveFilterIndex(filterIndex);
    pendingAnchorRef.current = lineIndex;
    scrollToLine(lineIndex, "center");
  };

  const activeMatchLine = activeMatch?.lineIndex;

  const visibleLines = [];
  for (let index = startLine; index < endLine; index += 1) {
    const sourceLine = lines[index] ?? "";
    const tokens = tokenizeLine(sourceLine);
    const lineClasses = ["doc-line"];

    if (activeMatchLine === index && searchMode === "find" && searchQuery.trim() !== "") {
      lineClasses.push("doc-line-active");
    }

    visibleLines.push(
      <div
        key={`line-${index}`}
        className={lineClasses.join(" ")}
        style={{
          top: index * lineHeight,
          height: lineHeight,
          lineHeight: `${lineHeight}px`,
        }}
      >
        <span className="line-number">{index + 1}</span>
        <span className="line-text">
          {tokens.map((token, tokenIndex) => (
            <span key={`line-${index}-token-${tokenIndex}`} className={`token token-${token.kind}`}>
              {highlightText(token.text, searchMode === "find" ? searchQuery : "", `${index}-${tokenIndex}`)}
            </span>
          ))}
        </span>
      </div>,
    );
  }

  const renderedFilterLines = filterLines.slice(0, 1200);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="title-group">
          <h1>Better Man Viewer</h1>
          <p>
            {documentData?.title || "No page loaded"}
            {isTauriRuntime() ? "" : " (browser fallback)"}
          </p>
        </div>

        <form className="command-form" onSubmit={handleSubmit}>
          <input
            aria-label="Man topic"
            value={topicInput}
            onChange={(event) => setTopicInput(event.currentTarget.value)}
            placeholder="Try: ls, printf, or 2 open"
          />
          <button type="submit" disabled={loading}>
            {loading ? "Loading..." : "Open"}
          </button>
        </form>

        <div className="toolbar">
          <div className="segmented" role="group" aria-label="Search mode">
            <button
              type="button"
              className={searchMode === "find" ? "active" : ""}
              onClick={() => changeSearchMode("find")}
            >
              Find
            </button>
            <button
              type="button"
              className={searchMode === "filter" ? "active" : ""}
              onClick={() => changeSearchMode("filter")}
            >
              Filter
            </button>
          </div>

          <div className="search-controls">
            <input
              aria-label="Search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              placeholder={searchMode === "find" ? "Find text..." : "Filter matching lines..."}
            />
            <button type="button" onClick={() => goToMatch(-1)} disabled={allMatches.length === 0}>
              Prev
            </button>
            <button type="button" onClick={() => goToMatch(1)} disabled={allMatches.length === 0}>
              Next
            </button>
            <button type="button" onClick={clearSearch} disabled={searchQuery.length === 0}>
              Clear
            </button>
            <span className="match-counter">
              {allMatches.length === 0
                ? "0"
                : `${Math.min(activeMatchIndex + 1, allMatches.length)}/${allMatches.length}`}
            </span>
          </div>

          <div className="zoom-controls">
            <button
              type="button"
              onClick={() =>
                setSettings((current) => mergeSettings(current, { fontScale: clampFontScale(current.fontScale - 0.1) }))
              }
              aria-label="Zoom out"
            >
              A-
            </button>
            <button type="button" onClick={() => setSettings((current) => mergeSettings(current, { fontScale: 1 }))}>
              Reset
            </button>
            <button
              type="button"
              onClick={() =>
                setSettings((current) => mergeSettings(current, { fontScale: clampFontScale(current.fontScale + 0.1) }))
              }
              aria-label="Zoom in"
            >
              A+
            </button>
          </div>

          <div className="misc-controls">
            <button
              type="button"
              onClick={() =>
                setSettings((current) =>
                  mergeSettings(current, {
                    theme: current.theme === "dark" ? "light" : "dark",
                  }),
                )
              }
            >
              {settings.theme === "dark" ? "Light" : "Dark"}
            </button>
            <button
              type="button"
              onClick={() =>
                setSettings((current) =>
                  mergeSettings(current, {
                    minimapVisible: !current.minimapVisible,
                  }),
                )
              }
            >
              {settings.minimapVisible ? "Hide Minimap" : "Show Minimap"}
            </button>
            <button
              type="button"
              onClick={() => {
                void suggestAlias("zsh").then((snippet) => setAliasSnippet(snippet));
              }}
            >
              Alias
            </button>
          </div>
        </div>
      </header>

      {aliasSnippet ? (
        <section className="alias-panel">
          <div>
            <strong>Optional shell override</strong>
            <p>Use this after validation if you want `man` to open this app.</p>
          </div>
          <pre>{aliasSnippet}</pre>
          <button type="button" onClick={() => setAliasSnippet(null)}>
            Close
          </button>
        </section>
      ) : null}

      {errorMessage ? <section className="error-banner">{errorMessage}</section> : null}

      <section className="workspace">
        <aside className="left-pane">
          <div className="panel-section">
            <h2>Sections</h2>
            {sections.length === 0 ? <p className="muted">No sections detected.</p> : null}
            <ul>
              {sections.map((section) => (
                <li key={section.id}>
                  <button
                    type="button"
                    onClick={() => {
                      scrollToLine(section.startLine, "start");
                    }}
                  >
                    {section.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel-section">
            <h2>Matches</h2>
            {searchQuery.trim() === "" ? <p className="muted">Type in search to build quick jumps.</p> : null}
            {searchQuery.trim() !== "" && filterLines.length === 0 ? <p className="muted">No matching lines.</p> : null}

            <ul>
              {filterLines.slice(0, 300).map((entry) => (
                <li key={`jump-${entry.lineIndex}`}>
                  <button
                    type="button"
                    onClick={() => {
                      if (searchMode === "find") {
                        const matchIndex = firstMatchIndexByLine.get(entry.lineIndex) ?? 0;
                        setActiveMatchIndex(matchIndex);
                      }
                      scrollToLine(entry.lineIndex, "center");
                    }}
                  >
                    <span className="line-pill">L{entry.lineIndex + 1}</span>
                    <span className="line-snippet">{entry.text.trim() || "(blank line)"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <div className="center-pane">
          {searchMode === "filter" && searchQuery.trim() !== "" ? (
            <div className="filter-pane" role="listbox" aria-label="Filtered lines">
              {renderedFilterLines.length === 0 ? (
                <p className="muted">No lines match this filter.</p>
              ) : (
                renderedFilterLines.map((entry, index) => {
                  const selected = index === activeFilterIndex;
                  return (
                    <button
                      type="button"
                      key={`filter-${entry.lineIndex}`}
                      className={selected ? "filter-line selected" : "filter-line"}
                      onClick={() => selectFilterLine(entry.lineIndex, index)}
                    >
                      <span className="line-pill">L{entry.lineIndex + 1}</span>
                      <span className="line-snippet">
                        {highlightText(entry.text || "(blank line)", searchQuery, `filter-${index}`)}
                      </span>
                      <span className="line-pill">{entry.matchCount}x</span>
                    </button>
                  );
                })
              )}
            </div>
          ) : (
            <div
              ref={viewportRef}
              className={minimapEnabled ? "doc-scroll hide-scrollbar" : "doc-scroll"}
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            >
              <div className="doc-inner" style={{ height: `${totalHeight}px` }}>
                {visibleLines}
              </div>
            </div>
          )}
        </div>

        <aside className="right-pane">
          {minimapEnabled ? (
            <canvas
              ref={minimapRef}
              className="minimap"
              onMouseDown={(event) => {
                minimapDraggingRef.current = true;
                scrollFromMinimapPointer(event.clientY);
              }}
            />
          ) : (
            <div className="minimap-disabled">
              <strong>Scroll Mode</strong>
              <p>{longDocument ? "Minimap hidden" : "Native scrollbar"}</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

export default App;
