//! Tauri commands: the UI's whole interface to the core.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::audio::{self, Cue, ExportItem};
use crate::engine::{EngineState, EngineSupervisor};
use crate::jobs::{GenerationQueue, JobSpec, QueueSnapshot};
use crate::models::{adapter_for, all_adapters, describe, AdapterDescriptor, VoiceInput};
use crate::project::{self, Project};
use crate::settings::{AppSettings, ModelProfile};
use crate::tools::Speech;
use crate::voices::{CombinePlan, Voice, VoiceLibrary};

pub struct AppState {
    pub settings: Mutex<AppSettings>,
    pub settings_path: PathBuf,
    pub supervisor: Arc<EngineSupervisor>,
    pub queue: Arc<GenerationQueue>,
    pub voices: Mutex<VoiceLibrary>,
    pub work_root: PathBuf,
}

type R<T> = Result<T, String>;

fn e<E: std::fmt::Display>(x: E) -> String {
    x.to_string()
}

fn allow_dir(app: &AppHandle, dir: &Path) {
    let _ = app.asset_protocol_scope().allow_directory(dir, true);
}

impl AppState {
    fn profile(&self, id: &str) -> R<ModelProfile> {
        self.settings
            .lock()
            .unwrap()
            .profile(id)
            .cloned()
            .ok_or_else(|| format!("モデルプロファイル {id} がありません"))
    }
    fn exe(&self) -> String {
        self.settings.lock().unwrap().speech_exe.clone()
    }
}

