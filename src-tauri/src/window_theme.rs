//! 主窗口底色：冷启动时让原生窗口 / WebView 在页面绘制之前就是应用背景色。
//!
//! WKWebView 默认画白底，页面第一帧出来前深色模式会白闪一下。
//! 所以主窗口不由 tauri.conf.json 自动创建（create = false），而是在 setup 里
//! 带上底色手动创建：窗口和 WebView 从诞生起就是对应主题的 `--background`。
use tauri::window::Color;
use tauri::{App, Theme, WebviewWindowBuilder};
use tauri_plugin_store::StoreExt;

use crate::SETTINGS_STORE;

/// 主窗口 label（与 tauri.conf.json、capabilities 一致）
const MAIN_WINDOW: &str = "main";

/// 必须与 src/styles/globals.css 中 `:root` / `[data-theme='dark']` 的 `--background` 一致，
/// 改色时两边一起改（见下方单测 `matches_globals_css`）
const LIGHT_BACKGROUND: Color = Color(0xfa, 0xf9, 0xf6, 0xff);
const DARK_BACKGROUND: Color = Color(0x1b, 0x1a, 0x18, 0xff);

fn background_for(theme: Theme) -> Color {
    match theme {
        Theme::Dark => DARK_BACKGROUND,
        _ => LIGHT_BACKGROUND,
    }
}

/// 设置里的主题（settings.theme）：'light' / 'dark' 直接用；
/// 'system'、缺失或格式不对 → None，跟随系统外观
fn theme_from_settings(settings: Option<&serde_json::Value>) -> Option<Theme> {
    match settings?.get("theme")?.as_str()? {
        "light" => Some(Theme::Light),
        "dark" => Some(Theme::Dark),
        _ => None,
    }
}

/// 与 load_persisted("settings") 读同一份 settings.json；读不到 / 文件损坏都当作跟随系统
fn stored_theme(app: &App) -> Option<Theme> {
    let store = app.store(SETTINGS_STORE).ok()?;
    theme_from_settings(store.get("settings").as_ref())
}

/// 按用户主题创建主窗口（setup 中调用，此时页面还没开始加载）
pub fn create_main_window(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW)
        .ok_or("tauri.conf.json 缺少 main 窗口配置")?;

    let preferred = stored_theme(app);
    // 跟随系统时先按浅色建：带上底色才会在创建 WebView 时就关掉它的白底
    let window = WebviewWindowBuilder::from_config(app.handle(), config)?
        .background_color(background_for(preferred.unwrap_or(Theme::Light)))
        .build()?;

    if preferred.is_none() {
        // 系统外观要有窗口才读得到。仍在同一次主线程回调里，回到 run loop 绘制首帧之前就改好
        let system = window.theme().unwrap_or(Theme::Light);
        if system == Theme::Dark {
            window.set_background_color(Some(DARK_BACKGROUND))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn explicit_theme_is_used() {
        let dark = json!({ "theme": "dark", "fontSize": 18 });
        let light = json!({ "theme": "light" });
        assert_eq!(theme_from_settings(Some(&dark)), Some(Theme::Dark));
        assert_eq!(theme_from_settings(Some(&light)), Some(Theme::Light));
    }

    #[test]
    fn system_missing_or_corrupt_falls_back_to_system() {
        for settings in [
            json!({ "theme": "system" }),
            json!({ "fontSize": 18 }),
            json!({ "theme": 1 }),
            json!({ "theme": "sepia" }),
            json!("not an object"),
            json!(null),
        ] {
            assert_eq!(theme_from_settings(Some(&settings)), None, "{settings}");
        }
        assert_eq!(theme_from_settings(None), None);
    }

    /// 取 CSS 中某个选择器块里的 `--background`（#rrggbb）
    fn css_background(css: &str, selector: &str) -> Color {
        let start = css
            .find(&format!("{selector} {{"))
            .unwrap_or_else(|| panic!("globals.css 中找不到 {selector}"));
        let block = &css[start..];
        let block = &block[..block.find('}').expect("块未闭合")];
        let value = block
            .lines()
            .find_map(|line| line.trim().strip_prefix("--background:"))
            .unwrap_or_else(|| panic!("{selector} 中没有 --background"));
        let hex = value.trim().trim_end_matches(';').trim();
        let hex = hex.strip_prefix('#').expect("--background 应为 #rrggbb");
        assert_eq!(hex.len(), 6, "--background 应为 #rrggbb：{hex}");
        let channel = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).expect("非法十六进制");
        Color(channel(0), channel(2), channel(4), 0xff)
    }

    #[test]
    fn matches_globals_css() {
        let css = include_str!("../../src/styles/globals.css");
        assert_eq!(css_background(css, ":root"), LIGHT_BACKGROUND);
        assert_eq!(css_background(css, "[data-theme='dark']"), DARK_BACKGROUND);
    }
}
