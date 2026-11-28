//! The voice library: `.voice.gguf` files made with `speech voice`, kept in the app data folder.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::models::{ModelAdapter, VoiceBuild, VoiceInput};
use crate::stored;

/// The format of `voices.json` this version writes (D-61). Version 0 was the bare list of voices.
pub const VOICES_VERSION: u32 = 1;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Voice {
    pub id: String,
    pub name: String,
    /// The adapter id whose codec made it (`drama3` / `irodori`).
    pub family: String,
    /// Absolute path of the voice file.
    pub file: String,
    pub sources: Vec<VoiceInput>,
    pub speakers: u32,
    /// For a cast voice put together from others: their ids, speaker 0, 1, …
    pub combined_from: Vec<String>,
    pub created_at: u64,
    pub note: String,
    /// A voice described in words only (no file): Drama-3 writes it as a leading cue with `voice none`,
    /// Irodori sends it as `instructions`.
    pub prompt: String,
    /// Members a later version added; kept as they are.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Voice {
    /// The name the worker knows it by.
    pub fn worker_name(&self) -> String {
        format!("v{}", self.id.replace('-', ""))
    }
}

pub struct VoiceLibrary {
    pub dir: PathBuf,
    pub voices: Vec<Voice>,
    /// Top-level members of `voices.json` a later version added; kept as they are.
    extra: Map<String, Value>,
}

