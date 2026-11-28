//! Short-lived `speech` subcommands: devices, info, models, asr, voice.

use std::collections::BTreeMap;
use std::process::Stdio;

use serde_json::Value;
use tokio::process::Command;

use crate::engine::no_window;

#[derive(Debug, thiserror::Error)]
pub enum ToolError {
    #[error("speech.exe が設定されていません")]
    NoExe,
    #[error("{0} を起動できません: {1}")]
    Spawn(String, std::io::Error),
    #[error("speech {0} が失敗しました (exit {1}): {2}")]
    Failed(String, i32, String),
    #[error("speech の出力を読めません: {0}")]
    Output(String),
    #[error(
        "モデル「{0}」はまだダウンロードされていません。モデル画面の「カタログから入手」でダウンロードしてください"
    )]
    NotFetched(String),
    #[error("speech.cpp のカタログに「{0}」がありません")]
    Unknown(String),
}

pub struct Speech<'a> {
    pub exe: &'a str,
    pub env: &'a BTreeMap<String, String>,
}

impl Speech<'_> {
    pub async fn run(&self, args: &[String]) -> Result<String, ToolError> {
        if self.exe.trim().is_empty() {
            return Err(ToolError::NoExe);
        }
        let mut cmd = Command::new(self.exe);
        cmd.args(args)
            .env("SPEECH_NO_UPDATE_CHECK", "1")
            .envs(self.env)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        no_window(&mut cmd);
        let out = cmd.output().await.map_err(|e| ToolError::Spawn(self.exe.into(), e))?;
        let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            let tail: Vec<&str> = err.lines().rev().take(6).collect();
            let tail: Vec<&str> = tail.into_iter().rev().collect();
            return Err(ToolError::Failed(
                args.first().cloned().unwrap_or_default(),
                out.status.code().unwrap_or(-1),
                tail.join("\n"),
            ));
        }
        Ok(stdout)
    }

    async fn json(&self, args: &[&str]) -> Result<Value, ToolError> {
        let a: Vec<String> = args.iter().map(|s| s.to_string()).collect();
        let s = self.run(&a).await?;
        serde_json::from_str(s.trim()).map_err(|e| ToolError::Output(e.to_string()))
    }

    pub async fn version(&self) -> Result<String, ToolError> {
        Ok(self.run(&["--version".into()]).await?.trim().to_string())
    }

    pub async fn devices(&self) -> Result<Value, ToolError> {
        self.json(&["devices", "--json"]).await
    }

    pub async fn info(&self, model: &str) -> Result<Value, ToolError> {
        self.json(&["info", model, "--json"]).await
    }

    pub async fn catalog(&self) -> Result<Value, ToolError> {
        self.json(&["models", "--json"]).await
    }

    /// A `.gguf` path as it is; a catalog name (`NAME` or `NAME:TYPE`) becomes its file's path in the model
    /// folder. A model that is not there is an error: downloads are started by the user (D-59), never here.
    pub async fn resolve_model(&self, model: &str) -> Result<String, ToolError> {
        if is_path(model) {
            return Ok(model.to_string());
        }
        catalog_path(&self.catalog().await?, model)
    }

    /// The text of a recording, with the recognition model given (its path or catalog name).
    pub async fn transcribe(&self, asr_model: &str, device: &str, wav: &str) -> Result<String, ToolError> {
        let model = self.resolve_model(asr_model).await?;
        let mut args =
            vec!["asr".to_string(), model, "--format".into(), "json".into(), "--language".into(), "ja".into()];
        if !device.is_empty() {
            args.push("--device".into());
            args.push(device.into());
        }
        args.push(wav.into());
        let out = self.run(&args).await?;
        let line =
            out.lines().find(|l| l.trim_start().starts_with('{')).ok_or_else(|| ToolError::Output(out.clone()))?;
        let v: Value = serde_json::from_str(line).map_err(|e| ToolError::Output(e.to_string()))?;
        Ok(v.get("text").and_then(Value::as_str).unwrap_or("").trim().to_string())
    }
}

pub fn is_path(model: &str) -> bool {
    model.to_ascii_lowercase().ends_with(".gguf") || model.contains('/') || model.contains('\\')
}

/// The file of `NAME[:TYPE]` in `speech models --json` output; TYPE defaults to the model's own `type`.
pub fn catalog_file<'a>(catalog: &'a Value, model: &str) -> Option<&'a Value> {
    let (name, ty) = match model.split_once(':') {
        Some((n, t)) => (n, Some(t)),
        None => (model, None),
    };
    let m = catalog.get("models")?.as_array()?.iter().find(|m| m.get("name").and_then(Value::as_str) == Some(name))?;
    let ty = ty.or_else(|| m.get("type").and_then(Value::as_str))?;
    m.get("files")?.as_array()?.iter().find(|f| f.get("type").and_then(Value::as_str) == Some(ty))
}

/// The path of a fetched catalog model, or why there is none.
pub fn catalog_path(catalog: &Value, model: &str) -> Result<String, ToolError> {
    let f = catalog_file(catalog, model).ok_or_else(|| ToolError::Unknown(model.into()))?;
    if f.get("fetched").and_then(Value::as_bool) != Some(true) {
        return Err(ToolError::NotFetched(model.into()));
    }
    f.get("path").and_then(Value::as_str).map(str::to_owned).ok_or_else(|| ToolError::Output("models: no path".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_paths_from_catalog_names() {
        assert!(is_path(r"E:\models\Drama.gguf"));
        assert!(is_path("x.GGUF"));
        assert!(!is_path("irodori-tts-mf"));
        assert!(!is_path("drama-3:q8_0"));
    }

    #[tokio::test]
    async fn reports_a_missing_exe() {
        let env = BTreeMap::new();
        let s = Speech { exe: "", env: &env };
        assert!(matches!(s.devices().await, Err(ToolError::NoExe)));
        let s = Speech { exe: "Z:/does/not/exist/speech.exe", env: &env };
        assert!(matches!(s.devices().await, Err(ToolError::Spawn(..))));
    }

    fn catalog() -> Value {
        serde_json::json!({"models": [{
            "name": "irodori-tts-large", "type": "q8_0",
            "files": [
                {"type": "q8_0", "fetched": true, "path": "C:\\m\\large-q8.gguf"},
                {"type": "q4_k", "fetched": false, "path": "C:\\m\\large-q4.gguf"}
            ]
        }]})
    }

    #[test]
    fn resolves_fetched_catalog_models_without_fetching() {
        let c = catalog();
        assert_eq!(catalog_path(&c, "irodori-tts-large").unwrap(), r"C:\m\large-q8.gguf");
        assert_eq!(catalog_path(&c, "irodori-tts-large:q8_0").unwrap(), r"C:\m\large-q8.gguf");
        assert!(matches!(catalog_path(&c, "irodori-tts-large:q4_k"), Err(ToolError::NotFetched(_))));
        assert!(matches!(catalog_path(&c, "irodori-tts-large:f16"), Err(ToolError::Unknown(_))));
        assert!(matches!(catalog_path(&c, "nope"), Err(ToolError::Unknown(_))));
    }
}
