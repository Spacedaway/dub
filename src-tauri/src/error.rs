use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error("journal error: {0}")]
    Journal(#[from] rusqlite::Error),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("another batch is already running")]
    BatchAlreadyRunning,
    #[error("batch {0} was not found")]
    BatchNotFound(String),
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("internal error: {0}")]
    Internal(String),
}

impl CommandError {
    fn kind(&self) -> &'static str {
        match self {
            Self::Journal(_) => "journal",
            Self::Io(_) => "io",
            Self::BatchAlreadyRunning => "batchAlreadyRunning",
            Self::BatchNotFound(_) => "batchNotFound",
            Self::InvalidRequest(_) => "invalidRequest",
            Self::Internal(_) => "internal",
        }
    }
}

impl Serialize for CommandError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("CommandError", 2)?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}
