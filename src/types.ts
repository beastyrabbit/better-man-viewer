export type ThemeMode = "dark" | "light";
export type SearchMode = "find" | "filter";

export interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized?: boolean;
}

export interface ViewerSettings {
  theme: ThemeMode;
  fontScale: number;
  minimapVisible: boolean;
  lastSearchMode: SearchMode;
  windowState: WindowState;
}

export interface ViewerSettingsPatch {
  theme?: ThemeMode;
  fontScale?: number;
  minimapVisible?: boolean;
  lastSearchMode?: SearchMode;
  windowState?: Partial<WindowState>;
}

export interface ManDocumentPayload {
  query: string;
  title: string;
  source: "system-man";
  rawText: string;
  fetchedAt: string;
}

export interface SectionAnchor {
  id: string;
  title: string;
  startLine: number;
  endLine: number;
}

export interface FindMatch {
  lineIndex: number;
  start: number;
  end: number;
  preview: string;
}

export interface FilterLine {
  lineIndex: number;
  text: string;
  matchCount: number;
}

export type TokenKind =
  | "plain"
  | "heading"
  | "option"
  | "path"
  | "env"
  | "literal"
  | "command";

export interface TokenSegment {
  text: string;
  kind: TokenKind;
}

export const DEFAULT_SETTINGS: ViewerSettings = {
  theme: "dark",
  fontScale: 1,
  minimapVisible: true,
  lastSearchMode: "find",
  windowState: {
    width: 1280,
    height: 820,
  },
};

export const MIN_FONT_SCALE = 0.75;
export const MAX_FONT_SCALE = 2.25;
