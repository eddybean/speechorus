//! Short-lived `speech` subcommands: devices, info, pull, asr, voice.

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
        let out = cmd
            .output()
            .await
            .map_err(|e| ToolError::Spawn(self.exe.into(), e))?;
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

    /// A `.gguf` path as it is; a catalog name becomes the path `speech pull` prints
    /// (fetching it first when it is not in the model folder).
    pub async fn resolve_model(&self, model: &str) -> Result<String, ToolError> {
        if is_path(model) {
            return Ok(model.to_string());
        }
        let out = self.run(&["pull".into(), model.into()]).await?;
        out.lines()
            .rev()
            .map(str::trim)
            .find(|l| !l.is_empty())
            .map(str::to_owned)
            .ok_or_else(|| ToolError::Output("speech pull printed no path".into()))
    }

    /// The text of a recording, with the recognition model given (its path or catalog name).
    pub async fn transcribe(
        &self,
        asr_model: &str,
        device: &str,
        wav: &str,
    ) -> Result<String, ToolError> {
        let model = self.resolve_model(asr_model).await?;
        let mut args = vec![
            "asr".to_string(),
            model,
            "--format".into(),
            "json".into(),
            "--language".into(),
            "ja".into(),
        ];
        if !device.is_empty() {
            args.push("--device".into());
            args.push(device.into());
        }
        args.push(wav.into());
        let out = self.run(&args).await?;
        let line = out
            .lines()
            .find(|l| l.trim_start().starts_with('{'))
            .ok_or_else(|| ToolError::Output(out.clone()))?;
        let v: Value = serde_json::from_str(line).map_err(|e| ToolError::Output(e.to_string()))?;
        Ok(v.get("text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string())
    }
}

pub fn is_path(model: &str) -> bool {
    model.to_ascii_lowercase().ends_with(".gguf") || model.contains('/') || model.contains('\\')
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
        let s = Speech {
            exe: "Z:/does/not/exist/speech.exe",
            env: &env,
        };
        assert!(matches!(s.devices().await, Err(ToolError::Spawn(..))));
    }
}
