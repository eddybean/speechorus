//! GenerationQueue: runs synthesis jobs one at a time on the resident worker, writing each take to a WAV file.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tokio::sync::Notify;

use crate::engine::{EngineSupervisor, WorkerMsg};
use crate::events::{AppEvent, Emit};
use crate::models::LineRequest;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct JobSpec {
    pub job_id: String,
    pub line_id: Option<String>,
    pub scene_id: Option<String>,
    pub request: LineRequest,
    /// The voice file to add to the worker under `request.voice` before the job.
    pub voice_path: Option<String>,
    pub out_dir: PathBuf,
    pub file_stem: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TakeResult {
    pub id: String,
    pub seed: Option<u64>,
    /// The request as sent, without `type` and `text`, so a take can be re-rolled.
    pub options_snapshot: Map<String, Value>,
    /// File name inside the takes folder.
    pub file: String,
    pub duration: f64,
    pub sample_rate: u32,
    pub stop_reason: String,
    pub created_at: u64,
    pub starred: bool,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum QueueEvent {
    #[serde(rename_all = "camelCase")]
    Enqueued {
        job_ids: Vec<String>,
    },
    #[serde(rename_all = "camelCase")]
    Started {
        job_id: String,
        line_id: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        job_id: String,
        seconds: f64,
        done: Option<f64>,
    },
    #[serde(rename_all = "camelCase")]
    Done {
        job_id: String,
        line_id: Option<String>,
        scene_id: Option<String>,
        take: TakeResult,
        warnings: Vec<String>,
    },
    #[serde(rename_all = "camelCase")]
    Failed {
        job_id: String,
        line_id: Option<String>,
        message: String,
    },
    #[serde(rename_all = "camelCase")]
    Cancelled {
        job_id: String,
        line_id: Option<String>,
    },
    Idle,
}

#[derive(Default)]
struct QState {
    pending: VecDeque<JobSpec>,
    current: Option<String>,
    cancel_current: bool,
    /// The running job's takes folder, and the WAV it is writing once it has one.
    current_dir: Option<PathBuf>,
    current_file: Option<PathBuf>,
}

pub struct GenerationQueue {
    state: Mutex<QState>,
    notify: Notify,
    supervisor: Arc<EngineSupervisor>,
    emit: Emit,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueSnapshot {
    pub pending: Vec<String>,
    pub current: Option<String>,
}

enum Outcome {
    Done(TakeResult, Vec<String>),
    Failed(String),
    Cancelled,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// `dir/stem.wav`, or `dir/stem_2.wav` … when it exists.
pub fn unique_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let p = dir.join(format!("{stem}.{ext}"));
    if !p.exists() {
        return p;
    }
    (2..)
        .map(|n| dir.join(format!("{stem}_{n}.{ext}")))
        .find(|p| !p.exists())
        .unwrap()
}

impl GenerationQueue {
    pub fn new(supervisor: Arc<EngineSupervisor>, emit: Emit) -> Arc<Self> {
        let q = Arc::new(GenerationQueue {
            state: Mutex::new(QState::default()),
            notify: Notify::new(),
            supervisor,
            emit,
        });
        let runner = q.clone();
        tokio::spawn(async move { runner.run().await });
        q
    }

    pub fn snapshot(&self) -> QueueSnapshot {
        let s = self.state.lock().unwrap();
        QueueSnapshot {
            pending: s.pending.iter().map(|j| j.job_id.clone()).collect(),
            current: s.current.clone(),
        }
    }

    /// The WAV the running job is writing, which is not a take yet and must not be pruned.
    pub fn writing(&self) -> Option<PathBuf> {
        self.state.lock().unwrap().current_file.clone()
    }

    /// Whether the running job or a pending one writes into `dir`.
    pub fn uses_dir(&self, dir: &Path) -> bool {
        let s = self.state.lock().unwrap();
        s.current_dir.as_deref() == Some(dir) || s.pending.iter().any(|j| j.out_dir == dir)
    }

    pub fn enqueue(&self, jobs: Vec<JobSpec>) {
        let ids = jobs.iter().map(|j| j.job_id.clone()).collect();
        self.state.lock().unwrap().pending.extend(jobs);
        (self.emit)(AppEvent::Queue(QueueEvent::Enqueued { job_ids: ids }));
        self.notify.notify_one();
    }

    pub async fn cancel(&self, job_id: &str) {
        let removed = {
            let mut s = self.state.lock().unwrap();
            if let Some(i) = s.pending.iter().position(|j| j.job_id == job_id) {
                s.pending.remove(i)
            } else {
                if s.current.as_deref() == Some(job_id) {
                    s.cancel_current = true;
                }
                None
            }
        };
        match removed {
            Some(j) => (self.emit)(AppEvent::Queue(QueueEvent::Cancelled {
                job_id: j.job_id,
                line_id: j.line_id,
            })),
            None => {
                if let Ok(live) = self.supervisor.live() {
                    let _ = live.conn.cancel(job_id).await;
                }
            }
        }
    }

    pub async fn cancel_all(&self) {
        let (drained, current): (Vec<JobSpec>, Option<String>) = {
            let mut s = self.state.lock().unwrap();
            if s.current.is_some() {
                s.cancel_current = true;
            }
            (s.pending.drain(..).collect(), s.current.clone())
        };
        for j in drained {
            (self.emit)(AppEvent::Queue(QueueEvent::Cancelled {
                job_id: j.job_id,
                line_id: j.line_id,
            }));
        }
        if let Some(c) = current {
            if let Ok(live) = self.supervisor.live() {
                let _ = live.conn.cancel(&c).await;
            }
        }
    }

    async fn run(self: Arc<Self>) {
        loop {
            let job = {
                let mut s = self.state.lock().unwrap();
                let j = s.pending.pop_front();
                s.current = j.as_ref().map(|j| j.job_id.clone());
                s.current_dir = j.as_ref().map(|j| j.out_dir.clone());
                s.current_file = None;
                s.cancel_current = false;
                j
            };
            let Some(job) = job else {
                (self.emit)(AppEvent::Queue(QueueEvent::Idle));
                self.notify.notified().await;
                continue;
            };
            (self.emit)(AppEvent::Queue(QueueEvent::Started {
                job_id: job.job_id.clone(),
                line_id: job.line_id.clone(),
            }));
            let outcome = self.run_job(&job).await;
            {
                let mut s = self.state.lock().unwrap();
                s.current = None;
                s.current_dir = None;
                s.current_file = None;
            }
            let ev = match outcome {
                Outcome::Done(take, warnings) => QueueEvent::Done {
                    job_id: job.job_id,
                    line_id: job.line_id,
                    scene_id: job.scene_id,
                    take,
                    warnings,
                },
                Outcome::Failed(message) => QueueEvent::Failed {
                    job_id: job.job_id,
                    line_id: job.line_id,
                    message,
                },
                Outcome::Cancelled => QueueEvent::Cancelled {
                    job_id: job.job_id,
                    line_id: job.line_id,
                },
            };
            (self.emit)(AppEvent::Queue(ev));
        }
    }

    fn cancel_requested(&self) -> bool {
        self.state.lock().unwrap().cancel_current
    }

    async fn run_job(&self, job: &JobSpec) -> Outcome {
        let live = match self.supervisor.live() {
            Ok(l) => l,
            Err(_) => return Outcome::Failed("エンジンが起動していません".into()),
        };
        if let (Some(name), Some(path)) = (&job.request.voice, &job.voice_path) {
            if let Err(e) = self.supervisor.ensure_voice(&live, name, path).await {
                return Outcome::Failed(format!("ボイスを読み込めません: {e}"));
            }
        }
        let built = match live.adapter.build_request(&job.request) {
            Ok(b) => b,
            Err(e) => return Outcome::Failed(e.to_string()),
        };
        if self.cancel_requested() {
            return Outcome::Cancelled;
        }
        let sr = live.conn.ready().sample_rate();
        if let Err(e) = std::fs::create_dir_all(&job.out_dir) {
            return Outcome::Failed(format!("{}: {e}", job.out_dir.display()));
        }
        let path = unique_path(&job.out_dir, &job.file_stem, "wav");
        self.state.lock().unwrap().current_file = Some(path.clone());
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: sr,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = match hound::WavWriter::create(&path, spec) {
            Ok(w) => w,
            Err(e) => return Outcome::Failed(format!("{}: {e}", path.display())),
        };
        let mut rx = match live.conn.request(&job.job_id, built.msg.clone()).await {
            Ok(rx) => rx,
            Err(e) => {
                drop(writer);
                let _ = std::fs::remove_file(&path);
                return Outcome::Failed(e.to_string());
            }
        };
        if self.cancel_requested() {
            let _ = live.conn.cancel(&job.job_id).await;
        }
        let mut samples: u64 = 0;
        let mut last = Instant::now() - Duration::from_secs(1);
        let fail = |w: hound::WavWriter<std::io::BufWriter<std::fs::File>>, msg: String| {
            drop(w);
            let _ = std::fs::remove_file(&path);
            Outcome::Failed(msg)
        };
        while let Some(m) = rx.recv().await {
            match m {
                WorkerMsg::Chunk { pcm, .. } => {
                    let bytes =
                        match base64::engine::general_purpose::STANDARD.decode(pcm.as_bytes()) {
                            Ok(b) => b,
                            Err(e) => return fail(writer, format!("pcm: {e}")),
                        };
                    for c in bytes.chunks_exact(2) {
                        if let Err(e) = writer.write_sample(i16::from_le_bytes([c[0], c[1]])) {
                            return fail(writer, e.to_string());
                        }
                    }
                    samples += (bytes.len() / 2) as u64;
                    if last.elapsed() >= Duration::from_millis(200) {
                        last = Instant::now();
                        (self.emit)(AppEvent::Queue(QueueEvent::Progress {
                            job_id: job.job_id.clone(),
                            seconds: samples as f64 / sr as f64,
                            done: None,
                        }));
                    }
                }
                WorkerMsg::Progress { done, .. } => {
                    (self.emit)(AppEvent::Queue(QueueEvent::Progress {
                        job_id: job.job_id.clone(),
                        seconds: samples as f64 / sr as f64,
                        done: Some(done),
                    }));
                }
                WorkerMsg::End { rest, .. } => {
                    if let Err(e) = writer.finalize() {
                        let _ = std::fs::remove_file(&path);
                        return Outcome::Failed(e.to_string());
                    }
                    let mut snap = built.msg.clone();
                    snap.remove("type");
                    let text = snap
                        .remove("text")
                        .and_then(|t| t.as_str().map(str::to_owned))
                        .unwrap_or_default();
                    let seed = rest
                        .get("seed")
                        .and_then(Value::as_u64)
                        .or(job.request.seed);
                    if let Some(s) = seed {
                        snap.insert("seed".into(), s.into());
                    }
                    let take = TakeResult {
                        id: uuid::Uuid::new_v4().to_string(),
                        seed,
                        options_snapshot: snap,
                        file: path
                            .file_name()
                            .map(|f| f.to_string_lossy().into_owned())
                            .unwrap_or_default(),
                        duration: samples as f64 / sr as f64,
                        sample_rate: sr,
                        stop_reason: rest
                            .get("stop")
                            .and_then(Value::as_str)
                            .unwrap_or("complete")
                            .to_string(),
                        created_at: now_ms(),
                        starred: false,
                        text,
                    };
                    return Outcome::Done(take, built.warnings);
                }
                WorkerMsg::Error { error, .. } => return fail(writer, error.to_string()),
                WorkerMsg::Cancelled { .. } => {
                    drop(writer);
                    let _ = std::fs::remove_file(&path);
                    return Outcome::Cancelled;
                }
                _ => {}
            }
        }
        fail(writer, "エンジンが応答せずに終了しました".into())
    }
}

#[cfg(test)]
pub(crate) mod mock {
    //! An in-memory stand-in for `speech worker` that speaks protocol 4.
    use std::collections::HashSet;
    use std::sync::{Arc, Mutex};

    use base64::Engine as _;
    use serde_json::{json, Value};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream};
    use tokio::sync::mpsc;

    /// Returns (worker's stdout for the client to read, worker's stdin for the client to write, log of lines received).
    pub fn spawn(
        sample_rate: u32,
        chunks: usize,
        chunk_ms: u64,
    ) -> (DuplexStream, DuplexStream, Arc<Mutex<Vec<Value>>>) {
        let (client_r, mut worker_w) = tokio::io::duplex(1 << 20);
        let (client_w, worker_r) = tokio::io::duplex(1 << 20);
        let log = Arc::new(Mutex::new(Vec::new()));
        let cancelled: Arc<Mutex<HashSet<String>>> = Arc::default();
        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
        let (req_tx, mut req_rx) = mpsc::unbounded_channel::<Value>();
        tokio::spawn(async move {
            let ready = json!({"type":"ready","protocol":4,"version":"0.11.2","defaults":{},"model":{"sample_rate":sample_rate,"architecture":"drama3"}});
            worker_w
                .write_all(format!("{ready}\n").as_bytes())
                .await
                .unwrap();
            while let Some(l) = out_rx.recv().await {
                if worker_w.write_all(l.as_bytes()).await.is_err() {
                    break;
                }
            }
        });
        let (log2, c2, tx2) = (log.clone(), cancelled.clone(), out_tx.clone());
        tokio::spawn(async move {
            let mut lines = BufReader::new(worker_r).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                let v: Value = serde_json::from_str(&l).unwrap();
                log2.lock().unwrap().push(v.clone());
                let id = v["id"].as_str().unwrap_or("").to_string();
                match v["type"].as_str().unwrap() {
                    "cancel" => {
                        c2.lock().unwrap().insert(id);
                    }
                    "count_tokens" => {
                        let _ = tx2.send(format!("{}\n", json!({"type":"end","id":id,"tokens":7})));
                    }
                    _ => {
                        let _ = req_tx.send(v);
                    }
                }
            }
        });
        tokio::spawn(async move {
            while let Some(v) = req_rx.recv().await {
                let id = v["id"].as_str().unwrap().to_string();
                let send = |m: Value| {
                    let _ = out_tx.send(format!("{m}\n"));
                };
                match v["type"].as_str().unwrap() {
                    "add_voice" => send(json!({"type":"end","id":id})),
                    "synthesize" => {
                        let text = v["text"].as_str().unwrap_or("");
                        if text.contains("FAIL") {
                            send(
                                json!({"type":"error","id":id,"error":{"code":"invalid_argument","option":"text","message":"mock failure"}}),
                            );
                            continue;
                        }
                        let n = sample_rate as usize / 10;
                        let pcm: Vec<u8> = (0..n)
                            .flat_map(|i| ((i as i16).wrapping_mul(30)).to_le_bytes())
                            .collect();
                        let b64 = base64::engine::general_purpose::STANDARD.encode(&pcm);
                        let mut was_cancelled = false;
                        for seq in 0..chunks {
                            tokio::time::sleep(std::time::Duration::from_millis(chunk_ms)).await;
                            if cancelled.lock().unwrap().remove(&id) {
                                was_cancelled = true;
                                break;
                            }
                            send(json!({"type":"chunk","id":id,"seq":seq,"pcm":b64}));
                        }
                        if was_cancelled {
                            send(json!({"type":"cancelled","id":id}));
                        } else {
                            let seed = v.get("seed").and_then(Value::as_u64).unwrap_or(1234);
                            send(
                                json!({"type":"end","id":id,"seed":seed,"samples":n*chunks,"stop":"complete"}),
                            );
                        }
                    }
                    _ => send(
                        json!({"type":"error","id":id,"error":{"code":"unsupported","option":"type","message":"mock"}}),
                    ),
                }
            }
        });
        (client_r, client_w, log)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::WorkerConnection;
    use crate::models::Drama3Adapter;
    use std::sync::Arc;
    use tokio::sync::mpsc;

    async fn setup(
        chunks: usize,
        chunk_ms: u64,
    ) -> (
        Arc<GenerationQueue>,
        mpsc::UnboundedReceiver<QueueEvent>,
        Arc<Mutex<Vec<Value>>>,
    ) {
        let (tx, rx) = mpsc::unbounded_channel();
        let emit: Emit = Arc::new(move |e| {
            if let AppEvent::Queue(q) = e {
                let _ = tx.send(q);
            }
        });
        let sup = EngineSupervisor::new(emit.clone());
        let (r, w, log) = mock::spawn(16_000, chunks, chunk_ms);
        let conn = WorkerConnection::handshake(r, w, Arc::new(|_| {}))
            .await
            .unwrap();
        sup.attach(conn, Arc::new(Drama3Adapter), "p");
        (GenerationQueue::new(sup, emit), rx, log)
    }

    fn job(id: &str, dir: &Path, text: &str) -> JobSpec {
        JobSpec {
            job_id: id.into(),
            line_id: Some(format!("line-{id}")),
            request: LineRequest {
                text: text.into(),
                ..Default::default()
            },
            out_dir: dir.to_path_buf(),
            file_stem: format!("take-{id}"),
            ..Default::default()
        }
    }

    async fn until_terminal(
        rx: &mut mpsc::UnboundedReceiver<QueueEvent>,
        n: usize,
    ) -> Vec<QueueEvent> {
        let mut out = Vec::new();
        while out.len() < n {
            let e = tokio::time::timeout(Duration::from_secs(5), rx.recv())
                .await
                .expect("timeout")
                .unwrap();
            if matches!(
                e,
                QueueEvent::Done { .. } | QueueEvent::Failed { .. } | QueueEvent::Cancelled { .. }
            ) {
                out.push(e);
            }
        }
        out
    }

    #[tokio::test]
    async fn runs_jobs_in_order_and_writes_wavs() {
        let dir = tempfile::tempdir().unwrap();
        let (q, mut rx, log) = setup(3, 5).await;
        let mut j2 = job("2", dir.path(), "[明るく]二つ目");
        j2.request.seed = Some(99);
        j2.request.voice = Some("v1".into());
        j2.voice_path = Some("cast.voice.gguf".into());
        q.enqueue(vec![job("1", dir.path(), "一つ目"), j2]);
        let ev = until_terminal(&mut rx, 2).await;
        let takes: Vec<TakeResult> = ev
            .into_iter()
            .map(|e| match e {
                QueueEvent::Done { take, .. } => take,
                other => panic!("{other:?}"),
            })
            .collect();
        assert_eq!(takes[0].seed, Some(1234));
        assert_eq!(takes[1].seed, Some(99));
        assert_eq!(takes[1].options_snapshot["voice"], "v1");
        assert_eq!(takes[1].text, "[明るく]二つ目");
        for t in &takes {
            let r = hound::WavReader::open(dir.path().join(&t.file)).unwrap();
            assert_eq!(r.spec().sample_rate, 16_000);
            assert_eq!(r.len(), 4_800);
            assert!((t.duration - 0.3).abs() < 1e-9);
        }
        // The voice was added once, before the synthesis that uses it.
        let types: Vec<String> = log
            .lock()
            .unwrap()
            .iter()
            .map(|v| v["type"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(types, ["synthesize", "add_voice", "synthesize"]);
    }

    #[tokio::test]
    async fn cancels_running_and_pending_jobs() {
        let dir = tempfile::tempdir().unwrap();
        let (q, mut rx, _log) = setup(50, 20).await;
        q.enqueue(vec![
            job("a", dir.path(), "長い"),
            job("b", dir.path(), "待ち"),
            job("c", dir.path(), "最後"),
        ]);
        // Wait until "a" runs.
        loop {
            if let Some(QueueEvent::Started { job_id, .. }) = rx.recv().await {
                if job_id == "a" {
                    break;
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(60)).await;
        q.cancel("b").await;
        q.cancel("a").await;
        let ev = until_terminal(&mut rx, 3).await;
        let summary: Vec<(String, &str)> = ev
            .iter()
            .map(|e| match e {
                QueueEvent::Cancelled { job_id, .. } => (job_id.clone(), "cancelled"),
                QueueEvent::Done { job_id, .. } => (job_id.clone(), "done"),
                QueueEvent::Failed { job_id, .. } => (job_id.clone(), "failed"),
                _ => unreachable!(),
            })
            .collect();
        assert_eq!(
            summary,
            [
                ("b".to_string(), "cancelled"),
                ("a".to_string(), "cancelled"),
                ("c".to_string(), "done")
            ]
        );
        // The cancelled take left no file behind.
        assert!(!dir.path().join("take-a.wav").exists());
        assert!(dir.path().join("take-c.wav").exists());
    }

    #[tokio::test]
    async fn cancel_all_and_failures() {
        let dir = tempfile::tempdir().unwrap();
        let (q, mut rx, _log) = setup(2, 5).await;
        q.enqueue(vec![
            job("x", dir.path(), "FAIL please"),
            job("y", dir.path(), ""),
        ]);
        let ev = until_terminal(&mut rx, 2).await;
        assert!(
            matches!(&ev[0], QueueEvent::Failed { message, .. } if message.contains("mock failure"))
        );
        assert!(matches!(&ev[1], QueueEvent::Failed { message, .. } if message.contains("空")));
        let (q2, mut rx2, _l) = setup(100, 20).await;
        q2.enqueue(
            (0..4)
                .map(|i| job(&i.to_string(), dir.path(), "x"))
                .collect(),
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
        q2.cancel_all().await;
        let ev = until_terminal(&mut rx2, 4).await;
        assert!(ev.iter().all(|e| matches!(e, QueueEvent::Cancelled { .. })));
        assert!(q2.snapshot().pending.is_empty());
        drop(q);
    }

    #[tokio::test]
    async fn reports_the_file_being_written_and_folders_in_use() {
        let dir = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let (q, mut rx, _log) = setup(50, 20).await;
        q.enqueue(vec![job("w", dir.path(), "長い"), job("p", other.path(), "待ち")]);
        loop {
            if let Some(QueueEvent::Progress { .. }) = rx.recv().await {
                break;
            }
        }
        assert_eq!(q.writing(), Some(dir.path().join("take-w.wav")));
        assert!(q.uses_dir(dir.path()));
        assert!(q.uses_dir(other.path()));
        q.cancel_all().await;
        until_terminal(&mut rx, 2).await;
        assert_eq!(q.writing(), None);
        assert!(!q.uses_dir(dir.path()));
    }

    #[test]
    fn unique_paths_get_serials() {
        let dir = tempfile::tempdir().unwrap();
        let p1 = unique_path(dir.path(), "a", "wav");
        std::fs::write(&p1, b"x").unwrap();
        let p2 = unique_path(dir.path(), "a", "wav");
        assert_eq!(p2.file_name().unwrap(), "a_2.wav");
    }
}
