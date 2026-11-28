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
use crate::memguard::{self, GuardLevel, Held, MemoryCheck, Verdict};
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
    pub work: crate::work::WorkDir,
    pub downloads: crate::downloads::Downloads,
    /// A catalog.json here replaces the built-in model catalog.
    pub catalog_override: PathBuf,
    /// What the running engine holds on its device, to count as free when another start stops it (D-58).
    pub engine_memory: Arc<Mutex<Option<crate::memguard::Held>>>,
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
pub fn new_profile(adapter: String, id: String, name: String, model: String, speech_exe: String) -> R<ModelProfile> {
    adapter_for(&adapter).ok_or("unknown adapter")?;
    Ok(ModelProfile::new(&id, &name, &adapter, &model, &speech_exe))
}

#[tauri::command]
pub fn list_adapters() -> Vec<AdapterDescriptor> {
    all_adapters().iter().map(|a| describe(a.as_ref())).collect()
}

#[tauri::command]
pub async fn speech_version(exe: String) -> R<String> {
    let env = BTreeMap::new();
    Speech { exe: &exe, env: &env }.version().await.map_err(e)
}

#[tauri::command]
pub async fn list_devices(st: State<'_, AppState>) -> R<Value> {
    let exe = st.exe();
    let env = BTreeMap::new();
    Speech { exe: &exe, env: &env }.devices().await.map_err(e)
}

#[tauri::command]
pub async fn model_catalog(st: State<'_, AppState>) -> R<Value> {
    let exe = st.exe();
    let env = BTreeMap::new();
    Speech { exe: &exe, env: &env }.catalog().await.map_err(e)
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
    let s = Speech { exe: &p.speech_exe, env: &p.env };
    let path = s.resolve_model(&p.model).await.map_err(e)?;
    let info = s.info(&path).await.map_err(e)?;
    let sidecar = Path::new(&format!("{path}.json")).exists();
    Ok(ModelInfo { path, info, sidecar })
}

#[tauri::command]
pub fn engine_state(st: State<'_, AppState>) -> EngineState {
    st.supervisor.state()
}

/// What `engine_start` did: started, or held back by the memory check (D-58).
#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum StartResult {
    Started,
    /// Not started: asks the user first. `engine_start` again with `confirmed` starts it.
    Confirm {
        check: MemoryCheck,
    },
    /// Not started, and `confirmed` does not change that.
    Blocked {
        check: MemoryCheck,
    },
}

/// The free-memory check for loading `model_path` with `p`, or `None` when it is off or cannot be
/// made (devices not listed, device or file unknown): then the engine starts as before.
async fn memory_check(st: &AppState, p: &ModelProfile, model_path: &str, level: GuardLevel) -> Option<MemoryCheck> {
    if level == GuardLevel::Off {
        return None;
    }
    let file_bytes = std::fs::metadata(model_path).ok()?.len();
    let devices = Speech { exe: &p.speech_exe, env: &p.env }.devices().await.ok()?;
    let dev = memguard::pick_device(&devices, &p.device)?;
    // The running engine stops before the new one loads, so what it holds there counts as free.
    let reclaim = match (st.supervisor.live(), st.engine_memory.lock().unwrap().as_ref()) {
        (Ok(_), Some(h)) if h.device == dev.name => h.bytes,
        _ => 0,
    };
    memguard::check(level, &dev, reclaim, file_bytes)
}

#[tauri::command]
pub async fn engine_start(st: State<'_, AppState>, profile_id: String, confirmed: Option<bool>) -> R<StartResult> {
    let p = st.profile(&profile_id)?;
    if p.model.trim().is_empty() {
        return Err("モデル (GGUF) のパスが設定されていません".into());
    }
    let path = Speech { exe: &p.speech_exe, env: &p.env }.resolve_model(&p.model).await.map_err(e)?;
    let level = st.settings.lock().unwrap().memory_guard;
    let check = memory_check(&st, &p, &path, level).await;
    match &check {
        Some(c) if c.verdict == Verdict::Block => return Ok(StartResult::Blocked { check: c.clone() }),
        Some(c) if c.verdict == Verdict::Confirm && confirmed != Some(true) => {
            return Ok(StartResult::Confirm { check: c.clone() })
        }
        _ => {}
    }
    *st.engine_memory.lock().unwrap() = None;
    st.supervisor.start(&p, path).await.map_err(e)?;
    if let Some(c) = check {
        // Until it is measured, the engine is taken to hold the estimate.
        let held = st.engine_memory.clone();
        let bytes = memguard::estimate(c.file_bytes);
        *held.lock().unwrap() = Some(Held { profile_id: p.id.clone(), device: c.device.clone(), bytes });
        // Measure what loading took: free before (without what the old engine freed) minus free now.
        let before = c.free - c.reclaim;
        tokio::spawn(async move {
            let devices = Speech { exe: &p.speech_exe, env: &p.env }.devices().await.ok();
            let Some(now) = devices.and_then(|d| memguard::pick_device(&d, &c.device)) else { return };
            let used = before.saturating_sub(now.free);
            let mut g = held.lock().unwrap();
            // Only for this start, and only a plausible figure (another program may have freed memory meanwhile).
            if let Some(h) = g.as_mut().filter(|h| h.profile_id == p.id && h.device == c.device) {
                if used > bytes / 4 {
                    h.bytes = used;
                }
            }
        });
    }
    Ok(StartResult::Started)
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
        (s.speech_exe.clone(), s.asr_model.clone(), s.asr_device.clone())
    };
    if let Some(d) = Path::new(&path).parent() {
        let _ = app.asset_protocol_scope().allow_file(Path::new(&path));
        let _ = d;
    }
    let env = BTreeMap::new();
    Speech { exe: &exe, env: &env }.transcribe(&model, &device, &path).await.map_err(e)
}

