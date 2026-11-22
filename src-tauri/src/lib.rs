#[cfg(desktop)]
use tauri_plugin_updater::UpdaterExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let _ = check_for_updates(handle).await;
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al iniciar Zumi OCR");
}

#[cfg(desktop)]
async fn check_for_updates(app: tauri::AppHandle) -> tauri_plugin_updater::Result<()> {
    if let Some(update) = app.updater()?.check().await? {
        let mut _downloaded = 0;
        update
            .download_and_install(
                |chunk_length, _content_length| {
                    _downloaded += chunk_length;
                },
                || {},
            )
            .await?;
        app.restart();
    }
    Ok(())
}
