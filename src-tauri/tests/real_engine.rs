//! End-to-end tests against the real speech.exe. They run only when the env vars are set:
//!   VS_SPEECH_EXE   path of speech.exe
//!   VS_DRAMA_MODEL  Drama-3 GGUF path (optional)
//!   VS_IRODORI_MODEL Irodori GGUF path or catalog name (optional)
//! `cargo test --test real_engine -- --nocapture --test-threads=1`

use std::sync::{Arc, Mutex};
use std::time::Duration;

use speechorus_lib::engine::{EngineState, EngineSupervisor};
use speechorus_lib::events::{AppEvent, Emit};
use speechorus_lib::jobs::{GenerationQueue, JobSpec, QueueEvent, TakeResult};
use speechorus_lib::models::LineRequest;
use speechorus_lib::settings::ModelProfile;

fn env(k: &str) -> Option<String> {
    std::env::var(k).ok().filter(|s| !s.is_empty())
}

struct Harness {
    sup: Arc<EngineSupervisor>,
    queue: Arc<GenerationQueue>,
    events: Arc<Mutex<Vec<QueueEvent>>>,
}

fn harness() -> Harness {
    let events: Arc<Mutex<Vec<QueueEvent>>> = Arc::default();
    let ev = events.clone();
    let emit: Emit = Arc::new(move |e| {
        if let AppEvent::Queue(q) = e {
            ev.lock().unwrap().push(q);
        }
    });
    let sup = EngineSupervisor::new(emit.clone());
    let queue = GenerationQueue::new(sup.clone(), emit);
    Harness { sup, queue, events }
}

async fn wait_done(h: &Harness, n: usize) -> Vec<TakeResult> {
    let deadline = std::time::Instant::now() + Duration::from_secs(300);
    loop {
        {
            let ev = h.events.lock().unwrap();
            let terminal: Vec<&QueueEvent> = ev
                .iter()
                .filter(|e| {
                    matches!(e, QueueEvent::Done { .. } | QueueEvent::Failed { .. } | QueueEvent::Cancelled { .. })
                })
                .collect();
            if terminal.len() >= n {
                return terminal
                    .into_iter()
                    .map(|e| match e {
                        QueueEvent::Done { take, .. } => take.clone(),
                        other => panic!("{other:?}"),
                    })
                    .collect();
            }
        }
        assert!(std::time::Instant::now() < deadline, "timeout");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn job(id: &str, text: &str, out: &std::path::Path, seed: u64, opts: &str) -> JobSpec {
    JobSpec {
        job_id: id.into(),
        line_id: Some(id.into()),
        request: LineRequest {
            text: text.into(),
            seed: Some(seed),
            options: serde_json::from_str(opts).unwrap(),
            ..Default::default()
        },
        out_dir: out.to_path_buf(),
        file_stem: id.into(),
        ..Default::default()
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn drama_then_irodori_switch() {
    let Some(exe) = env("VS_SPEECH_EXE") else {
        return eprintln!("VS_SPEECH_EXE not set; skipped");
    };
    let out = tempfile::tempdir().unwrap();
    let h = harness();
    let mut expected = 0;
    if let Some(model) = env("VS_DRAMA_MODEL") {
        let p = ModelProfile::new("d", "drama", "drama3", &model, &exe);
        let t = std::time::Instant::now();
        h.sup.start(&p, model.clone()).await.expect("drama start");
        eprintln!("drama ready in {:.1}s", t.elapsed().as_secs_f64());
        assert!(matches!(h.sup.state(), EngineState::Ready { sample_rate: 44100, .. }));
        h.queue.enqueue(vec![
            job("d1", "[驚いて]本当に？[明るく]それは楽しみだね。", out.path(), 1, r#"{"temperature":0.9}"#),
            job("d2", "[囁き]ねえ、こっちに来て。", out.path(), 2, r#"{"speed":2.0}"#),
        ]);
        expected += 2;
        let takes = wait_done(&h, expected).await;
        for t in &takes {
            eprintln!("{} {:.2}s seed {:?} {}", t.file, t.duration, t.seed, t.stop_reason);
            assert!(t.duration > 0.5);
            assert_eq!(t.sample_rate, 44100);
            assert!(out.path().join(&t.file).exists());
        }
    }
    if let Some(model) = env("VS_IRODORI_MODEL") {
        let p = ModelProfile::new("i", "irodori", "irodori", &model, &exe);
        let t = std::time::Instant::now();
        h.sup.start(&p, model.clone()).await.expect("irodori start");
        eprintln!("switched to irodori in {:.1}s", t.elapsed().as_secs_f64());
        let mut j = job("i1", "🤭ふふ、[笑い]そうなんだ。", out.path(), 3, r#"{"speed":1.1,"steps":6,"top_k":5}"#);
        j.request.design_prompt = Some("明るく元気な若い女性の声で".into());
        h.queue.enqueue(vec![j]);
        expected += 1;
        let takes = wait_done(&h, expected).await;
        let t = takes.last().unwrap();
        eprintln!("{} {:.2}s {:?}", t.file, t.duration, t.options_snapshot);
        assert_eq!(t.sample_rate, 48000);
        assert_eq!(t.options_snapshot["instructions"], "明るく元気な若い女性の声で");
        assert_eq!(t.text, "🤭ふふ、そうなんだ。");
        assert!(t.options_snapshot.get("top_k").is_none());
    }
    h.sup.stop().await;
    assert_eq!(h.sup.state(), EngineState::Stopped);
}
