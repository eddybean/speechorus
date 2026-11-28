//! The model catalog (assets/models/catalog.json, or an override in the config folder) and its downloads:
//! HTTP with Range resume and SHA-256 checks for Hugging Face files, `speech pull` for speech.cpp's own catalog.

use std::collections::{BTreeMap, HashMap};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const BUILTIN_CATALOG: &str = include_str!("../../assets/models/catalog.json");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub version: u32,
    pub models: Vec<CatalogModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogModel {
    pub id: String,
    pub name: String,
    /// `synthesis` or `recognition`.
    pub task: String,
    /// The adapter of a synthesis model (`drama3`, `irodori`).
    #[serde(default)]
    pub adapter: String,
    #[serde(default)]
    pub description: String,
    pub source: Source,
    pub license: License,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub device: String,
    pub default_variant: String,
    pub variants: Vec<Variant>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Source {
    #[serde(rename_all = "camelCase")]
    Huggingface { repo: String, revision: String },
    #[serde(rename_all = "camelCase")]
    SpeechPull { name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct License {
    pub name: String,
    pub url: String,
    pub summary: String,
    pub requires_consent: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Variant {
    pub id: String,
    pub label: String,
    #[serde(default = "yes")]
    pub supported: bool,
    #[serde(default)]
    pub unsupported_reason: String,
    pub vram_bytes: u64,
    pub files: Vec<CatalogFile>,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogFile {
    pub name: String,
    pub size: u64,
    #[serde(default)]
    pub sha256: String,
    /// `model` or `sidecar`.
    pub role: String,
}

impl Variant {
    pub fn total_bytes(&self) -> u64 {
        self.files.iter().map(|f| f.size).sum()
    }
    pub fn model_file(&self) -> Option<&CatalogFile> {
        self.files.iter().find(|f| f.role == "model")
    }
}

impl Catalog {
    pub fn parse(s: &str) -> Result<Catalog, String> {
        let c: Catalog = serde_json::from_str(s).map_err(|e| format!("catalog.json: {e}"))?;
        for m in &c.models {
            if !m.variants.iter().any(|v| v.id == m.default_variant) {
                return Err(format!("catalog.json: {} has no variant {}", m.id, m.default_variant));
            }
        }
        Ok(c)
    }

    /// The override in the config folder when it parses, else the built-in one.
    pub fn load(override_path: &Path) -> Catalog {
        std::fs::read_to_string(override_path)
            .ok()
            .and_then(|s| Catalog::parse(&s).ok())
            .unwrap_or_else(|| Catalog::parse(BUILTIN_CATALOG).expect("built-in catalog"))
    }

    pub fn find(&self, model: &str, variant: &str) -> Option<(&CatalogModel, &Variant)> {
        let m = self.models.iter().find(|m| m.id == model)?;
        let v = m.variants.iter().find(|v| v.id == variant)?;
        Some((m, v))
    }
}

/// The variant to recommend for a GPU with `free` bytes: the largest supported one that fits, else the smallest.
pub fn recommend(m: &CatalogModel, free: Option<u64>) -> Option<String> {
    let mut ok: Vec<&Variant> = m.variants.iter().filter(|v| v.supported).collect();
    ok.sort_by_key(|v| v.vram_bytes);
    let free = free?;
    ok.iter().rev().find(|v| v.vram_bytes <= free).or(ok.first()).map(|v| v.id.clone())
}

// ---- progress ----

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub id: String,
    /// `checking`, `downloading`, `verifying`, `done`, `failed`, `cancelled`.
    pub phase: String,
    pub file: String,
    pub done: u64,
    pub total: u64,
    pub bytes_per_sec: f64,
    pub eta_secs: Option<f64>,
    pub message: String,
    pub profile_id: Option<String>,
}

impl Progress {
    pub fn new(id: &str, phase: &str) -> Self {
        Progress {
            id: id.into(),
            phase: phase.into(),
            file: String::new(),
            done: 0,
            total: 0,
            bytes_per_sec: 0.0,
            eta_secs: None,
            message: String::new(),
            profile_id: None,
        }
    }
}

pub type OnProgress<'a> = &'a (dyn Fn(Progress) + Send + Sync);

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum DownloadError {
    #[error("キャンセルしました")]
    Cancelled,
    #[error("空き容量が足りません: 必要 {need} / 空き {free}")]
    NoSpace { need: String, free: String },
    #[error("SHA-256 が一致しません ({file}): 期待 {expected} / 実際 {actual}")]
    Hash { file: String, expected: String, actual: String },
    #[error("{0}")]
    Other(String),
}

fn other<E: std::fmt::Display>(e: E) -> DownloadError {
    DownloadError::Other(e.to_string())
}

pub fn gib(b: u64) -> String {
    format!("{:.1} GiB", b as f64 / (1u64 << 30) as f64)
}

/// Free bytes on the volume holding `dir` (Windows; None elsewhere or on failure).
#[cfg(windows)]
pub fn free_space(dir: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetDiskFreeSpaceExW(dir: *const u16, avail: *mut u64, total: *mut u64, free: *mut u64) -> i32;
    }
    let wide: Vec<u16> = dir.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let (mut avail, mut total, mut free) = (0u64, 0u64, 0u64);
    // SAFETY: a NUL-terminated wide path and three valid out pointers.
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut avail, &mut total, &mut free) };
    (ok != 0).then_some(avail)
}

#[cfg(not(windows))]
pub fn free_space(_dir: &Path) -> Option<u64> {
    None
}

/// Smooths the rate and reports at most every 500 ms.
struct Meter {
    start_done: u64,
    last_at: Instant,
    last_done: u64,
    rate: f64,
}

impl Meter {
    fn new(done: u64) -> Self {
        Meter { start_done: done, last_at: Instant::now(), last_done: done, rate: 0.0 }
    }
    fn tick(&mut self, done: u64) -> Option<f64> {
        let dt = self.last_at.elapsed().as_secs_f64();
        if dt < 0.5 {
            return None;
        }
        let inst = (done - self.last_done) as f64 / dt;
        self.rate = if self.rate == 0.0 { inst } else { self.rate * 0.7 + inst * 0.3 };
        self.last_at = Instant::now();
        self.last_done = done;
        let _ = self.start_done;
        Some(self.rate)
    }
}

fn sha256_file(path: &Path, cancel: &AtomicBool, mut on: impl FnMut(u64)) -> Result<(Sha256, u64), DownloadError> {
    let mut f = std::fs::File::open(path).map_err(other)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    let mut n_total = 0u64;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(DownloadError::Cancelled);
        }
        let n = f.read(&mut buf).map_err(other)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
        n_total += n as u64;
        on(n_total);
    }
    Ok((h, n_total))
}

