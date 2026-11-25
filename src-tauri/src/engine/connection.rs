//! A live JSON Lines connection to a `speech worker`, over any reader/writer pair
//! (the child's pipes in the app, in-memory pipes in tests).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::{json, Map, Value};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, watch, Mutex as AsyncMutex};

use super::protocol::{ReadyInfo, WorkerError, WorkerMsg, PROTOCOL};

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("the engine is not running")]
    NotRunning,
    #[error("the engine could not start: {0}")]
    Fatal(WorkerError),
    #[error("the engine speaks protocol {0}; Speechorus needs {PROTOCOL}")]
    Protocol(u64),
    #[error("the engine exited: {0}")]
    Exited(String),
    #[error("{0}")]
    Worker(WorkerError),
    #[error("engine protocol: {0}")]
    Parse(#[from] super::protocol::ParseError),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("request cancelled")]
    Cancelled,
    #[error("{0}")]
    Other(String),
}

type Pending = Arc<Mutex<HashMap<String, mpsc::UnboundedSender<WorkerMsg>>>>;

pub struct WorkerConnection {
    writer: AsyncMutex<Box<dyn AsyncWrite + Unpin + Send>>,
    pending: Pending,
    ready: ReadyInfo,
    alive: watch::Receiver<bool>,
}

impl WorkerConnection {
    /// Waits for `ready` (or `fatal`) and then routes every later line to its request.
    /// `on_orphan` receives lines that name no request in flight (errors without id, unknown types).
    pub async fn handshake<R, W>(
        reader: R,
        writer: W,
        on_orphan: Arc<dyn Fn(String) + Send + Sync>,
    ) -> Result<Arc<WorkerConnection>, EngineError>
    where
        R: AsyncRead + Unpin + Send + 'static,
        W: AsyncWrite + Unpin + Send + 'static,
    {
        let mut lines = BufReader::new(reader).lines();
        let ready = loop {
            let Some(line) = lines.next_line().await? else {
                return Err(EngineError::Exited("stdout closed before ready".into()));
            };
            if line.trim().is_empty() {
                continue;
            }
            match WorkerMsg::parse(&line)? {
                WorkerMsg::Ready {
                    protocol,
                    version,
                    defaults,
                    model,
                } => {
                    if protocol != PROTOCOL {
                        return Err(EngineError::Protocol(protocol));
                    }
                    break ReadyInfo {
                        protocol,
                        version,
                        defaults,
                        model,
                    };
                }
                WorkerMsg::Fatal { error } => return Err(EngineError::Fatal(error)),
                other => on_orphan(format!("before ready: {other:?}")),
            }
        };
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let (alive_tx, alive_rx) = watch::channel(true);
        let p = pending.clone();
        tokio::spawn(async move {
            let reason = loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        if line.trim().is_empty() {
                            continue;
                        }
                        match WorkerMsg::parse(&line) {
                            Ok(msg) => route(&p, msg, &on_orphan),
                            Err(e) => {
                                // The protocol says a caller fails on such a line; we fail the
                                // requests in flight but keep the process for the user to restart.
                                on_orphan(e.to_string());
                            }
                        }
                    }
                    Ok(None) => break "stdout closed".to_string(),
                    Err(e) => break e.to_string(),
                }
            };
            let mut map = p.lock().unwrap();
            for (id, tx) in map.drain() {
                let _ = tx.send(WorkerMsg::Error {
                    id: Some(id),
                    error: WorkerError {
                        code: "engine_exit".into(),
                        option: None,
                        message: reason.clone(),
                    },
                });
            }
            let _ = alive_tx.send(false);
        });
        Ok(Arc::new(WorkerConnection {
            writer: AsyncMutex::new(Box::new(writer)),
            pending,
            ready,
            alive: alive_rx,
        }))
    }

    pub fn ready(&self) -> &ReadyInfo {
        &self.ready
    }

    pub fn is_alive(&self) -> bool {
        *self.alive.borrow()
    }

    pub async fn closed(&self) {
        let mut a = self.alive.clone();
        while *a.borrow() {
            if a.changed().await.is_err() {
                break;
            }
        }
    }

    async fn write(&self, v: &Value) -> Result<(), EngineError> {
        let mut line = serde_json::to_string(v).map_err(|e| EngineError::Other(e.to_string()))?;
        line.push('\n');
        let mut w = self.writer.lock().await;
        w.write_all(line.as_bytes()).await?;
        w.flush().await?;
        Ok(())
    }

    /// Sends a request (an object with `type`, members and options) under `id`
    /// and returns the stream of its answers, ending with its terminal message.
    pub async fn request(
        &self,
        id: &str,
        mut msg: Map<String, Value>,
    ) -> Result<mpsc::UnboundedReceiver<WorkerMsg>, EngineError> {
        if !self.is_alive() {
            return Err(EngineError::NotRunning);
        }
        msg.insert("id".into(), Value::String(id.into()));
        let (tx, rx) = mpsc::unbounded_channel();
        self.pending.lock().unwrap().insert(id.to_string(), tx);
        if let Err(e) = self.write(&Value::Object(msg)).await {
            self.pending.lock().unwrap().remove(id);
            return Err(e);
        }
        Ok(rx)
    }

    /// Sends a request and waits for its terminal message, ignoring anything before it.
    pub async fn call(
        &self,
        id: &str,
        msg: Map<String, Value>,
    ) -> Result<Map<String, Value>, EngineError> {
        let mut rx = self.request(id, msg).await?;
        while let Some(m) = rx.recv().await {
            match m {
                WorkerMsg::End { rest, .. } => return Ok(rest),
                WorkerMsg::Error { error, .. } => return Err(EngineError::Worker(error)),
                WorkerMsg::Cancelled { .. } => return Err(EngineError::Cancelled),
                _ => {}
            }
        }
        Err(EngineError::Exited("no answer".into()))
    }

    pub async fn cancel(&self, id: &str) -> Result<(), EngineError> {
        self.write(&json!({"type": "cancel", "id": id})).await
    }

    pub async fn add_voice(&self, name: &str, path: &str) -> Result<(), EngineError> {
        let id = format!("voice-{}", uuid::Uuid::new_v4().simple());
        let mut m = Map::new();
        m.insert("type".into(), "add_voice".into());
        m.insert("name".into(), name.into());
        m.insert("path".into(), path.into());
        self.call(&id, m).await.map(|_| ())
    }

    pub async fn count_tokens(&self, text: &str) -> Result<u64, EngineError> {
        let id = format!("count-{}", uuid::Uuid::new_v4().simple());
        let mut m = Map::new();
        m.insert("type".into(), "count_tokens".into());
        m.insert("text".into(), text.into());
        let r = self.call(&id, m).await?;
        Ok(r.get("tokens").and_then(Value::as_u64).unwrap_or(0))
    }

    /// Closes stdin, which makes the worker finish what it has and exit 0.
    pub async fn close(&self) {
        let mut w = self.writer.lock().await;
        let _ = w.shutdown().await;
    }
}

fn route(p: &Pending, msg: WorkerMsg, on_orphan: &Arc<dyn Fn(String) + Send + Sync>) {
    let Some(id) = msg.id().map(str::to_owned) else {
        on_orphan(format!("{msg:?}"));
        return;
    };
    let mut map = p.lock().unwrap();
    let terminal = msg.is_terminal();
    match map.get(&id) {
        Some(tx) => {
            let _ = tx.send(msg);
            if terminal {
                map.remove(&id);
            }
        }
        None => on_orphan(format!("for no request in flight: {msg:?}")),
    }
}
