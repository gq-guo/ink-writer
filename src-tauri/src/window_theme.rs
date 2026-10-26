//! 主窗口外观：冷启动时让原生窗口在页面绘制之前就是对的深浅色。
//!
//! 主窗口是透明窗口，背后铺 macOS 的 sidebar 材质（tauri.conf.json 的 windowEffects），
//! 页面只把正文区涂成纸色、侧栏留成半透明。材质的深浅跟随窗口外观（NSAppearance），
//! 所以只要窗口一创建就带上用户选的主题，页面出来之前露出的也是对应深浅的材质，不会白闪。
//! 因此主窗口不由 tauri.conf.json 自动创建（create = false），而是在 setup 里带上主题手动创建。
use tauri::{App, Theme, WebviewWindowBuilder};
use tauri_plugin_store::StoreExt;

use crate::SETTINGS_STORE;

/// 主窗口 label（与 tauri.conf.json、capabilities 一致）
const MAIN_WINDOW: &str = "main";

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

/// 按用户主题创建主窗口（setup 中调用，此时页面还没开始加载）。
/// 之后主题切换由前端 settingsStore 调 setTheme 同步。
pub fn create_main_window(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW)
        .ok_or("tauri.conf.json 缺少 main 窗口配置")?;

    // None = 跟随系统外观，材质与红绿灯自然跟着系统走
    WebviewWindowBuilder::from_config(app.handle(), config)?
        .theme(stored_theme(app))
        .build()?;
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

    /// 透明窗口 + sidebar 材质是半透明侧栏的前提；配置被改掉时这里会失败
    #[test]
    fn main_window_is_transparent_with_sidebar_material() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("tauri.conf.json 不是合法 JSON");
        let main = conf["app"]["windows"]
            .as_array()
            .and_then(|windows| windows.iter().find(|w| w["label"] == MAIN_WINDOW))
            .expect("缺少 main 窗口配置");
        assert_eq!(main["transparent"], true);
        assert_eq!(main["windowEffects"]["effects"], json!(["sidebar"]));
        assert_eq!(conf["app"]["macOSPrivateApi"], true);
    }
}
