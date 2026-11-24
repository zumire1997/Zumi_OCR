#[cfg(desktop)]
use tauri::Manager;
#[cfg(desktop)]
use tauri_plugin_updater::UpdaterExt;

#[cfg(desktop)]
fn emit_update_status(app: &tauri::AppHandle, state: &str, version: &str, percent: u8, message: &str) {
    if let Some(win) = app.get_webview_window("main") {
        let payload = serde_json::json!({
            "state": state,
            "version": version,
            "percent": percent,
            "message": message
        });
        let script = format!(
            "window.dispatchEvent(new CustomEvent('zumi-update',{{detail:{}}}));",
            payload
        );
        let _ = win.eval(&script);
    }
}

#[cfg(desktop)]
async fn run_update_check(app: tauri::AppHandle, manual: bool) -> Result<String, String> {
    if manual {
        emit_update_status(&app, "checking", "", 0, "Buscando actualizaciones...");
    }
    let updater = app.updater().map_err(|e| e.to_string())?;
    let maybe_update = updater.check().await.map_err(|e| e.to_string())?;
    if let Some(update) = maybe_update {
        let ver = update.version.clone();
        emit_update_status(
            &app,
            "available",
            &ver,
            0,
            &format!("Nueva version v{} disponible. Descargando...", ver),
        );
        let mut downloaded: u64 = 0;
        let mut last_pct: u8 = 0;
        let app_prog = app.clone();
        let ver_prog = ver.clone();
        let app_fin = app.clone();
        let ver_fin = ver.clone();
        update
            .download_and_install(
                move |chunk_length, content_length| {
                    downloaded += chunk_length as u64;
                    let pct = content_length
                        .filter(|&tot| tot > 0)
                        .map(|tot| ((downloaded.saturating_mul(100)) / tot).min(100) as u8)
                        .unwrap_or(0);
                    if pct >= last_pct.saturating_add(5) || pct == 100 {
                        last_pct = pct;
                        emit_update_status(
                            &app_prog,
                            "downloading",
                            &ver_prog,
                            pct,
                            &format!("Descargando Zumi OCR v{} ({}%)...", ver_prog, pct),
                        );
                    }
                },
                move || {
                    emit_update_status(
                        &app_fin,
                        "installing",
                        &ver_fin,
                        100,
                        &format!("Instalando Zumi OCR v{}...", ver_fin),
                    );
                },
            )
            .await
            .map_err(|e| e.to_string())?;
        app.restart();
    }
    let msg = format!("Ya tienes la version mas reciente (v{}).", app.package_info().version);
    if manual {
        emit_update_status(&app, "up-to-date", "", 100, &msg);
    }
    Ok(msg)
}

#[tauri::command]
async fn check_update_manual(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(desktop)]
    {
        return run_update_check(app, true).await;
    }
    #[cfg(not(desktop))]
    {
        Ok("Actualizador solo disponible en escritorio.".into())
    }
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("URL no permitida.".into());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let _ = run_update_check(handle, false).await;
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![check_update_manual, open_external_url])
        .run(tauri::generate_context!())
        .expect("error al iniciar Zumi OCR");
}
