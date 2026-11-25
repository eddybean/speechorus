//! Keeps at most one `speech worker` alive and switches it between model profiles.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

use super::connection::{EngineError, WorkerConnection};
use crate::events::{AppEvent, Emit};
use crate::models::{adapter_for, ModelAdapter};
use crate::settings::ModelProfile;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum EngineState {
    Stopped,
    Loading {
        profile_id: String,
    },
    Ready {
        profile_id: String,
        model: serde_json::Value,
        sample_rate: u32,
    },
    Failed {
        profile_id: String,
        message: String,
    },
}

struct Inner {
    state: EngineState,
    conn: Option<Arc<WorkerConnection>>,
    child: Option<Child>,
    adapter: Option<Arc<dyn ModelAdapter>>,
    /// Worker voice name → file it was added from.
    voices: HashMap<String, String>,
    /// Bumped on every start/stop so a stale start cannot overwrite a newer one.
    generation: u64,
}

pub struct EngineSupervisor {
    inner: Mutex<Inner>,
    emit: Emit,
}

/// A handle to the running engine, taken by one job.
#[derive(Clone)]
pub struct Live {
    pub conn: Arc<WorkerConnection>,
    pub adapter: Arc<dyn ModelAdapter>,
}

pub(crate) fn no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let _ = cmd;
}

impl EngineSupervisor {
    pub fn new(emit: Emit) -> Arc<Self> {
        Arc::new(EngineSupervisor {
            inner: Mutex::new(Inner {
                state: EngineState::Stopped,
                conn: None,
                child: None,
                adapter: None,
                voices: HashMap::new(),
                generation: 0,
            }),
            emit,
        })
    }

    pub fn state(&self) -> EngineState {
        self.inner.lock().unwrap().state.clone()
    }

    fn set_state(&self, s: EngineState) {
        self.inner.lock().unwrap().state = s.clone();
        (self.emit)(AppEvent::Engine(s));
    }

    pub fn live(&self) -> Result<Live, EngineError> {
        let g = self.inner.lock().unwrap();
        match (&g.conn, &g.adapter) {
            (Some(c), Some(a)) if c.is_alive() => Ok(Live {
                conn: c.clone(),
                adapter: a.clone(),
            }),
            _ => Err(EngineError::NotRunning),
        }
    }

    /// Attaches an already connected worker (tests, or a custom transport).
    pub fn attach(
        &self,
        conn: Arc<WorkerConnection>,
        adapter: Arc<dyn ModelAdapter>,
        profile_id: &str,
    ) {
        let mut g = self.inner.lock().unwrap();
        g.generation += 1;
        g.voices.clear();
        g.state = EngineState::Ready {
            profile_id: profile_id.into(),
            model: conn.ready().model.clone(),
            sample_rate: conn.ready().sample_rate(),
        };
        g.conn = Some(conn);
        g.adapter = Some(adapter);
    }

