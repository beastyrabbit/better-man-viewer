use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManDocumentPayload {
    query: String,
    title: String,
    source: String,
    raw_text: String,
    fetched_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowState {
    width: f64,
    height: f64,
    x: Option<f64>,
    y: Option<f64>,
    maximized: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ViewerSettings {
    theme: String,
    font_scale: f64,
    minimap_visible: bool,
    last_search_mode: String,
    window_state: WindowState,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowStatePatch {
    width: Option<f64>,
    height: Option<f64>,
    x: Option<f64>,
    y: Option<f64>,
    maximized: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ViewerSettingsPatch {
    theme: Option<String>,
    font_scale: Option<f64>,
    minimap_visible: Option<bool>,
    last_search_mode: Option<String>,
    window_state: Option<WindowStatePatch>,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            width: 1280.0,
            height: 820.0,
            x: None,
            y: None,
            maximized: None,
        }
    }
}

impl Default for ViewerSettings {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            font_scale: 1.0,
            minimap_visible: true,
            last_search_mode: "find".to_string(),
            window_state: WindowState::default(),
        }
    }
}

#[tauri::command]
fn load_man_page(input: String) -> Result<ManDocumentPayload, String> {
    let (section, topic) = parse_man_input(&input)?;
    let raw_text = run_man_command(section.as_deref(), &topic)?;

    if raw_text.trim().is_empty() {
        return Err("The man command returned no content.".to_string());
    }

    Ok(ManDocumentPayload {
        query: if let Some(section) = section {
            format!("{section} {topic}")
        } else {
            topic.clone()
        },
        title: extract_title(&raw_text, &topic),
        source: "system-man".to_string(),
        raw_text,
        fetched_at: current_timestamp(),
    })
}

#[tauri::command]
fn get_settings(app: AppHandle) -> Result<ViewerSettings, String> {
    read_settings(&app)
}

#[tauri::command]
fn set_settings(app: AppHandle, patch: ViewerSettingsPatch) -> Result<ViewerSettings, String> {
    let mut settings = read_settings(&app)?;
    merge_settings(&mut settings, patch);
    write_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
fn suggest_alias(shell: String) -> Result<String, String> {
    match shell.as_str() {
        "zsh" | "bash" => Ok(
            "man() {\n  better-man-viewer \"$@\"\n}\n# Bypass wrapper with: command man <topic>"
                .to_string(),
        ),
        "fish" => Ok(
            "function man\n  better-man-viewer $argv\nend\n# Bypass wrapper with: command man <topic>"
                .to_string(),
        ),
        _ => Err("Unsupported shell. Use zsh, bash, or fish.".to_string()),
    }
}

fn current_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn parse_man_input(input: &str) -> Result<(Option<String>, String), String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Please provide a man topic (for example: ls or 2 open).".to_string());
    }

    let normalized = trimmed.strip_prefix("man ").unwrap_or(trimmed).trim();
    let parts: Vec<&str> = normalized.split_whitespace().collect();

    if parts.is_empty() {
        return Err("Please provide a man topic.".to_string());
    }

    if parts.len() >= 2 && is_section_token(parts[0]) {
        let topic = parts[1..].join(" ");
        return Ok((Some(parts[0].to_string()), topic));
    }

    Ok((None, parts.join(" ")))
}

fn is_section_token(token: &str) -> bool {
    !token.is_empty()
        && token
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '.')
}

fn run_man_command(section: Option<&str>, topic: &str) -> Result<String, String> {
    let mut command = Command::new("man");

    if let Some(section) = section {
        command.arg(section);
    }

    command
        .arg(topic)
        .env("MANPAGER", "cat")
        .env("PAGER", "cat")
        .env("MANWIDTH", "120");

    let output = command
        .output()
        .map_err(|error| format!("Failed to run man command: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Err(format!("No manual entry found for `{topic}`."));
        }
        return Err(stderr);
    }

    let normalized = normalize_output_with_col(&output.stdout)
        .unwrap_or_else(|_| String::from_utf8_lossy(&output.stdout).replace('\u{8}', ""));

    Ok(normalized)
}

fn normalize_output_with_col(stdout: &[u8]) -> Result<String, String> {
    let mut child = Command::new("col")
        .arg("-bx")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start col command: {error}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(stdout)
            .map_err(|error| format!("Failed to write man output to col: {error}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("Failed waiting on col command: {error}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).replace('\u{8}', ""))
}

fn extract_title(raw_text: &str, topic: &str) -> String {
    raw_text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.to_string())
        .unwrap_or_else(|| topic.to_uppercase())
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Failed to resolve config directory: {error}"))?;

    fs::create_dir_all(&config_dir)
        .map_err(|error| format!("Failed to create config directory: {error}"))?;

    Ok(config_dir.join("viewer-settings.json"))
}

fn read_settings(app: &AppHandle) -> Result<ViewerSettings, String> {
    let path = settings_path(app)?;

    if !path.exists() {
        return Ok(ViewerSettings::default());
    }

    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read viewer settings from {}: {error}", path.display()))?;

    let parsed = serde_json::from_str::<ViewerSettings>(&raw).unwrap_or_default();
    Ok(sanitized_settings(parsed))
}

fn write_settings(app: &AppHandle, settings: &ViewerSettings) -> Result<(), String> {
    let path = settings_path(app)?;

    let serialized = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("Failed to serialize settings: {error}"))?;

    fs::write(&path, serialized)
        .map_err(|error| format!("Failed to write settings to {}: {error}", path.display()))
}

fn merge_settings(current: &mut ViewerSettings, patch: ViewerSettingsPatch) {
    if let Some(theme) = patch.theme {
        current.theme = if theme == "light" {
            "light".to_string()
        } else {
            "dark".to_string()
        };
    }

    if let Some(font_scale) = patch.font_scale {
        current.font_scale = font_scale.clamp(0.75, 2.25);
    }

    if let Some(minimap_visible) = patch.minimap_visible {
        current.minimap_visible = minimap_visible;
    }

    if let Some(last_search_mode) = patch.last_search_mode {
        current.last_search_mode = if last_search_mode == "filter" {
            "filter".to_string()
        } else {
            "find".to_string()
        };
    }

    if let Some(window_state) = patch.window_state {
        if let Some(width) = window_state.width {
            current.window_state.width = width.max(640.0);
        }
        if let Some(height) = window_state.height {
            current.window_state.height = height.max(420.0);
        }
        if let Some(x) = window_state.x {
            current.window_state.x = Some(x);
        }
        if let Some(y) = window_state.y {
            current.window_state.y = Some(y);
        }
        if let Some(maximized) = window_state.maximized {
            current.window_state.maximized = Some(maximized);
        }
    }

    let sanitized = sanitized_settings(current.clone());
    *current = sanitized;
}

fn sanitized_settings(input: ViewerSettings) -> ViewerSettings {
    ViewerSettings {
        theme: if input.theme == "light" {
            "light".to_string()
        } else {
            "dark".to_string()
        },
        font_scale: input.font_scale.clamp(0.75, 2.25),
        minimap_visible: input.minimap_visible,
        last_search_mode: if input.last_search_mode == "filter" {
            "filter".to_string()
        } else {
            "find".to_string()
        },
        window_state: WindowState {
            width: input.window_state.width.max(640.0),
            height: input.window_state.height.max(420.0),
            x: input.window_state.x,
            y: input.window_state.y,
            maximized: input.window_state.maximized,
        },
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_man_page,
            get_settings,
            set_settings,
            suggest_alias
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
