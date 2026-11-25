//! App settings: model profiles and preferences, stored as JSON in the app config folder.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::models::adapter_for;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ModelProfile {
    pub id: String,
    pub name: String,
    /// `drama3` or `irodori`.
    pub adapter: String,
    /// A `.gguf` path, or a catalog name (`irodori-tts-mf`) resolved with `speech pull`.
    pub model: String,
    pub speech_exe: String,
    pub device: String,
    pub threads: Option<u32>,
    pub env: BTreeMap<String, String>,
    pub extra_args: Vec<String>,
}

impl Default for ModelProfile {
    fn default() -> Self {
        ModelProfile {
            id: String::new(),
            name: String::new(),
            adapter: "drama3".into(),
            model: String::new(),
            speech_exe: String::new(),
            device: "Vulkan0".into(),
            threads: None,
            env: BTreeMap::new(),
            extra_args: Vec::new(),
        }
    }
}

impl ModelProfile {
    pub fn new(id: &str, name: &str, adapter: &str, model: &str, speech_exe: &str) -> Self {
        let env = adapter_for(adapter)
            .map(|a| a.default_env().into_iter().collect())
            .unwrap_or_default();
        ModelProfile {
            id: id.into(),
            name: name.into(),
            adapter: adapter.into(),
            model: model.into(),
            speech_exe: speech_exe.into(),
            env,
            ..Default::default()
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub version: u32,
    pub profiles: Vec<ModelProfile>,
    pub active_profile_id: Option<String>,
    /// Default speech.exe for new profiles and for `asr` / `voice` / `devices`.
    pub speech_exe: String,
    pub asr_model: String,
    pub asr_device: String,
    pub show_nsfw_tags: bool,
    pub theme: String,
    pub recent_tags: Vec<String>,
    pub recent_projects: Vec<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            version: 1,
            profiles: Vec::new(),
            active_profile_id: None,
            speech_exe: String::new(),
            asr_model: "qwen3-asr-0.6b".into(),
            asr_device: "auto".into(),
            show_nsfw_tags: false,
            theme: "dark".into(),
            recent_tags: Vec::new(),
            recent_projects: Vec::new(),
        }
    }
}

impl AppSettings {
    /// Settings for a first run: one Drama-3 and one Irodori profile, with paths to fill in.
    pub fn first_run(speech_exe: &str) -> Self {
        let mut s = AppSettings {
            speech_exe: speech_exe.into(),
            ..Default::default()
        };
        s.profiles.push(ModelProfile::new(
            "drama3-ja-q4k",
            "Drama-3-Japanese Q4_K (Vulkan)",
            "drama3",
            "",
            speech_exe,
        ));
        s.profiles.push(ModelProfile::new(
            "irodori-mf",
            "Irodori-TTS v4.1 Small-MF",
            "irodori",
            "irodori-tts-mf",
            speech_exe,
        ));
        s.active_profile_id = Some("drama3-ja-q4k".into());
        s
    }

    pub fn profile(&self, id: &str) -> Option<&ModelProfile> {
        self.profiles.iter().find(|p| p.id == id)
    }

    pub fn load(path: &Path) -> Option<Self> {
        let s = std::fs::read_to_string(path).ok()?;
        serde_json::from_str(&s).ok()
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(d) = path.parent() {
            std::fs::create_dir_all(d)?;
        }
        crate::project::write_atomic(path, serde_json::to_string_pretty(self)?.as_bytes())
    }

    pub fn push_recent_project(&mut self, p: &str) {
        self.recent_projects.retain(|x| x != p);
        self.recent_projects.insert(0, p.into());
        self.recent_projects.truncate(10);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_run_profiles_have_vulkan_env_for_drama() {
        let s = AppSettings::first_run("speech.exe");
        let d = s.profile("drama3-ja-q4k").unwrap();
        assert_eq!(
            d.env.get("GGML_VK_DISABLE_COOPMAT2").map(String::as_str),
            Some("1")
        );
        assert_eq!(d.env.len(), 3);
        assert!(s.profile("irodori-mf").unwrap().env.is_empty());
    }

    #[test]
    fn round_trips_and_tolerates_missing_fields() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        let mut s = AppSettings::first_run("x.exe");
        s.push_recent_project("a.vsproj");
        s.push_recent_project("b.vsproj");
        s.push_recent_project("a.vsproj");
        s.save(&p).unwrap();
        assert_eq!(AppSettings::load(&p).unwrap(), s);
        assert_eq!(s.recent_projects, ["a.vsproj", "b.vsproj"]);
        let partial: AppSettings = serde_json::from_str(r#"{"showNsfwTags":true}"#).unwrap();
        assert!(partial.show_nsfw_tags);
        assert_eq!(partial.asr_model, "qwen3-asr-0.6b");
    }
}