#[tauri::command]
pub fn get_settings(st: State<'_, AppState>) -> AppSettings {
    st.settings.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_settings(st: State<'_, AppState>, settings: AppSettings) -> R<()> {
    settings.save(&st.settings_path).map_err(e)?;
    *st.settings.lock().unwrap() = settings;
    Ok(())
}

#[tauri::command]
pub fn new_profile(
    adapter: String,
    id: String,
    name: String,
    model: String,
    speech_exe: String,
) -> R<ModelProfile> {
    adapter_for(&adapter).ok_or("unknown adapter")?;
    Ok(ModelProfile::new(&id, &name, &adapter, &model, &speech_exe))
}

#[tauri::command]
pub fn list_adapters() -> Vec<AdapterDescriptor> {
    all_adapters()
        .iter()
        .map(|a| describe(a.as_ref()))
        .collect()
}

#[tauri::command]
pub async fn speech_version(exe: String) -> R<String> {
    let env = BTreeMap::new();
    Speech {
        exe: &exe,
        env: &env,
    }
    .version()
    .await
    .map_err(e)
}

#[tauri::command]
pub async fn list_devices(st: State<'_, AppState>) -> R<Value> {
    let exe = st.exe();
    let env = BTreeMap::new();
    Speech {
        exe: &exe,
        env: &env,
    }
    .devices()
    .await
    .map_err(e)
}

#[tauri::command]
pub async fn model_catalog(st: State<'_, AppState>) -> R<Value> {
    let exe = st.exe();
    let env = BTreeMap::new();
    Speech {
        exe: &exe,
        env: &env,
    }
    .catalog()
    .await
    .map_err(e)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub path: String,
    pub info: Value,
    pub sidecar: bool,
}

/// `speech info --json` of a profile's model, and whether its `.gguf.json` sidecar sits beside it.
#[tauri::command]
pub async fn model_info(st: State<'_, AppState>, profile_id: String) -> R<ModelInfo> {
    let p = st.profile(&profile_id)?;
    let s = Speech {
        exe: &p.speech_exe,
        env: &p.env,
    };
    let path = s.resolve_model(&p.model).await.map_err(e)?;
    let info = s.info(&path).await.map_err(e)?;
    let sidecar = Path::new(&format!("{path}.json")).exists();
    Ok(ModelInfo {
        path,
        info,
        sidecar,
    })
}

#[tauri::command]
pub fn engine_state(st: State<'_, AppState>) -> EngineState {
    st.supervisor.state()
}

#[tauri::command]
pub async fn engine_start(st: State<'_, AppState>, profile_id: String) -> R<()> {
    let p = st.profile(&profile_id)?;
    if p.model.trim().is_empty() {
        return Err("モデル (GGUF) のパスが設定されていません".into());
    }
    let path = Speech {
        exe: &p.speech_exe,
        env: &p.env,
    }
    .resolve_model(&p.model)
    .await
    .map_err(e)?;
    st.supervisor.start(&p, path).await.map_err(e)
}

#[tauri::command]
pub async fn engine_stop(st: State<'_, AppState>) -> R<()> {
    st.queue.cancel_all().await;
    st.supervisor.stop().await;
    Ok(())
}

#[tauri::command]
pub fn enqueue(st: State<'_, AppState>, jobs: Vec<JobSpec>) {
    st.queue.enqueue(jobs);
}

#[tauri::command]
pub async fn cancel_job(st: State<'_, AppState>, job_id: String) -> R<()> {
    st.queue.cancel(&job_id).await;
    Ok(())
}

#[tauri::command]
pub async fn cancel_all(st: State<'_, AppState>) -> R<()> {
    st.queue.cancel_all().await;
    Ok(())
}

#[tauri::command]
pub fn queue_snapshot(st: State<'_, AppState>) -> QueueSnapshot {
    st.queue.snapshot()
}

#[tauri::command]
pub async fn count_tokens(st: State<'_, AppState>, text: String) -> R<u64> {
    let live = st.supervisor.live().map_err(e)?;
    live.conn.count_tokens(&text).await.map_err(e)
}

// ---- voices ----

#[tauri::command]
pub fn voices_list(app: AppHandle, st: State<'_, AppState>) -> Vec<Voice> {
    let lib = st.voices.lock().unwrap();
    allow_dir(&app, &lib.dir);
    lib.voices.clone()
}

#[tauri::command]
pub async fn voice_transcribe(app: AppHandle, st: State<'_, AppState>, path: String) -> R<String> {
    let (exe, model, device) = {
        let s = st.settings.lock().unwrap();
        (
            s.speech_exe.clone(),
            s.asr_model.clone(),
            s.asr_device.clone(),
        )
    };
    if let Some(d) = Path::new(&path).parent() {
        let _ = app.asset_protocol_scope().allow_file(Path::new(&path));
        let _ = d;
    }
    let env = BTreeMap::new();
    Speech {
        exe: &exe,
        env: &env,
    }
    .transcribe(&model, &device, &path)
    .await
    .map_err(e)
}

async fn build_voice(p: &ModelProfile, args: Vec<String>) -> R<()> {
    // Vulkan flags do not matter on the CPU, but the profile's env is passed for consistency.
    Speech {
        exe: &p.speech_exe,
        env: &p.env,
    }
    .run(&args)
    .await
    .map(|_| ())
    .map_err(e)
}

#[tauri::command]
pub async fn voice_create(
    st: State<'_, AppState>,
    profile_id: String,
    name: String,
    inputs: Vec<VoiceInput>,
    note: Option<String>,
) -> R<Voice> {
    let p = st.profile(&profile_id)?;
    let adapter = adapter_for(&p.adapter).ok_or("unknown adapter")?;
    let model = Speech {
        exe: &p.speech_exe,
        env: &p.env,
    }
    .resolve_model(&p.model)
    .await
    .map_err(e)?;
    let (build, mut voice) = st
        .voices
        .lock()
        .unwrap()
        .plan(adapter.as_ref(), &model, &name, inputs)
        .map_err(e)?;
    let args = adapter.prepare_voice(&build).map_err(e)?;
    build_voice(&p, args).await?;
    voice.note = note.unwrap_or_default();
    st.voices.lock().unwrap().insert(voice.clone()).map_err(e)?;
    Ok(voice)
}

/// A Drama-3 cast voice whose speaker N is `voiceIds[N]`.
#[tauri::command]
pub async fn voice_combine(
    st: State<'_, AppState>,
    profile_id: String,
    voice_ids: Vec<Option<String>>,
    name: Option<String>,
) -> R<Option<Voice>> {
    let p = st.profile(&profile_id)?;
    let adapter = adapter_for(&p.adapter).ok_or("unknown adapter")?;
    let model = Speech {
        exe: &p.speech_exe,
        env: &p.env,
    }
    .resolve_model(&p.model)
    .await
    .map_err(e)?;
    let plan = st
        .voices
        .lock()
        .unwrap()
        .plan_combined(&model, &voice_ids)?;
    let name = name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
    let mut voice = match plan {
        CombinePlan::NoneNeeded => return Ok(None),
        CombinePlan::Existing(v) => v,
        CombinePlan::Build(build, voice) => {
            let args = adapter.prepare_voice(&build).map_err(e)?;
            build_voice(&p, args).await?;
            voice
        }
    };
    if let Some(n) = name {
        voice.name = n;
    }
    st.voices.lock().unwrap().insert(voice.clone()).map_err(e)?;
    Ok(Some(voice))
}

#[tauri::command]
pub fn voice_update(st: State<'_, AppState>, voice: Voice) -> R<()> {
    let mut lib = st.voices.lock().unwrap();
    let mut v = lib.get(&voice.id).cloned().ok_or("no such voice")?;
    v.name = voice.name;
    v.note = voice.note;
    lib.insert(v).map_err(e)
}

#[tauri::command]
pub fn voice_delete(st: State<'_, AppState>, id: String) -> R<()> {
    st.voices.lock().unwrap().remove(&id).map_err(e)
}

// ---- project ----

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedProject {
    pub project: Project,
    pub takes_dir: String,
    pub path: Option<String>,
}

/// A work folder for an untitled project's takes.
#[tauri::command]
pub fn project_new(app: AppHandle, st: State<'_, AppState>) -> R<String> {
    let dir = st.work_root.join(uuid::Uuid::new_v4().simple().to_string());
    std::fs::create_dir_all(&dir).map_err(e)?;
    allow_dir(&app, &dir);
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn project_save(
    app: AppHandle,
    st: State<'_, AppState>,
    path: String,
    project: Project,
    from_takes_dir: Option<String>,
) -> R<String> {
    let dir = project::save_project(
        Path::new(&path),
        &project,
        from_takes_dir.as_deref().map(Path::new),
    )
    .map_err(e)?;
    allow_dir(&app, &dir);
    let mut s = st.settings.lock().unwrap();
    s.push_recent_project(&path);
    let _ = s.save(&st.settings_path);
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn project_load(app: AppHandle, st: State<'_, AppState>, path: String) -> R<OpenedProject> {
    let (project, dir) = project::load_project(Path::new(&path)).map_err(e)?;
    allow_dir(&app, &dir);
    let mut s = st.settings.lock().unwrap();
    s.push_recent_project(&path);
    let _ = s.save(&st.settings_path);
    Ok(OpenedProject {
        project,
        takes_dir: dir.to_string_lossy().into_owned(),
        path: Some(path),
    })
}

#[tauri::command]
pub fn project_prune(project: Project, takes_dir: String) -> usize {
    project::prune_orphans(&project, Path::new(&takes_dir))
}

#[tauri::command]
pub fn read_text_file(path: String) -> R<String> {
    let bytes = std::fs::read(&path).map_err(e)?;
    let b = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
    Ok(String::from_utf8_lossy(b).into_owned())
}

#[tauri::command]
pub fn allow_file(app: AppHandle, path: String) -> R<()> {
    app.asset_protocol_scope()
        .allow_file(Path::new(&path))
        .map_err(e)
}

// ---- export ----

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinedExport {
    pub items: Vec<ExportItem>,
    pub wav_path: String,
    pub srt: bool,
    pub txt: bool,
    pub srt_with_cast: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub files: Vec<String>,
    pub cues: Vec<Cue>,
}

#[tauri::command]
pub async fn export_joined(req: JoinedExport) -> R<ExportResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let wav = PathBuf::from(&req.wav_path);
        let cues = audio::concat(&req.items, &wav, None).map_err(e)?;
        let mut files = vec![req.wav_path.clone()];
        if req.srt {
            let p = wav.with_extension("srt");
            std::fs::write(&p, audio::srt(&cues, req.srt_with_cast)).map_err(e)?;
            files.push(p.to_string_lossy().into_owned());
        }
        if req.txt {
            let p = wav.with_extension("txt");
            std::fs::write(&p, audio::script_text(&req.items)).map_err(e)?;
            files.push(p.to_string_lossy().into_owned());
        }
        Ok(ExportResult { files, cues })
    })
    .await
    .map_err(e)?
}