/// Downloads `url` to `dest`, resuming `dest.part` with a Range request, and checks size and SHA-256.
/// A `dest` that already has the right size and hash is kept as it is.
pub fn fetch_file(
    id: &str,
    url: &str,
    dest: &Path,
    size: u64,
    sha256: &str,
    cancel: &AtomicBool,
    on: OnProgress,
) -> Result<(), DownloadError> {
    let name = dest.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
    let report = |phase: &str, done: u64, rate: f64| {
        let mut p = Progress::new(id, phase);
        p.file = name.clone();
        p.done = done;
        p.total = size;
        p.bytes_per_sec = rate;
        p.eta_secs = (rate > 0.0 && size > done).then(|| (size - done) as f64 / rate);
        on(p);
    };
    let expected = sha256.to_ascii_lowercase();
    // Already there?
    if let Ok(md) = std::fs::metadata(dest) {
        if md.len() == size {
            if expected.is_empty() {
                return Ok(());
            }
            let mut last = Instant::now();
            let (h, _) = sha256_file(dest, cancel, |d| {
                if last.elapsed() > Duration::from_millis(500) {
                    last = Instant::now();
                    report("checking", d, 0.0);
                }
            })?;
            if hex::encode(h.finalize()) == expected {
                return Ok(());
            }
        }
    }
    let part = PathBuf::from(format!("{}.part", dest.display()));
    let mut have = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    if have > size {
        have = 0;
    }
    // Hash what a previous run left, so the final check covers the whole file.
    let mut hasher = Sha256::new();
    if have > 0 {
        let mut last = Instant::now();
        let (h, n) = sha256_file(&part, cancel, |d| {
            if last.elapsed() > Duration::from_millis(500) {
                last = Instant::now();
                report("checking", d, 0.0);
            }
        })?;
        hasher = h;
        have = n;
    }
    // `timeout_per_read` restarts on every read, like ureq 2's `timeout_read`: a stalled
    // download fails, a slow one does not.
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(20)))
        .timeout_per_read(Some(Duration::from_secs(60)))
        .build()
        .into();
    // Ask for the bytes as stored: the size and hash checks cover the file itself, and ureq 3
    // fails to decode a gzip-encoded 206 (a resumed download).
    let mut req = agent.get(url).header("User-Agent", "speechorus-downloader").header("Accept-Encoding", "identity");
    if have > 0 && have < size {
        req = req.header("Range", format!("bytes={have}-"));
    }
    let resp =
        if have == size { None } else { Some(req.call().map_err(|e| DownloadError::Other(format!("{url}: {e}")))?) };
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(false)
        .write(true)
        .truncate(false)
        .open(&part)
        .map_err(other)?;
    if let Some(resp) = resp {
        if resp.status() == 206 {
            file.seek(SeekFrom::Start(have)).map_err(other)?;
        } else {
            // The server sent the whole file: start over.
            have = 0;
            hasher = Sha256::new();
            file.set_len(0).map_err(other)?;
            file.seek(SeekFrom::Start(0)).map_err(other)?;
        }
        let mut reader = resp.into_body().into_reader();
        let mut buf = vec![0u8; 1 << 18];
        let mut meter = Meter::new(have);
        report("downloading", have, 0.0);
        loop {
            if cancel.load(Ordering::Relaxed) {
                file.flush().map_err(other)?;
                report("cancelled", have, 0.0);
                return Err(DownloadError::Cancelled);
            }
            let n = reader.read(&mut buf).map_err(other)?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n]).map_err(other)?;
            hasher.update(&buf[..n]);
            have += n as u64;
            if let Some(rate) = meter.tick(have) {
                report("downloading", have, rate);
            }
        }
        file.flush().map_err(other)?;
    }
    drop(file);
    if have != size {
        return Err(DownloadError::Other(format!(
            "{name}: {have} B を受信しましたが {size} B のはずです（再開できます）"
        )));
    }
    report("verifying", have, 0.0);
    let actual = hex::encode(hasher.finalize());
    if !expected.is_empty() && actual != expected {
        let _ = std::fs::remove_file(&part);
        return Err(DownloadError::Hash { file: name, expected, actual });
    }
    std::fs::rename(&part, dest).map_err(other)?;
    Ok(())
}

