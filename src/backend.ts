import { invoke } from "@tauri-apps/api/core";
import { createMockManpage } from "./mockManpage";
import {
  DEFAULT_SETTINGS,
  MAX_FONT_SCALE,
  MIN_FONT_SCALE,
  type ManDocumentPayload,
  type ViewerSettings,
  type ViewerSettingsPatch,
} from "./types";

const STORAGE_KEY = "better-man-viewer-settings";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
}

function sanitizeSettings(input: Partial<ViewerSettings>): ViewerSettings {
  const merged: ViewerSettings = {
    ...DEFAULT_SETTINGS,
    ...input,
    windowState: {
      ...DEFAULT_SETTINGS.windowState,
      ...input.windowState,
    },
  };

  return {
    ...merged,
    fontScale: Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, merged.fontScale)),
    lastSearchMode: merged.lastSearchMode === "filter" ? "filter" : "find",
    theme: merged.theme === "light" ? "light" : "dark",
  };
}

function mergeSettings(base: ViewerSettings, patch: ViewerSettingsPatch): ViewerSettings {
  return sanitizeSettings({
    ...base,
    ...patch,
    windowState: {
      ...base.windowState,
      ...patch.windowState,
    },
  });
}

function getBrowserSettings(): ViewerSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }

    const parsed = JSON.parse(raw) as Partial<ViewerSettings>;
    return sanitizeSettings(parsed);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function setBrowserSettings(next: ViewerSettings): ViewerSettings {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore private browsing/storage failures
  }
  return next;
}

export async function getSettings(): Promise<ViewerSettings> {
  if (!isTauriRuntime()) {
    return getBrowserSettings();
  }

  const settings = await invoke<ViewerSettings>("get_settings");
  return sanitizeSettings(settings);
}

export async function setSettings(patch: ViewerSettingsPatch): Promise<ViewerSettings> {
  if (!isTauriRuntime()) {
    const current = getBrowserSettings();
    return setBrowserSettings(mergeSettings(current, patch));
  }

  const settings = await invoke<ViewerSettings>("set_settings", { patch });
  return sanitizeSettings(settings);
}

export async function loadManPage(input: string): Promise<ManDocumentPayload> {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Enter a man topic or section first.");
  }

  if (!isTauriRuntime()) {
    return createMockManpage(trimmed);
  }

  return invoke<ManDocumentPayload>("load_man_page", { input: trimmed });
}

export async function suggestAlias(shell: "zsh" | "bash" | "fish"): Promise<string> {
  if (!isTauriRuntime()) {
    return shell === "fish"
      ? "function man\n  better-man-viewer $argv\nend"
      : 'man() { better-man-viewer "$@"; }';
  }

  return invoke<string>("suggest_alias", { shell });
}
