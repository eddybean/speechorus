use serde_json::{json, Map, Value};

use super::*;

/// Aratako's Irodori-TTS (v4.1-Small-MF, v4.1-Small, v4-Large), `architecture: irodori-tts`.
pub struct IrodoriAdapter;

/// Removes `[...]` cues and `<|speaker:N|>` tokens, which Irodori would read aloud.
pub(crate) fn strip_bracket_cues(text: &str) -> (String, usize) {
    let mut out = String::with_capacity(text.len());
    let mut removed = 0;
    let mut rest = text;
    loop {
        let b = rest.find('[');
        let s = rest.find("<|speaker:");
        let (start, close) = match (b, s) {
            (Some(b), Some(s)) if s < b => (s, "|>"),
            (Some(b), _) => (b, "]"),
            (None, Some(s)) => (s, "|>"),
            (None, None) => break,
        };
        match rest[start..].find(close) {
            Some(e) => {
                out.push_str(&rest[..start]);
                rest = &rest[start + e + close.len()..];
                removed += 1;
            }
            None => break,
        }
    }
    out.push_str(rest);
    (out.trim().to_string(), removed)
}

impl ModelAdapter for IrodoriAdapter {
    fn id(&self) -> &'static str {
        "irodori"
    }
    fn display_name(&self) -> &'static str {
        "Irodori-TTS"
    }
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            tag_syntax: "emoji",
            tag_palette: "irodori-emoji",
            design_prompt: "instructions",
            instructions: true,
            speed: true,
            multi_speaker: false,
            multi_speaker_reliable: false,
            voice_needs_transcript: false,
            voice_accepts_wav: true,
            sample_rate: 48_000,
            max_seconds_per_request: 30.0,
            license_note: "v4.1-Small / Small-MF: MIT。v4-Large: Gemma Terms of Use",
        }
    }
    fn option_schema(&self) -> Vec<OptionSpec> {
        vec![
            OptionSpec::num(
                "speed",
                "話速",
                "float",
                json!(1.0),
                0.25,
                4.0,
                0.05,
                "長さを割る値（1.2で速く）",
            ),
            OptionSpec::num(
                "steps",
                "ステップ数",
                "int",
                json!(4),
                1.0,
                100.0,
                1.0,
                "MFは4、通常版は40が既定",
            ),
            OptionSpec::num(
                "duration_scale",
                "長さ倍率",
                "float",
                json!(1.0),
                0.1,
                4.0,
                0.05,
                "予測長に掛ける（secondsとは併用不可）",
            ),
            OptionSpec::num(
                "seconds",
                "固定秒数",
                "float",
                Value::Null,
                0.5,
                30.0,
                0.1,
                "予測の代わりに長さを固定",
            ),
            OptionSpec {
                name: "keep_tail",
                label: "末尾を残す",
                kind: "bool",
                default: json!(false),
                min: None,
                max: None,
                step: None,
                help: "無音で切らず全長を残す",
            },
            OptionSpec::num(
                "cfg_scale_text",
                "CFG テキスト",
                "float",
                json!(3.0),
                0.0,
                10.0,
                0.1,
                "通常版/Largeのみ",
            ),
            OptionSpec::num(
                "cfg_scale_speaker",
                "CFG 話者",
                "float",
                json!(5.0),
                0.0,
                10.0,
                0.1,
                "通常版/Largeのみ",
            ),
            OptionSpec::num(
                "speaker_kv_scale",
                "話者追従",
                "float",
                json!(1.0),
                0.0,
                4.0,
                0.05,
                "1より大きいと参照音声に近づく（通常版/Large）",
            ),
        ]
    }
    fn build_request(&self, req: &LineRequest) -> Result<BuiltRequest, AdapterError> {
        check_family(self, req)?;
        let (text, removed) = strip_bracket_cues(&req.text);
        if text.is_empty() {
            return Err(AdapterError::EmptyText);
        }
        let mut msg = Map::new();
        msg.insert("type".into(), "synthesize".into());
        msg.insert("text".into(), text.into());
        msg.insert(
            "voice".into(),
            Value::from(req.voice.clone().unwrap_or_else(|| "none".into())),
        );
        if let Some(s) = req.seed {
            msg.insert("seed".into(), s.into());
        }
        let mut warnings = Vec::new();
        if removed > 0 {
            warnings.push(format!("Irodori は [..] タグを読まないため {removed} 個を取り除きました（絵文字タグを使ってください）"));
        }
        let mut opts = req.options.clone();
        if let Some(i) = opts.remove("instructions") {
            if let Some(s) = i.as_str().filter(|s| !s.trim().is_empty()) {
                msg.insert("instructions".into(), s.trim().into());
            }
        }
        if let Some(p) = req
            .design_prompt
            .as_deref()
            .map(str::trim)
            .filter(|p| !p.is_empty())
        {
            msg.insert("instructions".into(), p.into());
        }
        // `seconds` and `duration_scale` contradict each other; `seconds` wins.
        if opts.get("seconds").map(|v| !v.is_null()).unwrap_or(false) {
            opts.remove("duration_scale");
        }
        let dropped = apply_options(&self.option_schema(), &opts, &mut msg);
        warnings.extend(
            dropped
                .into_iter()
                .map(|d| format!("Irodori は `{d}` を受け付けないため無視しました")),
        );
        Ok(BuiltRequest { msg, warnings })
    }
    fn prepare_voice(&self, b: &VoiceBuild) -> Result<Vec<String>, AdapterError> {
        if b.inputs.is_empty() {
            return Err(AdapterError::Unsupported("参照音声がありません".into()));
        }
        if b.inputs.iter().any(|i| i.speaker.is_some()) {
            return Err(AdapterError::Unsupported(
                "Irodori-TTS は複数話者ボイスを作れません".into(),
            ));
        }
        let mut args = vec!["voice".to_string(), b.model.clone()];
        args.extend(b.inputs.iter().map(|i| path_str(&i.path)));
        args.push(path_str(&b.out));
        Ok(args)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn strips_cues_keeps_emoji() {
        assert_eq!(
            strip_bracket_cues("[笑い]🤭ふふ、[小声で]そうなんだ。"),
            ("🤭ふふ、そうなんだ。".to_string(), 2)
        );
        assert_eq!(
            strip_bracket_cues("<|speaker:1|> こんにちは"),
            ("こんにちは".to_string(), 1)
        );
        assert_eq!(
            strip_bracket_cues("閉じない[括弧"),
            ("閉じない[括弧".to_string(), 0)
        );
    }

    #[test]
    fn instructions_speed_steps() {
        let r = LineRequest {
            text: "😮‍💨はあ、疲れた。".into(),
            design_prompt: Some("低く落ち着いた男性の声で".into()),
            options: serde_json::from_str(
                r#"{"speed":1.25,"steps":8,"top_k":5,"seconds":3,"duration_scale":2}"#,
            )
            .unwrap(),
            seed: Some(7),
            ..Default::default()
        };
        let b = IrodoriAdapter.build_request(&r).unwrap();
        assert_eq!(b.msg["instructions"], "低く落ち着いた男性の声で");
        assert_eq!(b.msg["speed"], 1.25);
        assert_eq!(b.msg["steps"], 8);
        assert_eq!(b.msg["seconds"], 3.0);
        assert!(!b.msg.contains_key("duration_scale"));
        assert!(!b.msg.contains_key("top_k"));
        assert_eq!(b.msg["text"], "😮‍💨はあ、疲れた。");
        assert_eq!(b.warnings.len(), 1);
    }

    #[test]
    fn voice_args() {
        let b = VoiceBuild {
            model: "iro.gguf".into(),
            inputs: vec![VoiceInput {
                path: PathBuf::from("a.wav"),
                transcript: Some("ignored".into()),
                speaker: None,
            }],
            out: PathBuf::from("a.voice.gguf"),
        };
        assert_eq!(
            IrodoriAdapter.prepare_voice(&b).unwrap(),
            ["voice", "iro.gguf", "a.wav", "a.voice.gguf"]
        );
    }
}