#[tauri::command]
pub async fn export_each(
    items: Vec<ExportItem>,
    dir: String,
    template: String,
    write_txt: bool,
) -> R<ExportResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let files = audio::export_each(&items, Path::new(&dir), &template, write_txt).map_err(e)?;
        Ok(ExportResult {
            files: files
                .into_iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect(),
            cues: Vec::new(),
        })
    })
    .await
    .map_err(e)?
}

#[tauri::command]
pub fn delete_file(path: String) -> R<()> {
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(x) if x.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(x) => Err(x.to_string()),
    }
}

/// The process's own working set in bytes (Windows), for the memory check.
#[tauri::command]
pub fn process_memory() -> u64 {
    crate::memory::working_set()
}

/// Downloads the latest official speech.cpp Windows Vulkan release (SHA-256 checked) and points the
/// settings, and every profile whose speech.exe is missing, at it.
#[tauri::command]
pub async fn install_speech(app: AppHandle, st: State<'_, AppState>) -> R<AppSettings> {
    let root = app.path().app_local_data_dir().map_err(e)?.join("speech");
    let emit_app = app.clone();
    let installed = tauri::async_runtime::spawn_blocking(move || {
        crate::installer::install_latest(&root, &|line| {
            let _ = tauri::Emitter::emit(&emit_app, "vs://event", crate::events::AppEvent::EngineLog { line: format!("[install] {line}") });
        })
    })
    .await
    .map_err(e)??;
    let mut s = st.settings.lock().unwrap();
    let old = s.speech_exe.clone();
    s.speech_exe = installed.exe.clone();
    for p in &mut s.profiles {
        if p.speech_exe.is_empty() || p.speech_exe == old || !Path::new(&p.speech_exe).exists() {
            p.speech_exe = installed.exe.clone();
        }
    }
    s.save(&st.settings_path).map_err(e)?;
    Ok(s.clone())
}
