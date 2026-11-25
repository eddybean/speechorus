//! Model adapters: what each synthesis model takes, and how a script line becomes a worker request.

mod drama3;
mod irodori;

use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub use drama3::Drama3Adapter;
pub use irodori::IrodoriAdapter;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    /// `brackets` (`[囁き]`) or `emoji` (`🤭`).
    pub tag_syntax: &'static str,
    /// The tag palette file under assets/tags.
    pub tag_palette: &'static str,
    /// A free-text voice/style description: Drama-3 writes it as a leading cue, Irodori sends `instructions`.
    pub design_prompt: &'static str,
    pub instructions: bool,
    pub speed: bool,
    /// `<|speaker:N|>` in one request.
    pub multi_speaker: bool,
    /// Whether multi-speaker requests are known to work with the shipped weights (see docs/engine-protocol.md).
    pub multi_speaker_reliable: bool,
    pub voice_needs_transcript: bool,
    pub voice_accepts_wav: bool,
    pub sample_rate: u32,
    pub max_seconds_per_request: f64,
    pub license_note: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptionSpec {
    pub name: &'static str,
    pub label: &'static str,
    /// `int`, `float`, `bool` or `string`.
    pub kind: &'static str,
    pub default: Value,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub step: Option<f64>,
    pub help: &'static str,
}

impl OptionSpec {
    pub(crate) fn num(name: &'static str, label: &'static str, kind: &'static str, default: Value, min: f64, max: f64, step: f64, help: &'static str) -> Self {
        OptionSpec { name, label, kind, default, min: Some(min), max: Some(max), step: Some(step), help }
    }
}

/// One synthesis, as the UI describes it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LineRequest {
    pub text: String,
    /// Worker voice name, or None for `none`.
    pub voice: Option<String>,
    /// The family the voice file was made for, checked against the adapter.
    pub voice_family: Option<String>,
    pub design_prompt: Option<String>,
    pub options: Map<String, Value>,
    pub seed: Option<u64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BuiltRequest {
    /// The `synthesize` message without `id`.
    pub msg: Map<String, Value>,
    /// Options dropped or text changed, for the UI to show.
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct VoiceInput {
    /// A reference WAV or a voice file (`.gguf`).
    pub path: PathBuf,
    pub transcript: Option<String>,
    pub speaker: Option<u32>,
}

#[derive(Debug, Clone, Default)]
pub struct VoiceBuild {
    /// The model file `speech voice` reads the codec from.
    pub model: String,
    pub inputs: Vec<VoiceInput>,
    pub out: PathBuf,
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum AdapterError {
    #[error("テキストが空です")]
    EmptyText,
    #[error("テキストに使えないトークンがあります: {0}")]
    ReservedToken(String),
    #[error("話者番号は0〜15です: {0}")]
    BadSpeaker(String),
    #[error("このボイスは {voice} 用です（現在のモデルは {model}）")]
    VoiceFamily { voice: String, model: String },
    #[error("参照音声 {0} の書き起こしがありません")]
    MissingTranscript(String),
    #[error("{0}")]
    Unsupported(String),
}

pub trait ModelAdapter: Send + Sync {
    fn id(&self) -> &'static str;
    fn display_name(&self) -> &'static str;
    fn capabilities(&self) -> Capabilities;
    fn option_schema(&self) -> Vec<OptionSpec>;
    /// Env vars a new profile for this model starts with.
    fn default_env(&self) -> Vec<(String, String)> {
        Vec::new()
    }
    fn build_request(&self, req: &LineRequest) -> Result<BuiltRequest, AdapterError>;
    /// The arguments of `speech` (after the exe) that make a voice file.
    fn prepare_voice(&self, b: &VoiceBuild) -> Result<Vec<String>, AdapterError>;
}

pub fn adapter_for(id: &str) -> Option<Arc<dyn ModelAdapter>> {
    match id {
        "drama3" => Some(Arc::new(Drama3Adapter)),
        "irodori" => Some(Arc::new(IrodoriAdapter)),
        _ => None,
    }
}

pub fn all_adapters() -> Vec<Arc<dyn ModelAdapter>> {
    vec![Arc::new(Drama3Adapter), Arc::new(IrodoriAdapter)]
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterDescriptor {
    pub id: &'static str,
    pub display_name: &'static str,
    pub capabilities: Capabilities,
    pub options: Vec<OptionSpec>,
}

pub fn describe(a: &dyn ModelAdapter) -> AdapterDescriptor {
    AdapterDescriptor { id: a.id(), display_name: a.display_name(), capabilities: a.capabilities(), options: a.option_schema() }
}

/// Copies the options the schema knows into `msg`, clamping numbers into range; returns the names dropped.
pub(crate) fn apply_options(schema: &[OptionSpec], opts: &Map<String, Value>, msg: &mut Map<String, Value>) -> Vec<String> {
    let mut dropped = Vec::new();
    for (k, v) in opts {
        if v.is_null() {
            continue;
        }
        let Some(spec) = schema.iter().find(|s| s.name == k) else {
            dropped.push(k.clone());
            continue;
        };
        let val = match spec.kind {
            "int" => v.as_f64().map(|f| {
                let f = clamp(f, spec);
                Value::from(f.round() as i64)
            }),
            "float" => v.as_f64().map(|f| Value::from(clamp(f, spec))),
            "bool" => v.as_bool().map(Value::from),
            _ => v.as_str().map(|s| Value::from(s.to_string())),
        };
        match val {
            Some(val) => {
                msg.insert(k.clone(), val);
            }
            None => dropped.push(k.clone()),
        }
    }
    dropped
}

fn clamp(f: f64, s: &OptionSpec) -> f64 {
    let mut f = f;
    if let Some(min) = s.min {
        f = f.max(min);
    }
    if let Some(max) = s.max {
        f = f.min(max);
    }
    f
}

pub(crate) fn check_family(adapter: &dyn ModelAdapter, req: &LineRequest) -> Result<(), AdapterError> {
    if let (Some(_), Some(fam)) = (&req.voice, &req.voice_family) {
        if fam != adapter.id() {
            return Err(AdapterError::VoiceFamily { voice: fam.clone(), model: adapter.id().into() });
        }
    }
    Ok(())
}

pub(crate) fn path_str(p: &std::path::Path) -> String {
    p.to_string_lossy().into_owned()
}

pub(crate) fn is_voice_file(p: &std::path::Path) -> bool {
    p.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("gguf")).unwrap_or(false)
}