pub fn hf_url(repo: &str, revision: &str, file: &str) -> String {
    format!("https://huggingface.co/{repo}/resolve/{revision}/{file}")
}

/// Downloads every file of a Hugging Face variant into `dir` (sidecars first; they are small).
/// Returns the model file's path.
pub fn fetch_variant(
    id: &str,
    repo: &str,
    revision: &str,
    v: &Variant,
    dir: &Path,
    cancel: &AtomicBool,
    on: OnProgress,
) -> Result<PathBuf, DownloadError> {
    std::fs::create_dir_all(dir).map_err(other)?;
    let missing: u64 = v
        .files
        .iter()
        .map(|f| {
            let have = std::fs::metadata(dir.join(&f.name))
                .map(|m| if m.len() == f.size { f.size } else { 0 })
                .unwrap_or(0)
                .max(std::fs::metadata(dir.join(format!("{}.part", f.name))).map(|m| m.len().min(f.size)).unwrap_or(0));
            f.size - have
        })
        .sum();
    if let Some(free) = free_space(dir) {
        // Keep 1 GiB spare.
        if free < missing + (1 << 30) {
            return Err(DownloadError::NoSpace { need: gib(missing + (1 << 30)), free: gib(free) });
        }
    }
    let mut files: Vec<&CatalogFile> = v.files.iter().collect();
    files.sort_by_key(|f| f.role != "sidecar");
    for f in files {
        fetch_file(id, &hf_url(repo, revision, &f.name), &dir.join(&f.name), f.size, &f.sha256, cancel, on)?;
    }
    let m = v.model_file().ok_or_else(|| DownloadError::Other("variant has no model file".into()))?;
    Ok(dir.join(&m.name))
}

/// `  395 MB of 1920 MB, 20%, 33.2 MB/s` → (done, total, bytes/s).
pub fn parse_pull_progress(line: &str) -> Option<(u64, u64, f64)> {
    let l = line.trim();
    let (done, rest) = l.split_once(" MB of ")?;
    let (total, rest) = rest.split_once(" MB")?;
    let rate = rest
        .rsplit(", ")
        .next()
        .and_then(|r| r.strip_suffix(" MB/s"))
        .and_then(|r| r.trim().parse::<f64>().ok())
        .unwrap_or(0.0);
    let mb = 1_000_000u64;
    Some((done.trim().parse::<u64>().ok()? * mb, total.trim().parse::<u64>().ok()? * mb, rate * mb as f64))
}