    /// Stops the current worker (if any) and starts one for `profile`.
    pub async fn start(
        self: &Arc<Self>,
        profile: &ModelProfile,
        model_path: String,
    ) -> Result<(), EngineError> {
        self.stop().await;
        let adapter = adapter_for(&profile.adapter)
            .ok_or_else(|| EngineError::Other(format!("unknown adapter {}", profile.adapter)))?;
        let my_gen = {
            let mut g = self.inner.lock().unwrap();
            g.generation += 1;
            g.generation
        };
        self.set_state(EngineState::Loading {
            profile_id: profile.id.clone(),
        });

        let mut cmd = Command::new(&profile.speech_exe);
        cmd.arg("worker").arg(&model_path);
        if !profile.device.is_empty() {
            cmd.arg("--device").arg(&profile.device);
        }
        if let Some(t) = profile.threads {
            cmd.arg("--threads").arg(t.to_string());
        }
        cmd.args(&profile.extra_args);
        cmd.env("SPEECH_NO_UPDATE_CHECK", "1");
        for (k, v) in &profile.env {
            cmd.env(k, v);
        }
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        no_window(&mut cmd);
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let msg = format!("{}: {e}", profile.speech_exe);
                self.set_state(EngineState::Failed {
                    profile_id: profile.id.clone(),
                    message: msg.clone(),
                });
                return Err(EngineError::Other(msg));
            }
        };
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let emit = self.emit.clone();
        let last_err: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let le = last_err.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                {
                    let mut v = le.lock().unwrap();
                    v.push(l.clone());
                    if v.len() > 20 {
                        v.remove(0);
                    }
                }
                emit(AppEvent::EngineLog { line: l });
            }
        });
        self.inner.lock().unwrap().child = Some(child);
        let emit = self.emit.clone();
        let orphan: Arc<dyn Fn(String) + Send + Sync> = Arc::new(move |l| {
            emit(AppEvent::EngineLog {
                line: format!("[protocol] {l}"),
            })
        });
        let res = WorkerConnection::handshake(stdout, stdin, orphan).await;
        let stale = self.inner.lock().unwrap().generation != my_gen;
        match res {
            Ok(conn) if !stale => {
                {
                    let mut g = self.inner.lock().unwrap();
                    g.conn = Some(conn.clone());
                    g.adapter = Some(adapter);
                    g.voices.clear();
                }
                self.set_state(EngineState::Ready {
                    profile_id: profile.id.clone(),
                    model: conn.ready().model.clone(),
                    sample_rate: conn.ready().sample_rate(),
                });
                // Report an unexpected exit.
                let me = self.clone();
                tokio::spawn(async move {
                    conn.closed().await;
                    let still_current = me.inner.lock().unwrap().generation == my_gen;
                    if still_current {
                        me.inner.lock().unwrap().conn = None;
                        let tail = last_err.lock().unwrap().join("\n");
                        me.set_state(EngineState::Failed {
                            profile_id: String::new(),
                            message: format!("the engine exited\n{tail}"),
                        });
                    }
                });
                Ok(())
            }
            Ok(conn) => {
                conn.close().await;
                Err(EngineError::Other("superseded by another start".into()))
            }
            Err(e) => {
                if !stale {
                    let tail = last_err.lock().unwrap().join("\n");
                    self.kill_child().await;
                    self.set_state(EngineState::Failed {
                        profile_id: profile.id.clone(),
                        message: format!("{e}\n{tail}"),
                    });
                }
                Err(e)
            }
        }
    }

    async fn kill_child(&self) {
        let child = self.inner.lock().unwrap().child.take();
        if let Some(mut c) = child {
            let _ = c.kill().await;
        }
    }

    pub async fn stop(&self) {
        let (conn, child) = {
            let mut g = self.inner.lock().unwrap();
            g.generation += 1;
            g.voices.clear();
            g.adapter = None;
            (g.conn.take(), g.child.take())
        };
        if let Some(c) = conn {
            c.close().await;
        }
        if let Some(mut ch) = child {
            // The worker exits 0 once stdin closes; give it a moment, then kill.
            if tokio::time::timeout(std::time::Duration::from_secs(3), ch.wait())
                .await
                .is_err()
            {
                let _ = ch.kill().await;
            }
        }
        if self.state() != EngineState::Stopped {
            self.set_state(EngineState::Stopped);
        }
    }

    /// Adds a voice file to the running worker under `name` unless it is there already.
    pub async fn ensure_voice(
        &self,
        live: &Live,
        name: &str,
        path: &str,
    ) -> Result<(), EngineError> {
        let known = self.inner.lock().unwrap().voices.get(name).cloned();
        if known.as_deref() == Some(path) {
            return Ok(());
        }
        // A changed file under a known name gets a fresh name, since a worker cannot replace a voice.
        live.conn.add_voice(name, path).await?;
        self.inner
            .lock()
            .unwrap()
            .voices
            .insert(name.into(), path.into());
        Ok(())
    }
}