async fn build_voice(p: &ModelProfile, args: Vec<String>) -> R<()> {
    // Vulkan flags do not matter on the CPU, but the profile's env is passed for consistency.
    Speech { exe: &p.speech_exe, env: &p.env }.run(&args).await.map(|_| ()).map_err(e)
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
    let model = Speech { exe: &p.speech_exe, env: &p.env }.resolve_model(&p.model).await.map_err(e)?;
    let sources: Vec<PathBuf> = inputs.iter().map(|i| i.path.clone()).collect();
    let (build, mut voice) = st.voices.lock().unwrap().plan(adapter.as_ref(), &model, &name, inputs).map_err(e)?;
    let args = adapter.prepare_voice(&build).map_err(e)?;
    build_voice(&p, args).await?;
    voice.note = note.unwrap_or_default();
    st.voices.lock().unwrap().insert(voice.clone()).map_err(e)?;
    // The library keeps its own copies of the references, so the trimmed cuts are not needed any more.
    let trimmed = st.work.root().join(crate::work::TRIMMED);
    for p in &sources {
        if p.parent() == Some(trimmed.as_path()) {
            let _ = std::fs::remove_file(p);
        }
    }
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
    let model = Speech { exe: &p.speech_exe, env: &p.env }.resolve_model(&p.model).await.map_err(e)?;
    let plan = st.voices.lock().unwrap().plan_combined(&model, &voice_ids)?;
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
    let dir = st.work.root().join(uuid::Uuid::new_v4().simple().to_string());
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
    keep: Option<Vec<String>>,
) -> R<String> {
    let from = from_takes_dir.as_deref().map(Path::new);
    // A folder a job still writes into is copied, not moved (D-49).
    let can_move = from.is_none_or(|f| !st.queue.uses_dir(f));
    let dir = project::save_project(Path::new(&path), &project, from, keep.as_deref().unwrap_or_default(), can_move)
        .map_err(e)?;
    allow_dir(&app, &dir);
    // The takes now live beside the project; an untitled project's work folder is no longer needed.
    if let Some(from) = from_takes_dir {
        release_work_dir(&st, Path::new(&from));
    }
    let mut s = st.settings.lock().unwrap();
    s.push_recent_project(&path);
    let _ = s.save(&st.settings_path);
    Ok(dir.to_string_lossy().into_owned())
}

/// Deletes an untitled project's work folder (D-39). Anything else, or a folder a job still writes into, is left
/// alone; the next start sweeps what is left.
fn release_work_dir(st: &AppState, dir: &Path) {
    if st.work.is_project_dir(dir) && !st.queue.uses_dir(dir) {
        let _ = std::fs::remove_dir_all(dir);
    }
}

/// Called when the UI leaves a project (new / open): drops the folder if it was an untitled project's.
#[tauri::command]
pub fn project_release(st: State<'_, AppState>, takes_dir: String) {
    release_work_dir(&st, Path::new(&takes_dir));
}

