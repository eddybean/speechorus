//! Voice Studio core: a GUI for speech.cpp.

pub mod audio;
mod commands;
pub mod engine;
pub mod events;
pub mod installer;
pub mod jobs;
mod memory;
pub mod models;
pub mod project;
pub mod settings;
pub mod tools;
pub mod voices;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};

use commands::AppState;
use events::{AppEvent, Emit};

/// Where a bundled or development `speech.exe` is, if any.
fn find_speech_exe() -> String {
    if let Ok(p) = std::env::var("VOICE_STUDIO_SPEECH") {
        return p;
    }
    let mut c: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(d) = exe.parent() {
            c.push(d.join("speech").join("speech.exe"));
            c.push(d.join("speech.exe"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        c.push(cwd.join("../.engine/speech.exe"));
        c.push(cwd.join(".engine/speech.exe"));
    }
    c.into_iter()
        .find(|p| p.exists())
        .and_then(|p| p.canonicalize().ok())
        .map(|p| strip_verbatim(&p.to_string_lossy()))
        .unwrap_or_default()
}

/// `\\?\E:\x` (what canonicalize gives on Windows) → `E:\x`.
fn strip_verbatim(p: &str) -> String {
    p.strip_prefix(r"\\?\").unwrap_or(p).to_string()
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let emit: Emit = Arc::new(move |ev: AppEvent| {
                let _ = handle.emit("vs://event", ev);
            });
            let cfg = app.path().app_config_dir()?;
            let data = app.path().app_data_dir()?;
            let local = app.path().app_local_data_dir()?;
            let settings_path = cfg.join("settings.json");
            let settings = settings::AppSettings::load(&settings_path)
                .map(|mut s| {
                    s.speech_exe = strip_verbatim(&s.speech_exe);
                    for p in &mut s.profiles {
                        p.speech_exe = strip_verbatim(&p.speech_exe);
                    }
                    s
                })
                .unwrap_or_else(|| {
                    let s = settings::AppSettings::first_run(&find_speech_exe());
                    let _ = s.save(&settings_path);
                    s
                });
            let voices = voices::VoiceLibrary::open(&data.join("voices"));
            let _ = app
                .asset_protocol_scope()
                .allow_directory(&voices.dir, true);
            let supervisor = engine::EngineSupervisor::new(emit.clone());
            let queue = tauri::async_runtime::block_on(async {
                jobs::GenerationQueue::new(supervisor.clone(), emit)
            });
            app.manage(AppState {
                settings: Mutex::new(settings),
                settings_path,
                supervisor,
                queue,
                voices: Mutex::new(voices),
                work_root: local.join("work"),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::new_profile,
            commands::list_adapters,
            commands::speech_version,
            commands::list_devices,
            commands::model_catalog,
            commands::model_info,
            commands::engine_state,
            commands::engine_start,
            commands::engine_stop,
            commands::enqueue,
            commands::cancel_job,
            commands::cancel_all,
            commands::queue_snapshot,
            commands::count_tokens,
            commands::voices_list,
            commands::voice_transcribe,
            commands::voice_create,
            commands::voice_combine,
            commands::voice_update,
            commands::voice_delete,
            commands::project_new,
            commands::project_save,
            commands::project_load,
            commands::project_prune,
            commands::read_text_file,
            commands::allow_file,
            commands::export_joined,
            commands::export_each,
            commands::delete_file,
            commands::process_memory,
            commands::install_speech,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Voice Studio")
        .run(|app, ev| {
            if let tauri::RunEvent::ExitRequested { .. } = ev {
                let st = app.state::<AppState>();
                tauri::async_runtime::block_on(st.supervisor.stop());
            }
        });
}

#[cfg(test)]
mod tests {
    #[test]
    fn strips_verbatim_prefix() {
        assert_eq!(
            super::strip_verbatim(r"\\?\E:\a\speech.exe"),
            r"E:\a\speech.exe"
        );
        assert_eq!(super::strip_verbatim(r"E:\a"), r"E:\a");
    }

    #[test]
    fn engine_state_fields_are_camel_case() {
        let v = serde_json::to_value(crate::engine::EngineState::Loading {
            profile_id: "p".into(),
        })
        .unwrap();
        assert_eq!(v, serde_json::json!({"state": "loading", "profileId": "p"}));
    }
}
