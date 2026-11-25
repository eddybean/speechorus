//! Events the core sends to the UI (one Tauri event channel, `vs://event`).

use std::sync::Arc;

use serde::Serialize;

use crate::engine::EngineState;
use crate::jobs::QueueEvent;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", content = "data", rename_all = "camelCase")]
pub enum AppEvent {
    Engine(EngineState),
    EngineLog { line: String },
    Queue(QueueEvent),
}

pub type Emit = Arc<dyn Fn(AppEvent) + Send + Sync>;

pub fn null_emit() -> Emit {
    Arc::new(|_| {})
}