/// `voices.json`.
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct VoicesFile {
    version: u32,
    voices: Vec<Voice>,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

/// Upgrades `voices.json` from version `from` to `from + 1`.
fn migrate(v: &mut Value, from: u32) -> Result<(), String> {
    match from {
        // The bare list becomes `{version, voices}`.
        0 => *v = serde_json::json!({ "version": 1, "voices": v.take() }),
        _ => return Err(format!("v{from} からの変換方法がありません")),
    }
    Ok(())
}

fn version_of(v: &Value) -> u32 {
    if v.is_array() {
        0
    } else {
        stored::version_member(v, VOICES_VERSION)
    }
}

impl VoiceLibrary {
    /// Opens the library, with a notice for the user when `voices.json` was unreadable (and moved aside) or newer.
    pub fn open(dir: &Path) -> (Self, Option<String>) {
        let l: stored::Loaded<VoicesFile> =
            stored::load(&dir.join("voices.json"), VOICES_VERSION, version_of, migrate, "声ライブラリ (voices.json)");
        let f = l.value.unwrap_or_default();
        (VoiceLibrary { dir: dir.to_path_buf(), voices: f.voices, extra: f.extra }, l.notice)
    }

    pub fn save(&self) -> std::io::Result<()> {
        std::fs::create_dir_all(&self.dir)?;
        let f = VoicesFile { version: VOICES_VERSION, voices: self.voices.clone(), extra: self.extra.clone() };
        crate::project::write_atomic(&self.dir.join("voices.json"), serde_json::to_string_pretty(&f)?.as_bytes())
    }

    pub fn get(&self, id: &str) -> Option<&Voice> {
        self.voices.iter().find(|v| v.id == id)
    }

    /// Plans a new voice: copies the references into the library and returns the build and the record to keep once it is made.
    pub fn plan(
        &self,
        adapter: &dyn ModelAdapter,
        model: &str,
        name: &str,
        inputs: Vec<VoiceInput>,
    ) -> std::io::Result<(VoiceBuild, Voice)> {
        let id = uuid::Uuid::new_v4().to_string();
        let refs = self.dir.join("refs");
        std::fs::create_dir_all(&refs)?;
        let mut kept = Vec::new();
        for (n, i) in inputs.into_iter().enumerate() {
            let ext = i.path.extension().and_then(|e| e.to_str()).unwrap_or("wav").to_string();
            let dst = refs.join(format!("{id}-{n}.{ext}"));
            std::fs::copy(&i.path, &dst)?;
            kept.push(VoiceInput { path: dst, ..i });
        }
        let file = self.dir.join(format!("{id}.voice.gguf"));
        let voice = Voice {
            id,
            name: name.into(),
            family: adapter.id().into(),
            file: file.to_string_lossy().into_owned(),
            speakers: 1,
            sources: kept.clone(),
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            ..Default::default()
        };
        Ok((VoiceBuild { model: model.into(), inputs: kept, out: file }, voice))
    }

    /// Plans a cast voice whose speaker N is `ids[N]` (a None leaves that speaker to the model).
    /// An existing combination of the same voices is reused.
    pub fn plan_combined(&self, model: &str, ids: &[Option<String>]) -> Result<CombinePlan, String> {
        let mut inputs = Vec::new();
        let mut from = Vec::new();
        for (n, id) in ids.iter().enumerate() {
            let Some(id) = id else { continue };
            let v = self.get(id).ok_or_else(|| format!("ボイス {id} がありません"))?;
            if v.file.is_empty() {
                // A description alone has no recordings: that speaker is left to the model (its cue goes in the text).
                continue;
            }
            if v.family != "drama3" {
                return Err(format!("{} は Drama-3 のボイスではありません", v.name));
            }
            inputs.push(VoiceInput { path: PathBuf::from(&v.file), transcript: None, speaker: Some(n as u32) });
            from.push(format!("{n}:{id}"));
        }
        if inputs.is_empty() {
            return Ok(CombinePlan::NoneNeeded);
        }
        if let Some(v) = self.voices.iter().find(|v| v.combined_from == from) {
            if Path::new(&v.file).exists() {
                return Ok(CombinePlan::Existing(v.clone()));
            }
        }
        let id = uuid::Uuid::new_v4().to_string();
        let file = self.dir.join(format!("{id}.voice.gguf"));
        let names: Vec<String> = ids
            .iter()
            .map(|i| i.as_ref().and_then(|i| self.get(i)).map(|v| v.name.clone()).unwrap_or_else(|| "-".into()))
            .collect();
        let voice = Voice {
            id,
            name: format!("キャスト: {}", names.join(" / ")),
            family: "drama3".into(),
            file: file.to_string_lossy().into_owned(),
            speakers: ids.len() as u32,
            combined_from: from,
            ..Default::default()
        };
        Ok(CombinePlan::Build(VoiceBuild { model: model.into(), inputs, out: file }, voice))
    }

    pub fn insert(&mut self, v: Voice) -> std::io::Result<()> {
        self.voices.retain(|x| x.id != v.id);
        self.voices.push(v);
        self.save()
    }

    pub fn remove(&mut self, id: &str) -> std::io::Result<()> {
        if let Some(v) = self.get(id).cloned() {
            let _ = std::fs::remove_file(&v.file);
            for s in &v.sources {
                if s.path.starts_with(&self.dir) {
                    let _ = std::fs::remove_file(&s.path);
                }
            }
        }
        self.voices.retain(|x| x.id != id);
        self.save()
    }
}

impl VoiceLibrary {
    /// Records a voice that is a description alone.
    pub fn add_prompt_voice(&mut self, family: &str, name: &str, prompt: &str, note: &str) -> std::io::Result<Voice> {
        let v = Voice {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.into(),
            family: family.into(),
            speakers: 1,
            prompt: prompt.trim().into(),
            note: note.into(),
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            ..Default::default()
        };
        self.insert(v.clone())?;
        Ok(v)
    }
}

pub enum CombinePlan {
    NoneNeeded,
    Existing(Voice),
    Build(VoiceBuild, Voice),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Drama3Adapter, ModelAdapter};

    #[test]
    fn plans_copy_refs_and_combinations_are_reused() {
        let d = tempfile::tempdir().unwrap();
        let wav = d.path().join("me.wav");
        std::fs::write(&wav, b"RIFF").unwrap();
        let mut lib = VoiceLibrary::open(&d.path().join("lib")).0;
        let (b, v) = lib
            .plan(
                &Drama3Adapter,
                "m.gguf",
                "私",
                vec![VoiceInput { path: wav, transcript: Some("こんにちは".into()), speaker: None }],
            )
            .unwrap();
        assert!(b.inputs[0].path.starts_with(&lib.dir));
        assert!(b.inputs[0].path.exists());
        let args = Drama3Adapter.prepare_voice(&b).unwrap();
        assert_eq!(args[4], "--transcript");
        assert_eq!(v.family, "drama3");
        std::fs::write(&v.file, b"GGUF").unwrap();
        let vid = v.id.clone();
        lib.insert(v).unwrap();
        assert!(VoiceLibrary::open(&lib.dir).0.get(&vid).is_some());

        let plan = lib.plan_combined("m.gguf", &[None, Some(vid.clone())]).unwrap();
        let CombinePlan::Build(b, cv) = plan else { panic!() };
        assert_eq!(b.inputs[0].speaker, Some(1));
        assert_eq!(cv.speakers, 2);
        std::fs::write(&cv.file, b"GGUF").unwrap();
        let cid = cv.id.clone();
        lib.insert(cv).unwrap();
        assert!(
            matches!(lib.plan_combined("m.gguf", &[None, Some(vid.clone())]).unwrap(), CombinePlan::Existing(v) if v.id == cid)
        );
        assert!(matches!(lib.plan_combined("m.gguf", &[None, None]).unwrap(), CombinePlan::NoneNeeded));
        lib.remove(&vid).unwrap();
        assert!(lib.get(&vid).is_none());

        let pv = lib.add_prompt_voice("drama3", "落ち着いた女性", " 落ち着いた25歳の女性。 ", "").unwrap();
        assert_eq!(pv.prompt, "落ち着いた25歳の女性。");
        assert!(pv.file.is_empty());
        assert!(matches!(lib.plan_combined("m.gguf", &[Some(pv.id.clone())]).unwrap(), CombinePlan::NoneNeeded));
        assert_eq!(VoiceLibrary::open(&lib.dir).0.get(&pv.id).unwrap().prompt, "落ち着いた25歳の女性。");
    }

    #[test]
    fn reads_the_old_bare_list_and_saves_the_versioned_form() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("voices.json"), r#"[{"id":"a","name":"私","family":"drama3","speakers":1}]"#)
            .unwrap();
        let (lib, notice) = VoiceLibrary::open(d.path());
        assert!(notice.is_none());
        assert_eq!(lib.get("a").unwrap().name, "私");
        lib.save().unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(d.path().join("voices.json")).unwrap()).unwrap();
        assert_eq!(v["version"], VOICES_VERSION);
        assert_eq!(v["voices"][0]["id"], "a");
    }

    #[test]
    fn an_unreadable_list_is_moved_aside() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("voices.json"), "[{").unwrap();
        let (lib, notice) = VoiceLibrary::open(d.path());
        assert!(lib.voices.is_empty());
        assert!(notice.unwrap().contains("voices.json.broken-"));
        assert!(!d.path().join("voices.json").exists());
    }

    #[test]
    fn newer_members_survive_a_save() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(
            d.path().join("voices.json"),
            r#"{"version":5,"folders":["x"],"voices":[{"id":"a","name":"n","tags":["t"]}]}"#,
        )
        .unwrap();
        let (lib, notice) = VoiceLibrary::open(d.path());
        assert!(notice.unwrap().contains("v5"));
        lib.save().unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(d.path().join("voices.json")).unwrap()).unwrap();
        assert_eq!(v["folders"][0], "x");
        assert_eq!(v["voices"][0]["tags"][0], "t");
    }
}
