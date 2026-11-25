//! Export: WAV per line, a joined WAV with silences, SRT and text, all with hound.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum AudioError {
    #[error("{0}: {1}")]
    Wav(String, hound::Error),
    #[error("{0}: {1}")]
    Io(String, std::io::Error),
    #[error("書き出す行がありません")]
    Nothing,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExportItem {
    /// The take's WAV.
    pub path: PathBuf,
    pub text: String,
    pub cast: String,
    pub pre_silence: f64,
    pub post_silence: f64,
    pub seed: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cue {
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub cast: String,
}

/// Reads any PCM/float WAV as mono f32.
pub fn read_mono(path: &Path) -> Result<(Vec<f32>, u32), AudioError> {
    let werr = |e| AudioError::Wav(path.display().to_string(), e);
    let mut r = hound::WavReader::open(path).map_err(werr)?;
    let spec = r.spec();
    let ch = spec.channels.max(1) as usize;
    let raw: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => r.samples::<f32>().collect::<Result<_, _>>().map_err(werr)?,
        hound::SampleFormat::Int => {
            let scale = (1i64 << (spec.bits_per_sample - 1)) as f32;
            r.samples::<i32>()
                .map(|s| s.map(|v| v as f32 / scale))
                .collect::<Result<_, _>>()
                .map_err(werr)?
        }
    };
    let mono = if ch == 1 {
        raw
    } else {
        raw.chunks(ch)
            .map(|c| c.iter().sum::<f32>() / ch as f32)
            .collect()
    };
    Ok((mono, spec.sample_rate))
}

/// Linear-interpolation resampling; enough for joining takes of 44.1 and 48 kHz models.
pub fn resample_linear(x: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || x.is_empty() {
        return x.to_vec();
    }
    let n = ((x.len() as u64 * to as u64) / from as u64) as usize;
    let ratio = from as f64 / to as f64;
    (0..n)
        .map(|i| {
            let pos = i as f64 * ratio;
            let i0 = pos.floor() as usize;
            let frac = (pos - i0 as f64) as f32;
            let a = x[i0.min(x.len() - 1)];
            let b = x[(i0 + 1).min(x.len() - 1)];
            a + (b - a) * frac
        })
        .collect()
}

pub fn write_mono_i16(path: &Path, x: &[f32], sr: u32) -> Result<(), AudioError> {
    let werr = |e| AudioError::Wav(path.display().to_string(), e);
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: sr,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut w = hound::WavWriter::create(path, spec).map_err(werr)?;
    for &s in x {
        w.write_sample((s.clamp(-1.0, 1.0) * 32767.0).round() as i16)
            .map_err(werr)?;
    }
    w.finalize().map_err(werr)
}

fn secs_to_samples(s: f64, sr: u32) -> usize {
    (s.max(0.0) * sr as f64).round() as usize
}

/// Joins the items with each one's silence before and after; returns the cues of the spoken parts.
/// The output rate is `sample_rate`, or the first item's when None.
pub fn concat(
    items: &[ExportItem],
    out: &Path,
    sample_rate: Option<u32>,
) -> Result<Vec<Cue>, AudioError> {
    if items.is_empty() {
        return Err(AudioError::Nothing);
    }
    let mut buf: Vec<f32> = Vec::new();
    let mut sr = sample_rate.unwrap_or(0);
    let mut cues = Vec::with_capacity(items.len());
    for it in items {
        let (x, r) = read_mono(&it.path)?;
        if sr == 0 {
            sr = r;
        }
        let x = resample_linear(&x, r, sr);
        buf.resize(buf.len() + secs_to_samples(it.pre_silence, sr), 0.0);
        let start = buf.len() as f64 / sr as f64;
        buf.extend_from_slice(&x);
        let end = buf.len() as f64 / sr as f64;
        buf.resize(buf.len() + secs_to_samples(it.post_silence, sr), 0.0);
        cues.push(Cue {
            start,
            end,
            text: it.text.clone(),
            cast: it.cast.clone(),
        });
    }
    write_mono_i16(out, &buf, sr)?;
    Ok(cues)
}

