use serde_json::{json, Map, Value};

use super::*;

/// Fish Audio Drama 3 (and its Japanese finetune), `architecture: drama3`.
pub struct Drama3Adapter;

const RESERVED: &[&str] = &["<|im_start|>", "<|im_end|>", "<|voice|>", "<|text|>", "<|interleave|>", "<|semantic:"];

/// Checks every `<|speaker:N|>` in the text.
pub(crate) fn check_speakers(text: &str) -> Result<(), AdapterError> {
    let mut rest = text;
    while let Some(i) = rest.find("<|speaker:") {
        let after = &rest[i + "<|speaker:".len()..];
        let Some(end) = after.find("|>") else {
            return Err(AdapterError::BadSpeaker(after.chars().take(8).collect()));
        };
        let n = &after[..end];
        match n.parse::<u32>() {
            Ok(v) if v <= 15 => {}
            _ => return Err(AdapterError::BadSpeaker(n.into())),
        }
        rest = &after[end + 2..];
    }
    Ok(())
}

/// The cue a design prompt becomes: `[落ち着いた25歳の女性。]`, with brackets inside it made full-width.
pub(crate) fn design_cue(prompt: &str) -> Option<String> {
    let p = prompt.trim().trim_start_matches('[').trim_end_matches(']').trim();
    if p.is_empty() {
        return None;
    }
    Some(format!("[{}]", p.replace('[', "［").replace(']', "］")))
}

