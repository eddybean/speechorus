//! `.vsproj` (JSON) and its `<name>.takes/` folder.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::jobs::TakeResult;

pub const PROJECT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Project {
    pub version: u32,
    pub name: String,
    pub model_profile_id: Option<String>,
    pub cast: Vec<Cast>,
    pub lines: Vec<Line>,
    pub scenes: Vec<Scene>,
    pub export_settings: ExportSettings,
    /// Members a later version added; kept as they are.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Default for Project {
    fn default() -> Self {
        Project {
            version: PROJECT_VERSION,
            name: "untitled".into(),
            model_profile_id: None,
            cast: Vec::new(),
            lines: Vec::new(),
            scenes: Vec::new(),
            export_settings: ExportSettings::default(),
            extra: Map::new(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Cast {
    pub id: String,
    pub name: String,
    /// A voice library id, or None for `voice none` (with the design prompt alone).
    pub voice_id: Option<String>,
    pub design_prompt: String,
    pub default_options: Map<String, Value>,
    pub color: String,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Line {
    pub id: String,
    pub cast_id: Option<String>,
    pub text: String,
    pub options_override: Map<String, Value>,
    pub pre_silence: f64,
    pub post_silence: f64,
    pub takes: Vec<TakeResult>,
    pub selected_take_id: Option<String>,
    pub memo: String,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Line {
    pub fn selected_take(&self) -> Option<&TakeResult> {
        self.selected_take_id
            .as_ref()
            .and_then(|id| self.takes.iter().find(|t| &t.id == id))
            .or_else(|| self.takes.last())
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Scene {
    pub id: String,
    pub name: String,
    pub line_ids: Vec<String>,
    /// `single` (one `<|speaker:N|>` request) or `perLine`.
    pub mode: String,
    pub takes: Vec<TakeResult>,
    pub selected_take_id: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ExportSettings {
    pub file_template: String,
    pub out_dir: String,
    pub default_pre_silence: f64,
    pub default_post_silence: f64,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Default for ExportSettings {
    fn default() -> Self {
        ExportSettings {
            file_template: "{index}_{cast}_{text8}".into(),
            out_dir: String::new(),
            default_pre_silence: 0.0,
            default_post_silence: 0.3,
            extra: Map::new(),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ProjectError {
    #[error("{0}: {1}")]
    Io(String, std::io::Error),
    #[error("プロジェクトを読めません: {0}")]
    Json(#[from] serde_json::Error),
    #[error("このプロジェクトは新しいバージョン ({0}) で保存されています")]
    TooNew(u32),
}

/// `dir/name.vsproj` → `dir/name.takes`.
pub fn takes_dir_for(project_path: &Path) -> PathBuf {
    project_path.with_extension("takes")
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension(format!("{}.tmp", path.extension().and_then(|e| e.to_str()).unwrap_or("")));
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)
}

fn take_files(p: &Project) -> impl Iterator<Item = &str> + '_ {
    p.lines
        .iter()
        .flat_map(|l| l.takes.iter())
        .chain(p.scenes.iter().flat_map(|s| s.takes.iter()))
        .map(|t| t.file.as_str())
}

/// Writes the project and makes sure every take it names is in its takes folder,
/// copying them from `from_takes_dir` (an untitled project's work folder, or the old location after Save As).
/// `extra` names more files to copy along: takes the UI's Undo history can bring back (D-40).
pub fn save_project(
    path: &Path,
    project: &Project,
    from_takes_dir: Option<&Path>,
    extra: &[String],
) -> Result<PathBuf, ProjectError> {
    let io = |p: &Path, e| ProjectError::Io(p.display().to_string(), e);
    let dir = takes_dir_for(path);
    std::fs::create_dir_all(&dir).map_err(|e| io(&dir, e))?;
    if let Some(from) = from_takes_dir.filter(|f| *f != dir.as_path()) {
        for f in take_files(project).chain(extra.iter().map(String::as_str)) {
            if !is_plain_name(f) {
                continue;
            }
            let src = from.join(f);
            let dst = dir.join(f);
            if src.exists() && !dst.exists() {
                std::fs::copy(&src, &dst).map_err(|e| io(&src, e))?;
            }
        }
    }
    let mut p = project.clone();
    p.version = PROJECT_VERSION;
    let json = serde_json::to_vec_pretty(&p)?;
    write_atomic(path, &json).map_err(|e| io(path, e))?;
    Ok(dir)
}

pub fn load_project(path: &Path) -> Result<(Project, PathBuf), ProjectError> {
    let s = std::fs::read_to_string(path).map_err(|e| ProjectError::Io(path.display().to_string(), e))?;
    let p: Project = serde_json::from_str(&s)?;
    if p.version > PROJECT_VERSION {
        return Err(ProjectError::TooNew(p.version));
    }
    Ok((p, takes_dir_for(path)))
}

/// A bare file name, so a name from the UI cannot reach outside the takes folder.
fn is_plain_name(f: &str) -> bool {
    !f.is_empty() && Path::new(f).file_name().and_then(|n| n.to_str()) == Some(f)
}

/// Removes WAV files in the takes folder that no take of the project (nor `extra`) names, except `busy` (a take
/// being written).
pub fn prune_orphans(project: &Project, takes_dir: &Path, busy: Option<&Path>, extra: &[String]) -> usize {
    let keep: std::collections::HashSet<&str> = take_files(project).chain(extra.iter().map(String::as_str)).collect();
    // The same file may be named by different spellings of the folder, so compare resolved paths.
    let busy = busy.and_then(|b| b.canonicalize().ok());
    let Ok(rd) = std::fs::read_dir(takes_dir) else {
        return 0;
    };
    let mut n = 0;
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if name.ends_with(".wav")
            && !keep.contains(name.as_str())
            && (busy.is_none() || e.path().canonicalize().ok() != busy)
            && std::fs::remove_file(e.path()).is_ok()
        {
            n += 1;
        }
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    fn take(file: &str) -> TakeResult {
        TakeResult {
            id: file.into(),
            seed: Some(1),
            options_snapshot: Map::new(),
            file: file.into(),
            duration: 1.0,
            sample_rate: 44100,
            stop_reason: "complete".into(),
            created_at: 0,
            starred: false,
            text: "t".into(),
        }
    }

    #[test]
    fn json_shape_is_camel_case_and_round_trips() {
        let mut p = Project::default();
        p.lines.push(Line {
            id: "l1".into(),
            text: "[囁き]ねえ".into(),
            pre_silence: 0.1,
            takes: vec![take("a.wav")],
            selected_take_id: Some("a.wav".into()),
            ..Default::default()
        });
        p.extra.insert("futureField".into(), Value::from(5));
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["lines"][0]["preSilence"], 0.1);
        assert_eq!(v["lines"][0]["takes"][0]["stopReason"], "complete");
        assert_eq!(v["futureField"], 5);
        let back: Project = serde_json::from_value(v).unwrap();
        assert_eq!(back, p);
    }

    #[test]
    fn save_as_copies_takes_and_load_refuses_newer() {
        let work = tempfile::tempdir().unwrap();
        std::fs::write(work.path().join("a.wav"), b"RIFF").unwrap();
        std::fs::write(work.path().join("orphan.wav"), b"RIFF").unwrap();
        let mut p = Project::default();
        p.lines.push(Line { id: "l".into(), takes: vec![take("a.wav")], ..Default::default() });
        let out = tempfile::tempdir().unwrap();
        let path = out.path().join("drama.vsproj");
        std::fs::write(work.path().join("undo.wav"), b"RIFF").unwrap();
        let dir = save_project(&path, &p, Some(work.path()), &["undo.wav".into(), "../evil.wav".into()]).unwrap();
        assert!(dir.join("undo.wav").exists());
        assert_eq!(dir, out.path().join("drama.takes"));
        assert!(dir.join("a.wav").exists());
        assert!(!dir.join("orphan.wav").exists());
        let (q, d2) = load_project(&path).unwrap();
        assert_eq!(q, p);
        assert_eq!(d2, dir);
        std::fs::write(dir.join("stale.wav"), b"x").unwrap();
        std::fs::write(dir.join("writing.wav"), b"x").unwrap();
        assert_eq!(prune_orphans(&q, &dir, Some(&dir.join("writing.wav")), &["undo.wav".into()]), 1);
        assert!(dir.join("undo.wav").exists());
        assert!(dir.join("a.wav").exists());
        assert!(dir.join("writing.wav").exists());
        std::fs::write(&path, r#"{"version":99}"#).unwrap();
        assert!(matches!(load_project(&path), Err(ProjectError::TooNew(99))));
    }
}