/// Where voice-design candidates are written: a scratch folder swept at the next start.
#[tauri::command]
pub fn design_dir(st: State<'_, AppState>) -> R<String> {
    let d = st.work.sub(crate::work::DESIGN).map_err(e)?;
    Ok(d.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn project_load(app: AppHandle, st: State<'_, AppState>, path: String) -> R<OpenedProject> {
    let (project, dir) = project::load_project(Path::new(&path)).map_err(e)?;
    allow_dir(&app, &dir);
    let mut s = st.settings.lock().unwrap();
    s.push_recent_project(&path);
    let _ = s.save(&st.settings_path);
    Ok(OpenedProject { project, takes_dir: dir.to_string_lossy().into_owned(), path: Some(path) })
}

#[tauri::command]
pub fn project_prune(st: State<'_, AppState>, project: Project, takes_dir: String, keep: Option<Vec<String>>) -> usize {
    let busy = st.queue.writing();
    project::prune_orphans(&project, Path::new(&takes_dir), busy.as_deref(), keep.as_deref().unwrap_or_default())
}

#[tauri::command]
pub fn read_text_file(path: String) -> R<String> {
    let bytes = std::fs::read(&path).map_err(e)?;
    let b = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
    Ok(String::from_utf8_lossy(b).into_owned())
}

#[tauri::command]
pub fn allow_file(app: AppHandle, path: String) -> R<()> {
    app.asset_protocol_scope().allow_file(Path::new(&path)).map_err(e)
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
pub async fn export_each(items: Vec<ExportItem>, dir: String, template: String, write_txt: bool) -> R<ExportResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let files = audio::export_each(&items, Path::new(&dir), &template, write_txt).map_err(e)?;
        Ok(ExportResult {
            files: files.into_iter().map(|p| p.to_string_lossy().into_owned()).collect(),
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
            let _ = tauri::Emitter::emit(
                &emit_app,
                "vs://event",
                crate::events::AppEvent::EngineLog { line: format!("[install] {line}") },
            );
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

// ---- model catalog ----

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub name: String,
    pub free: u64,
    pub total: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogView {
    pub catalog: crate::downloads::Catalog,
    /// Model id → the variant recommended for the GPU's memory.
    pub recommended: std::collections::HashMap<String, String>,
    pub gpu: Option<GpuInfo>,
    pub default_dir: String,
    /// Download ids (`model:variant`) that are running.
    pub running: Vec<String>,
}

#[tauri::command]
pub async fn catalog_list(app: AppHandle, st: State<'_, AppState>) -> R<CatalogView> {
    use crate::downloads::{recommend, Catalog};
    let catalog = Catalog::load(&st.catalog_override);
    let exe = st.exe();
    let env = BTreeMap::new();
    let devs = Speech { exe: &exe, env: &env }.devices().await.ok();
    let gpu = devs
        .as_ref()
        .and_then(|d| {
            d.get("devices")?.as_array()?.iter().find(|x| x.get("kind").and_then(Value::as_str) == Some("gpu")).cloned()
        })
        .map(|g| GpuInfo {
            name: g.get("description").and_then(Value::as_str).unwrap_or("").trim().to_string(),
            free: g.get("memory_free").and_then(Value::as_u64).unwrap_or(0),
            total: g.get("memory_total").and_then(Value::as_u64).unwrap_or(0),
        });
    // A loaded engine holds VRAM itself, so then judge by the total minus a desktop reserve.
    let budget =
        gpu.as_ref().map(|g| if st.supervisor.live().is_ok() { g.total.saturating_sub(1 << 30) } else { g.free });
    let recommended = catalog.models.iter().filter_map(|m| recommend(m, budget).map(|v| (m.id.clone(), v))).collect();
    let default_dir = app.path().app_local_data_dir().map_err(e)?.join("models").to_string_lossy().into_owned();
    let running = st.downloads.running.lock().unwrap().keys().cloned().collect();
    Ok(CatalogView { catalog, recommended, gpu, default_dir, running })
}

#[tauri::command]
pub fn default_models_dir(app: AppHandle) -> R<String> {
    Ok(app.path().app_local_data_dir().map_err(e)?.join("models").to_string_lossy().into_owned())
}

#[tauri::command]
pub fn download_cancel(st: State<'_, AppState>, id: String) {
    if let Some(c) = st.downloads.running.lock().unwrap().get(&id) {
        c.store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

/// Starts a catalog download in the background; progress and the result come as `download` events.
/// On success a synthesis model gets a profile (created or replaced, and selected); a recognition model becomes the ASR model.
#[tauri::command]
pub fn catalog_download(
    app: AppHandle,
    st: State<'_, AppState>,
    model_id: String,
    variant_id: String,
    dest_dir: String,
    license_accepted: bool,
) -> R<String> {
    use crate::downloads::{Catalog, DownloadError, Progress, Source};
    use std::sync::atomic::AtomicBool;
    let catalog = Catalog::load(&st.catalog_override);
    let (m, v) = catalog.find(&model_id, &variant_id).ok_or("カタログにないモデルです")?;
    if !v.supported {
        return Err(format!("{} は使えません: {}", v.label, v.unsupported_reason));
    }
    if m.license.requires_consent && !license_accepted {
        return Err(format!("{} への同意が必要です", m.license.name));
    }
    let (m, v) = (m.clone(), v.clone());
    let id = format!("{model_id}:{variant_id}");
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut running = st.downloads.running.lock().unwrap();
        if running.contains_key(&id) {
            return Err("このモデルはダウンロード中です".into());
        }
        running.insert(id.clone(), cancel.clone());
    }
    let exe = st.exe();
    let id2 = id.clone();
    tauri::async_runtime::spawn(async move {
        let emit_app = app.clone();
        let on: Arc<dyn Fn(Progress) + Send + Sync> = Arc::new(move |p| {
            let _ = tauri::Emitter::emit(&emit_app, "vs://event", crate::events::AppEvent::Download(p));
        });
        let result: Result<String, DownloadError> = match &m.source {
            Source::Huggingface { repo, revision } => {
                let (repo, revision, v2, dir, c, on2, id3) = (
                    repo.clone(),
                    revision.clone(),
                    v.clone(),
                    PathBuf::from(dest_dir.replace('/', std::path::MAIN_SEPARATOR_STR)),
                    cancel.clone(),
                    on.clone(),
                    id2.clone(),
                );
                tauri::async_runtime::spawn_blocking(move || {
                    crate::downloads::fetch_variant(&id3, &repo, &revision, &v2, &dir, &c, &*on2)
                })
                .await
                .map_err(|x| DownloadError::Other(x.to_string()))
                .and_then(|r| r)
                .map(|p| p.to_string_lossy().into_owned())
            }
            Source::SpeechPull { name } => {
                // speech.cpp keeps its catalog in %LOCALAPPDATA%\speech.cpp.
                let need = v.total_bytes();
                let dir = std::env::var("LOCALAPPDATA").map(PathBuf::from).unwrap_or_default();
                match crate::downloads::free_space(&dir) {
                    Some(free) if free < need + (1 << 30) => Err(DownloadError::NoSpace {
                        need: crate::downloads::gib(need + (1 << 30)),
                        free: crate::downloads::gib(free),
                    }),
                    _ => crate::downloads::speech_pull(&id2, &exe, name, cancel.clone(), on.clone()).await,
                }
            }
        };
        let st = app.state::<AppState>();
        st.downloads.running.lock().unwrap().remove(&id2);
        let mut p = Progress::new(&id2, "done");
        match result {
            Ok(path) => {
                let mut s = st.settings.lock().unwrap();
                if m.task == "recognition" {
                    s.asr_model = path.clone();
                    p.message = format!("書き起こしモデルに設定しました: {path}");
                } else {
                    let pid = format!("{}-{}", m.id, v.id);
                    let mut prof =
                        ModelProfile::new(&pid, &format!("{} {}", m.name, v.label), &m.adapter, &path, &s.speech_exe);
                    prof.env = m.env.clone();
                    if !m.device.is_empty() {
                        prof.device = m.device.clone();
                    }
                    s.profiles.retain(|x| x.id != pid);
                    s.profiles.push(prof);
                    s.active_profile_id = Some(pid.clone());
                    p.profile_id = Some(pid);
                    p.message = format!("プロファイルを作成して選択しました: {path}");
                }
                let _ = s.save(&st.settings_path);
            }
            Err(DownloadError::Cancelled) => {
                p.phase = "cancelled".into();
                p.message = "キャンセルしました（続きから再開できます）".into();
            }
            Err(x) => {
                p.phase = "failed".into();
                p.message = x.to_string();
            }
        }
        on(p);
    });
    Ok(id)
}

// ---- reference audio and prompt voices ----

#[tauri::command]
pub async fn wav_peaks(app: AppHandle, path: String, buckets: usize) -> R<audio::Waveform> {
    let _ = app.asset_protocol_scope().allow_file(Path::new(&path));
    tauri::async_runtime::spawn_blocking(move || audio::peaks(Path::new(&path), buckets).map_err(e)).await.map_err(e)?
}

/// Cuts `[start, end)` of a reference recording into a new file beside the library's references; the original stays.
#[tauri::command]
pub async fn wav_trim(app: AppHandle, st: State<'_, AppState>, path: String, start: f64, end: f64) -> R<String> {
    let dir = st.work.sub(crate::work::TRIMMED).map_err(e)?;
    let stem = Path::new(&path).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "ref".into());
    let dst =
        dir.join(format!("{stem}_{:.2}-{:.2}_{}.wav", start, end, &uuid::Uuid::new_v4().simple().to_string()[..6]));
    let d2 = dst.clone();
    tauri::async_runtime::spawn_blocking(move || audio::trim(Path::new(&path), &d2, start, end).map_err(e))
        .await
        .map_err(e)??;
    let _ = app.asset_protocol_scope().allow_file(&dst);
    Ok(dst.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn voice_create_prompt(
    st: State<'_, AppState>,
    family: String,
    name: String,
    prompt: String,
    note: Option<String>,
) -> R<Voice> {
    adapter_for(&family).ok_or("unknown adapter")?;
    if prompt.trim().is_empty() {
        return Err("声の説明が空です".into());
    }
    st.voices.lock().unwrap().add_prompt_voice(&family, &name, &prompt, &note.unwrap_or_default()).map_err(e)
}