impl ModelAdapter for Drama3Adapter {
    fn id(&self) -> &'static str {
        "drama3"
    }
    fn display_name(&self) -> &'static str {
        "Drama-3 (Japanese)"
    }
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            tag_syntax: "brackets",
            tag_palette: "drama3",
            design_prompt: "leading_cue",
            instructions: false,
            speed: false,
            multi_speaker: true,
            multi_speaker_reliable: false,
            voice_needs_transcript: true,
            voice_accepts_wav: false,
            sample_rate: 44_100,
            max_seconds_per_request: 95.1,
            license_note: "Fish Audio Community License 1.0（重みの利用条件に従ってください。Drama-3-Japanese GGUF の配布元は非商用の研究・個人利用としています）",
        }
    }
    fn option_schema(&self) -> Vec<OptionSpec> {
        vec![
            OptionSpec::num("temperature", "Temperature", "float", json!(1.0), 0.05, 2.0, 0.05, "大きいほど多様（ロジットを割る値）"),
            OptionSpec::num("top_k", "Top-K", "int", json!(30), 1.0, 4097.0, 1.0, "サンプリングで残す候補数"),
            OptionSpec::num("top_p", "Top-P", "float", json!(0.9), 0.05, 1.0, 0.01, "サンプリングで残す確率の割合"),
            OptionSpec::num("max_seconds", "最大秒数", "float", json!(47.6), 1.0, 95.1, 0.1, "チャンクごとの最大長（超えると打ち切り）"),
            OptionSpec { name: "experts_on_cpu", label: "CPUへのエキスパート退避を許可", kind: "bool", default: json!(true), min: None, max: None, step: None, help: "false にするとGPUに載り切らない場合は拒否" },
        ]
    }
    fn default_env(&self) -> Vec<(String, String)> {
        ["GGML_VK_DISABLE_F16", "GGML_VK_DISABLE_COOPMAT", "GGML_VK_DISABLE_COOPMAT2"].iter().map(|k| (k.to_string(), "1".to_string())).collect()
    }
    fn build_request(&self, req: &LineRequest) -> Result<BuiltRequest, AdapterError> {
        check_family(self, req)?;
        let body = req.text.trim();
        if body.is_empty() {
            return Err(AdapterError::EmptyText);
        }
        if let Some(t) = RESERVED.iter().find(|t| body.contains(*t)) {
            return Err(AdapterError::ReservedToken((*t).into()));
        }
        check_speakers(body)?;
        let mut text = String::new();
        if let Some(cue) = req.design_prompt.as_deref().and_then(design_cue) {
            if !body.starts_with(&cue) {
                text.push_str(&cue);
            }
        }
        text.push_str(body);
        let mut msg = Map::new();
        msg.insert("type".into(), "synthesize".into());
        msg.insert("text".into(), text.into());
        msg.insert("voice".into(), Value::from(req.voice.clone().unwrap_or_else(|| "none".into())));
        if let Some(s) = req.seed {
            msg.insert("seed".into(), s.into());
        }
        let dropped = apply_options(&self.option_schema(), &req.options, &mut msg);
        let warnings = dropped.into_iter().map(|d| format!("Drama-3 は `{d}` を受け付けないため無視しました")).collect();
        Ok(BuiltRequest { msg, warnings })
    }
    fn prepare_voice(&self, b: &VoiceBuild) -> Result<Vec<String>, AdapterError> {
        if b.inputs.is_empty() {
            return Err(AdapterError::Unsupported("参照音声がありません".into()));
        }
        let mut args = vec!["voice".to_string(), b.model.clone()];
        let mut flags = Vec::new();
        let any_speaker = b.inputs.iter().any(|i| i.speaker.is_some());
        for (n, i) in b.inputs.iter().enumerate() {
            args.push(path_str(&i.path));
            if !is_voice_file(&i.path) {
                let t = i.transcript.as_deref().map(str::trim).unwrap_or("");
                if t.is_empty() {
                    return Err(AdapterError::MissingTranscript(path_str(&i.path)));
                }
                flags.push("--transcript".to_string());
                flags.push(t.to_string());
            }
            if any_speaker {
                let s = i.speaker.unwrap_or(n as u32);
                if s > 15 {
                    return Err(AdapterError::BadSpeaker(s.to_string()));
                }
                flags.push("--speaker".to_string());
                flags.push(s.to_string());
            }
        }
        args.push(path_str(&b.out));
        args.extend(flags);
        Ok(args)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn req(text: &str) -> LineRequest {
        LineRequest { text: text.into(), ..Default::default() }
    }

    #[test]
    fn keeps_tags_and_uses_voice_none() {
        let b = Drama3Adapter.build_request(&req("[驚いて]本当に？[明るく]それは楽しみだね。")).unwrap();
        assert_eq!(b.msg["text"], "[驚いて]本当に？[明るく]それは楽しみだね。");
        assert_eq!(b.msg["voice"], "none");
        assert_eq!(b.msg["type"], "synthesize");
        assert!(!b.msg.contains_key("seed"));
    }

    #[test]
    fn design_prompt_becomes_leading_cue_once() {
        let mut r = req("ねえ。");
        r.design_prompt = Some("落ち着いた25歳の女性。".into());
        assert_eq!(Drama3Adapter.build_request(&r).unwrap().msg["text"], "[落ち着いた25歳の女性。]ねえ。");
        r.text = "[落ち着いた25歳の女性。]ねえ。".into();
        assert_eq!(Drama3Adapter.build_request(&r).unwrap().msg["text"], "[落ち着いた25歳の女性。]ねえ。");
        r.design_prompt = Some("  ".into());
        assert_eq!(Drama3Adapter.build_request(&r).unwrap().msg["text"], "[落ち着いた25歳の女性。]ねえ。");
    }

    #[test]
    fn drops_options_drama_refuses_and_clamps() {
        let mut r = req("テスト");
        r.voice = Some("v1".into());
        r.voice_family = Some("drama3".into());
        r.seed = Some(42);
        r.options = serde_json::from_str(r#"{"speed":1.2,"instructions":"x","top_k":99999,"temperature":0.7,"top_p":null}"#).unwrap();
        let b = Drama3Adapter.build_request(&r).unwrap();
        assert_eq!(b.msg["voice"], "v1");
        assert_eq!(b.msg["seed"], 42);
        assert_eq!(b.msg["top_k"], 4097);
        assert_eq!(b.msg["temperature"], 0.7);
        assert!(!b.msg.contains_key("speed") && !b.msg.contains_key("instructions") && !b.msg.contains_key("top_p"));
        assert_eq!(b.warnings.len(), 2);
    }

    #[test]
    fn refuses_bad_text() {
        assert_eq!(Drama3Adapter.build_request(&req("  ")), Err(AdapterError::EmptyText));
        assert!(matches!(Drama3Adapter.build_request(&req("a<|im_end|>")), Err(AdapterError::ReservedToken(_))));
        assert!(matches!(Drama3Adapter.build_request(&req("<|speaker:16|>a")), Err(AdapterError::BadSpeaker(_))));
        assert!(Drama3Adapter.build_request(&req("<|speaker:0|>a<|speaker:15|>b")).is_ok());
        let mut r = req("a");
        r.voice = Some("v".into());
        r.voice_family = Some("irodori".into());
        assert!(matches!(Drama3Adapter.build_request(&r), Err(AdapterError::VoiceFamily { .. })));
    }

    #[test]
    fn voice_args_from_reference_and_combination() {
        let b = VoiceBuild {
            model: "m.gguf".into(),
            inputs: vec![VoiceInput { path: PathBuf::from("ref.wav"), transcript: Some(" 今日は。 ".into()), speaker: None }],
            out: PathBuf::from("out.voice.gguf"),
        };
        assert_eq!(Drama3Adapter.prepare_voice(&b).unwrap(), ["voice", "m.gguf", "ref.wav", "out.voice.gguf", "--transcript", "今日は。"]);
        let c = VoiceBuild {
            model: "m.gguf".into(),
            inputs: vec![
                VoiceInput { path: PathBuf::from("a.voice.gguf"), transcript: None, speaker: Some(0) },
                VoiceInput { path: PathBuf::from("b.voice.gguf"), transcript: None, speaker: Some(1) },
            ],
            out: PathBuf::from("cast.voice.gguf"),
        };
        assert_eq!(
            Drama3Adapter.prepare_voice(&c).unwrap(),
            ["voice", "m.gguf", "a.voice.gguf", "b.voice.gguf", "cast.voice.gguf", "--speaker", "0", "--speaker", "1"]
        );
        let missing = VoiceBuild { inputs: vec![VoiceInput { path: PathBuf::from("r.wav"), ..Default::default() }], ..c };
        assert!(matches!(Drama3Adapter.prepare_voice(&missing), Err(AdapterError::MissingTranscript(_))));
    }
}