/// `speech pull NAME`, reporting its progress; returns the path it prints. Cancel kills it (speech pull resumes later).
pub async fn speech_pull(
    id: &str,
    exe: &str,
    name: &str,
    cancel: Arc<AtomicBool>,
    on: Arc<dyn Fn(Progress) + Send + Sync>,
) -> Result<String, DownloadError> {
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
    let mut cmd = tokio::process::Command::new(exe);
    cmd.arg("pull")
        .arg(name)
        .env("SPEECH_NO_UPDATE_CHECK", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    crate::engine::no_window(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| DownloadError::Other(format!("{exe}: {e}")))?;
    let mut stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let (idc, onc) = (id.to_string(), on.clone());
    let errlog = Arc::new(Mutex::new(Vec::<String>::new()));
    let el = errlog.clone();
    let reader = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(l)) = lines.next_line().await {
            if let Some((done, total, rate)) = parse_pull_progress(&l) {
                let mut p = Progress::new(&idc, "downloading");
                p.done = done;
                p.total = total;
                p.bytes_per_sec = rate;
                p.eta_secs = (rate > 0.0 && total > done).then(|| (total - done) as f64 / rate);
                onc(p);
            } else {
                el.lock().unwrap().push(l);
            }
        }
    });
    let mut out = String::new();
    loop {
        tokio::select! {
            r = child.wait() => {
                let status = r.map_err(other)?;
                let _ = reader.await;
                stdout.read_to_string(&mut out).await.map_err(other)?;
                if !status.success() {
                    return Err(DownloadError::Other(errlog.lock().unwrap().join("\n")));
                }
                break;
            }
            _ = tokio::time::sleep(Duration::from_millis(200)) => {
                if cancel.load(Ordering::Relaxed) {
                    let _ = child.kill().await;
                    return Err(DownloadError::Cancelled);
                }
            }
        }
    }
    out.lines()
        .rev()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| DownloadError::Other("speech pull printed no path".into()))
}

/// Cancel flags of the downloads that run.
#[derive(Default)]
pub struct Downloads {
    pub running: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_catalog_parses_and_holds_the_required_models() {
        let c = Catalog::parse(BUILTIN_CATALOG).unwrap();
        let (m, v) = c.find("drama3-ja", "q4_k").unwrap();
        assert_eq!(m.default_variant, "q4_k");
        assert!(m.license.requires_consent);
        assert_eq!(m.env.get("GGML_VK_DISABLE_COOPMAT2").map(String::as_str), Some("1"));
        assert!(v.files.iter().any(|f| f.role == "sidecar" && f.name.ends_with(".gguf.json")));
        assert!(v.files.iter().all(|f| f.sha256.len() == 64));
        let (_, q5) = c.find("drama3-ja", "q5_k").unwrap();
        assert_eq!(q5.files.len(), 2);
        let (_, iq3) = c.find("drama3-ja", "iq3_xxs").unwrap();
        assert!(!iq3.supported && !iq3.unsupported_reason.is_empty());
        assert!(matches!(c.find("irodori-tts-mf", "f16").unwrap().0.source, Source::SpeechPull { .. }));
        assert_eq!(c.find("qwen3-asr-0.6b", "q8_0").unwrap().0.task, "recognition");
    }

    #[test]
    fn recommends_by_free_vram() {
        let c = Catalog::parse(BUILTIN_CATALOG).unwrap();
        let m = &c.models[0];
        let g = 1u64 << 30;
        assert_eq!(recommend(m, Some(31 * g)).as_deref(), Some("q5_k"));
        assert_eq!(recommend(m, Some(24 * g)).as_deref(), Some("q4_k"));
        // Too small for any: the smallest supported, never the unsupported IQ3_XXS.
        assert_eq!(recommend(m, Some(12 * g)).as_deref(), Some("q4_k"));
        assert_eq!(recommend(m, None), None);
    }

    #[test]
    fn parses_speech_pull_progress() {
        let (d, t, r) = parse_pull_progress("  395 MB of 1920 MB, 20%, 33.2 MB/s").unwrap();
        assert_eq!((d, t), (395_000_000, 1_920_000_000));
        assert!((r - 33_200_000.0).abs() < 1.0);
        assert_eq!(parse_pull_progress("Fetched irodori-tts-mf in 45 s"), None);
    }

