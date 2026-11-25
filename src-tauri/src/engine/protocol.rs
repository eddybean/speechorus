//! Messages of the `speech worker` JSON Lines protocol (protocol 4, speech.cpp 0.11.2).
//! See docs/engine-protocol.md.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// The protocol version this client was written against. `ready.protocol` must match.
pub const PROTOCOL: u64 = 4;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkerError {
    pub code: String,
    #[serde(default)]
    pub option: Option<String>,
    #[serde(default)]
    pub message: String,
}

impl std::fmt::Display for WorkerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.option {
            Some(o) => write!(f, "{} ({}): {}", self.code, o, self.message),
            None => write!(f, "{}: {}", self.code, self.message),
        }
    }
}

/// One line the worker writes on stdout.
#[derive(Debug, Clone, PartialEq)]
pub enum WorkerMsg {
    Ready {
        protocol: u64,
        version: String,
        defaults: Value,
        model: Value,
    },
    Fatal {
        error: WorkerError,
    },
    Chunk {
        id: String,
        seq: u64,
        pcm: String,
    },
    Progress {
        id: String,
        done: f64,
    },
    /// Terminal success. `rest` holds the members besides `type` and `id`
    /// (`seed`, `samples`, `stop`, `text`, `model`, `tokens` …).
    End {
        id: String,
        rest: Map<String, Value>,
    },
    /// Terminal failure; `id` is absent when the line named no request.
    Error {
        id: Option<String>,
        error: WorkerError,
    },
    Cancelled {
        id: String,
    },
    /// A message type added after protocol 4; ignored by callers.
    Unknown {
        kind: String,
        raw: Value,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("worker wrote a line that is not JSON: {0}")]
    NotJson(String),
    #[error("worker wrote a line without a string `type`: {0}")]
    NoType(String),
    #[error("worker message `{0}` lacks or mistypes a member: {1}")]
    Member(String, String),
}

fn s(o: &Map<String, Value>, k: &str, t: &str) -> Result<String, ParseError> {
    o.get(k)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| ParseError::Member(t.into(), k.into()))
}

fn err(o: &Map<String, Value>, t: &str) -> Result<WorkerError, ParseError> {
    serde_json::from_value(o.get("error").cloned().unwrap_or(Value::Null))
        .map_err(|_| ParseError::Member(t.into(), "error".into()))
}

impl WorkerMsg {
    pub fn parse(line: &str) -> Result<WorkerMsg, ParseError> {
        let v: Value = serde_json::from_str(line).map_err(|_| ParseError::NotJson(line.into()))?;
        let Value::Object(mut o) = v else {
            return Err(ParseError::NotJson(line.into()));
        };
        let t = o
            .get("type")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| ParseError::NoType(line.into()))?;
        Ok(match t.as_str() {
            "ready" => WorkerMsg::Ready {
                protocol: o.get("protocol").and_then(Value::as_u64).unwrap_or(0),
                version: o
                    .get("version")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .into(),
                defaults: o.remove("defaults").unwrap_or(Value::Null),
                model: o.remove("model").unwrap_or(Value::Null),
            },
            "fatal" => WorkerMsg::Fatal {
                error: err(&o, &t)?,
            },
            "chunk" => WorkerMsg::Chunk {
                id: s(&o, "id", &t)?,
                seq: o.get("seq").and_then(Value::as_u64).unwrap_or(0),
                pcm: s(&o, "pcm", &t)?,
            },
            "progress" => WorkerMsg::Progress {
                id: s(&o, "id", &t)?,
                done: o.get("done").and_then(Value::as_f64).unwrap_or(0.0),
            },
            "end" => {
                let id = s(&o, "id", &t)?;
                o.remove("type");
                o.remove("id");
                WorkerMsg::End { id, rest: o }
            }
            "error" => WorkerMsg::Error {
                id: o.get("id").and_then(Value::as_str).map(str::to_owned),
                error: err(&o, &t)?,
            },
            "cancelled" => WorkerMsg::Cancelled {
                id: s(&o, "id", &t)?,
            },
            _ => WorkerMsg::Unknown {
                kind: t,
                raw: Value::Object(o),
            },
        })
    }

    /// The request this message belongs to, if any.
    pub fn id(&self) -> Option<&str> {
        match self {
            WorkerMsg::Chunk { id, .. }
            | WorkerMsg::Progress { id, .. }
            | WorkerMsg::End { id, .. }
            | WorkerMsg::Cancelled { id } => Some(id),
            WorkerMsg::Error { id, .. } => id.as_deref(),
            _ => None,
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            WorkerMsg::End { .. } | WorkerMsg::Error { .. } | WorkerMsg::Cancelled { .. }
        )
    }
}

/// What the worker said about itself on `ready`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadyInfo {
    pub protocol: u64,
    pub version: String,
    pub defaults: Value,
    pub model: Value,
}

impl ReadyInfo {
    pub fn sample_rate(&self) -> u32 {
        self.model
            .get("sample_rate")
            .and_then(Value::as_u64)
            .unwrap_or(44_100) as u32
    }
    pub fn architecture(&self) -> &str {
        self.model
            .get("architecture")
            .and_then(Value::as_str)
            .unwrap_or("")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_every_answer_kind() {
        let r = WorkerMsg::parse(r#"{"type":"ready","protocol":4,"version":"0.11.2","defaults":{},"model":{"sample_rate":48000}}"#).unwrap();
        assert!(matches!(r, WorkerMsg::Ready { protocol: 4, .. }));
        let c = WorkerMsg::parse(r#"{"type":"chunk","id":"a","seq":3,"pcm":"AAA="}"#).unwrap();
        assert_eq!(c.id(), Some("a"));
        assert!(!c.is_terminal());
        let e =
            WorkerMsg::parse(r#"{"type":"end","id":"a","seed":42,"samples":10,"stop":"complete"}"#)
                .unwrap();
        match &e {
            WorkerMsg::End { rest, .. } => {
                assert_eq!(rest["seed"], 42);
                assert!(!rest.contains_key("type"));
            }
            _ => panic!(),
        }
        assert!(e.is_terminal());
        let er = WorkerMsg::parse(
            r#"{"type":"error","error":{"code":"invalid_argument","option":null,"message":"x"}}"#,
        )
        .unwrap();
        assert_eq!(er.id(), None);
        assert!(matches!(
            WorkerMsg::parse(r#"{"type":"cancelled","id":"z"}"#).unwrap(),
            WorkerMsg::Cancelled { .. }
        ));
        assert!(matches!(
            WorkerMsg::parse(r#"{"type":"future","id":"z"}"#).unwrap(),
            WorkerMsg::Unknown { .. }
        ));
    }

    #[test]
    fn rejects_non_protocol_lines() {
        assert!(WorkerMsg::parse("loading...").is_err());
        assert!(WorkerMsg::parse("[1,2]").is_err());
        assert!(WorkerMsg::parse(r#"{"id":"a"}"#).is_err());
    }
}
