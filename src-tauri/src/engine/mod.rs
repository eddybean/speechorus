//! The speech.cpp engine: protocol, connection and the process supervisor.

mod connection;
mod protocol;
mod supervisor;

pub use connection::{EngineError, WorkerConnection};
pub use protocol::{ReadyInfo, WorkerError, WorkerMsg, PROTOCOL};
pub(crate) use supervisor::no_window;
pub use supervisor::{EngineState, EngineSupervisor, Live};