    /// A tiny HTTP server that honours Range, for resume tests.
    fn serve(body: Vec<u8>, honour_range: bool) -> (String, std::thread::JoinHandle<()>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/f.bin", listener.local_addr().unwrap());
        let h = std::thread::spawn(move || {
            for stream in listener.incoming().take(4) {
                let Ok(mut s) = stream else { continue };
                let mut req = [0u8; 2048];
                let n = s.read(&mut req).unwrap_or(0);
                let text = String::from_utf8_lossy(&req[..n]).to_string();
                let start = text
                    .lines()
                    .find_map(|l| {
                        l.to_ascii_lowercase()
                            .strip_prefix("range: bytes=")
                            .map(|r| r.trim_end_matches('-').trim().to_string())
                    })
                    .and_then(|r| r.parse::<usize>().ok())
                    .filter(|_| honour_range);
                let (status, slice) = match start {
                    Some(st) => (
                        format!("206 Partial Content\r\nContent-Range: bytes {st}-{}/{}", body.len() - 1, body.len()),
                        &body[st..],
                    ),
                    None => ("200 OK".to_string(), &body[..]),
                };
                let head = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", slice.len());
                let _ = s.write_all(head.as_bytes());
                let _ = s.write_all(slice);
            }
        });
        (url, h)
    }

    fn body() -> (Vec<u8>, String) {
        let b: Vec<u8> = (0..300_000u32).map(|i| (i * 7 % 251) as u8).collect();
        let h = hex::encode(Sha256::digest(&b));
        (b, h)
    }

    #[test]
    fn resumes_a_part_file_with_range() {
        let (b, h) = body();
        let d = tempfile::tempdir().unwrap();
        let dest = d.path().join("f.bin");
        std::fs::write(d.path().join("f.bin.part"), &b[..120_000]).unwrap();
        let (url, _srv) = serve(b.clone(), true);
        let seen = Mutex::new(Vec::new());
        let on = |p: Progress| seen.lock().unwrap().push(p.phase);
        fetch_file("t", &url, &dest, b.len() as u64, &h, &AtomicBool::new(false), &on).unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b);
        assert!(!d.path().join("f.bin.part").exists());
        assert!(seen.lock().unwrap().contains(&"verifying".to_string()));
        // Already complete: kept after a hash check, without a request.
        fetch_file("t", "http://127.0.0.1:1/none", &dest, b.len() as u64, &h, &AtomicBool::new(false), &on).unwrap();
    }

    #[test]
    fn restarts_when_the_server_ignores_range_and_rejects_bad_hashes() {
        let (b, h) = body();
        let d = tempfile::tempdir().unwrap();
        let dest = d.path().join("f.bin");
        std::fs::write(d.path().join("f.bin.part"), vec![9u8; 50_000]).unwrap();
        let (url, _srv) = serve(b.clone(), false);
        fetch_file("t", &url, &dest, b.len() as u64, &h, &AtomicBool::new(false), &|_| {}).unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b);

        let dest2 = d.path().join("g.bin");
        let (url2, _srv2) = serve(b.clone(), true);
        let e = fetch_file("t", &url2, &dest2, b.len() as u64, &"0".repeat(64), &AtomicBool::new(false), &|_| {})
            .unwrap_err();
        assert!(matches!(e, DownloadError::Hash { .. }));
        assert!(!dest2.exists());
    }

    #[test]
    fn cancel_keeps_the_part_file() {
        let (b, h) = body();
        let d = tempfile::tempdir().unwrap();
        let dest = d.path().join("f.bin");
        let (url, _srv) = serve(b.clone(), true);
        let cancel = AtomicBool::new(false);
        let on = |p: Progress| {
            if p.phase == "downloading" {
                cancel.store(true, Ordering::Relaxed);
            }
        };
        assert_eq!(fetch_file("t", &url, &dest, b.len() as u64, &h, &cancel, &on), Err(DownloadError::Cancelled));
        assert!(!dest.exists());
        assert!(d.path().join("f.bin.part").exists());
    }

    #[test]
    fn refuses_when_space_is_short() {
        let d = tempfile::tempdir().unwrap();
        let v = Variant {
            id: "x".into(),
            label: "x".into(),
            supported: true,
            unsupported_reason: String::new(),
            vram_bytes: 0,
            files: vec![CatalogFile {
                name: "huge.gguf".into(),
                size: u64::MAX / 4,
                sha256: String::new(),
                role: "model".into(),
            }],
        };
        let e = fetch_variant("t", "r", "main", &v, d.path(), &AtomicBool::new(false), &|_| {}).unwrap_err();
        assert!(matches!(e, DownloadError::NoSpace { .. }), "{e:?}");
        assert!(free_space(d.path()).unwrap() > 0);
    }
}