/// The cues a joined export would have, from each take's duration, without reading audio.
pub fn cues_from_durations(items: &[(f64, f64, f64, String, String)]) -> Vec<Cue> {
    let mut t = 0.0;
    items
        .iter()
        .map(|(pre, dur, post, text, cast)| {
            t += pre;
            let c = Cue {
                start: t,
                end: t + dur,
                text: text.clone(),
                cast: cast.clone(),
            };
            t += dur + post;
            c
        })
        .collect()
}

pub fn srt_time(s: f64) -> String {
    let ms = (s.max(0.0) * 1000.0).round() as u64;
    format!(
        "{:02}:{:02}:{:02},{:03}",
        ms / 3_600_000,
        (ms / 60_000) % 60,
        (ms / 1000) % 60,
        ms % 1000
    )
}

/// Text without `[cues]` and `<|speaker:N|>`, for subtitles and file names.
pub fn plain_text(text: &str) -> String {
    let mut out = String::new();
    let mut depth_b = false;
    let mut chars = text.chars().peekable();
    let mut in_tok = false;
    while let Some(c) = chars.next() {
        if in_tok {
            if c == '|' && chars.peek() == Some(&'>') {
                chars.next();
                in_tok = false;
            }
            continue;
        }
        if depth_b {
            if c == ']' {
                depth_b = false;
            }
            continue;
        }
        match c {
            '[' => depth_b = true,
            '<' if chars.peek() == Some(&'|') => {
                chars.next();
                in_tok = true;
            }
            _ => out.push(c),
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn srt(cues: &[Cue], with_cast: bool) -> String {
    let mut s = String::new();
    for (i, c) in cues.iter().enumerate() {
        let text = plain_text(&c.text);
        let text = if with_cast && !c.cast.is_empty() {
            format!("{}: {}", c.cast, text)
        } else {
            text
        };
        s.push_str(&format!(
            "{}\n{} --> {}\n{}\n\n",
            i + 1,
            srt_time(c.start),
            srt_time(c.end),
            text
        ));
    }
    s
}

/// `キャラ,テキスト` lines, the form txt import reads back.
pub fn script_text(items: &[ExportItem]) -> String {
    items
        .iter()
        .map(|i| {
            if i.cast.is_empty() {
                format!("{}\n", i.text)
            } else {
                format!("{},{}\n", i.cast, i.text)
            }
        })
        .collect()
}

pub fn sanitize_file_name(s: &str) -> String {
    let t: String = s
        .chars()
        .map(|c| {
            if "\\/:*?\"<>|".contains(c) || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let t = t.trim().trim_end_matches('.').to_string();
    if t.is_empty() {
        "_".into()
    } else {
        t
    }
}

/// `{index}` (1-based, zero padded to `pad`), `{cast}`, `{text8}`, `{text}` (first 32 chars), `{seed}`.
pub fn render_template(tpl: &str, index: usize, pad: usize, item: &ExportItem) -> String {
    let plain = plain_text(&item.text);
    let out = tpl
        .replace("{index}", &format!("{index:0pad$}"))
        .replace("{cast}", &item.cast)
        .replace("{text8}", &plain.chars().take(8).collect::<String>())
        .replace("{text}", &plain.chars().take(32).collect::<String>())
        .replace(
            "{seed}",
            &item.seed.map(|s| s.to_string()).unwrap_or_default(),
        );
    sanitize_file_name(&out)
}

/// Copies each item's take to `dir` under the template's name (a serial is added when the name is taken).
pub fn export_each(
    items: &[ExportItem],
    dir: &Path,
    tpl: &str,
    write_txt: bool,
) -> Result<Vec<PathBuf>, AudioError> {
    if items.is_empty() {
        return Err(AudioError::Nothing);
    }
    std::fs::create_dir_all(dir).map_err(|e| AudioError::Io(dir.display().to_string(), e))?;
    let pad = items.len().to_string().len().max(3);
    let mut out = Vec::new();
    for (i, it) in items.iter().enumerate() {
        let stem = render_template(tpl, i + 1, pad, it);
        let dst = crate::jobs::unique_path(dir, &stem, "wav");
        std::fs::copy(&it.path, &dst)
            .map_err(|e| AudioError::Io(it.path.display().to_string(), e))?;
        if write_txt {
            let t = dst.with_extension("txt");
            std::fs::write(&t, plain_text(&it.text))
                .map_err(|e| AudioError::Io(t.display().to_string(), e))?;
        }
        out.push(dst);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(dir: &Path, name: &str, secs: f64, sr: u32) -> PathBuf {
        let p = dir.join(name);
        let n = (secs * sr as f64) as usize;
        write_mono_i16(&p, &vec![0.5; n], sr).unwrap();
        p
    }

    #[test]
    fn concat_inserts_silences_and_times_cues() {
        let d = tempfile::tempdir().unwrap();
        let items = vec![
            ExportItem {
                path: tone(d.path(), "a.wav", 1.0, 1000),
                text: "[明るく]一".into(),
                cast: "A".into(),
                pre_silence: 0.5,
                post_silence: 0.25,
                seed: None,
            },
            ExportItem {
                path: tone(d.path(), "b.wav", 2.0, 1000),
                text: "二".into(),
                cast: "B".into(),
                pre_silence: 0.0,
                post_silence: 1.0,
                seed: None,
            },
        ];
        let out = d.path().join("all.wav");
        let cues = concat(&items, &out, None).unwrap();
        assert_eq!(
            cues[0],
            Cue {
                start: 0.5,
                end: 1.5,
                text: "[明るく]一".into(),
                cast: "A".into()
            }
        );
        assert_eq!((cues[1].start, cues[1].end), (1.75, 3.75));
        let (x, sr) = read_mono(&out).unwrap();
        assert_eq!(sr, 1000);
        assert_eq!(x.len(), 4750);
        assert!(x[..500].iter().all(|v| *v == 0.0));
        assert!((x[500] - 0.5).abs() < 1e-3);
        // Same as computing from durations alone.
        let est = cues_from_durations(&[
            (0.5, 1.0, 0.25, "[明るく]一".into(), "A".into()),
            (0.0, 2.0, 1.0, "二".into(), "B".into()),
        ]);
        assert_eq!(est, cues);
    }

    #[test]
    fn concat_resamples_mixed_rates() {
        let d = tempfile::tempdir().unwrap();
        let items = vec![
            ExportItem {
                path: tone(d.path(), "a.wav", 1.0, 44100),
                ..Default::default()
            },
            ExportItem {
                path: tone(d.path(), "b.wav", 1.0, 48000),
                ..Default::default()
            },
        ];
        let out = d.path().join("all.wav");
        let cues = concat(&items, &out, None).unwrap();
        assert!((cues[1].end - 2.0).abs() < 1e-3);
        assert_eq!(read_mono(&out).unwrap().1, 44100);
    }

    #[test]
    fn srt_format_and_plain_text() {
        assert_eq!(srt_time(3725.0456), "01:02:05,046");
        assert_eq!(
            plain_text("<|speaker:1|> [笑い]ふふ、[小声で]そう"),
            "ふふ、そう"
        );
        let s = srt(
            &[Cue {
                start: 0.0,
                end: 1.5,
                text: "[囁き]ねえ".into(),
                cast: "ミカ".into(),
            }],
            true,
        );
        assert_eq!(s, "1\n00:00:00,000 --> 00:00:01,500\nミカ: ねえ\n\n");
    }

    #[test]
    fn template_and_serials() {
        let it = ExportItem {
            text: "[驚いて]本当に？それは楽しみ/だね".into(),
            cast: "ナレ:ター".into(),
            seed: Some(7),
            ..Default::default()
        };
        assert_eq!(
            render_template("{index}_{cast}_{text8}", 3, 3, &it),
            "003_ナレ_ター_本当に？それは楽"
        );
        assert_eq!(
            render_template("{seed}-{text}", 1, 1, &it),
            "7-本当に？それは楽しみ_だね"
        );
        let d = tempfile::tempdir().unwrap();
        let src = tone(d.path(), "t.wav", 0.1, 1000);
        let items = vec![
            ExportItem {
                path: src.clone(),
                text: "同じ".into(),
                ..Default::default()
            },
            ExportItem {
                path: src,
                text: "同じ".into(),
                ..Default::default()
            },
        ];
        let out = export_each(&items, &d.path().join("out"), "{text8}", true).unwrap();
        assert_eq!(out[0].file_name().unwrap(), "同じ.wav");
        assert_eq!(out[1].file_name().unwrap(), "同じ_2.wav");
        assert!(out[1].with_extension("txt").exists());
        assert_eq!(
            script_text(&[ExportItem {
                cast: "A".into(),
                text: "x".into(),
                ..Default::default()
            }]),
            "A,x\n"
        );
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Waveform {
    pub duration: f64,
    pub sample_rate: u32,
    /// (min, max) of each of `buckets` equal slices, in -1..1.
    pub peaks: Vec<(f32, f32)>,
}

/// A light summary of a WAV for drawing: min/max per bucket.
pub fn peaks(path: &Path, buckets: usize) -> Result<Waveform, AudioError> {
    let (x, sr) = read_mono(path)?;
    let buckets = buckets.clamp(1, 20_000);
    let per = x.len().div_ceil(buckets).max(1);
    let peaks = x
        .chunks(per)
        .map(|c| c.iter().fold((0f32, 0f32), |(lo, hi), &v| (lo.min(v), hi.max(v))))
        .collect();
    Ok(Waveform { duration: x.len() as f64 / sr as f64, sample_rate: sr, peaks })
}

/// Writes `[start, end)` seconds of `src` to `dst` as 16-bit mono; `src` is left as it is.
pub fn trim(src: &Path, dst: &Path, start: f64, end: f64) -> Result<f64, AudioError> {
    let (x, sr) = read_mono(src)?;
    let a = secs_to_samples(start, sr).min(x.len());
    let b = secs_to_samples(end, sr).clamp(a, x.len());
    if b <= a {
        return Err(AudioError::Nothing);
    }
    if let Some(d) = dst.parent() {
        std::fs::create_dir_all(d).map_err(|e| AudioError::Io(d.display().to_string(), e))?;
    }
    write_mono_i16(dst, &x[a..b], sr)?;
    Ok((b - a) as f64 / sr as f64)
}

#[cfg(test)]
mod trim_tests {
    use super::*;

    #[test]
    fn peaks_and_trim() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("ref.wav");
        // 2 s at 1 kHz: silence, then a 0.5-amplitude second.
        let mut x = vec![0.0f32; 1000];
        x.extend(std::iter::repeat_n(0.5f32, 1000));
        write_mono_i16(&src, &x, 1000).unwrap();
        let w = peaks(&src, 4).unwrap();
        assert_eq!(w.duration, 2.0);
        assert_eq!(w.peaks.len(), 4);
        assert_eq!(w.peaks[0], (0.0, 0.0));
        assert!((w.peaks[3].1 - 0.5).abs() < 1e-3);
        let dst = d.path().join("cut").join("ref-cut.wav");
        let len = trim(&src, &dst, 0.75, 1.5).unwrap();
        assert!((len - 0.75).abs() < 1e-9);
        let (y, sr) = read_mono(&dst).unwrap();
        assert_eq!((y.len(), sr), (750, 1000));
        assert!(y[0].abs() < 1e-3 && (y[400] - 0.5).abs() < 1e-3);
        assert!(src.exists(), "the original stays");
        assert!(matches!(trim(&src, &dst, 1.5, 1.5), Err(AudioError::Nothing)));
    }
}
