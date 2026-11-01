use serde_json::Value;
pub(crate) const MAX_FRAME: usize = 256 * 1024;

// Shared byte framing only. Each provider owns message lifecycle and success.
pub(crate) struct Decoder {
    invalid: &'static str,
    line: Vec<u8>,
    data: Vec<u8>,
    event: Option<String>,
    after_cr: bool,
}

impl Decoder {
    pub(crate) fn new(invalid: &'static str) -> Self {
        Self {
            invalid,
            line: Vec::new(),
            data: Vec::new(),
            event: None,
            after_cr: false,
        }
    }
    pub(crate) fn push(
        &mut self,
        bytes: &[u8],
        mut emit: impl FnMut(Value) -> Result<bool, String>,
    ) -> Result<bool, String> {
        for byte in bytes {
            if self.after_cr {
                self.after_cr = false;
                if *byte == b'\n' {
                    continue;
                }
            }
            if *byte == b'\r' || *byte == b'\n' {
                self.after_cr = *byte == b'\r';
                if self.line.is_empty() {
                    if !self.data.is_empty() {
                        let event: Value =
                            serde_json::from_slice(&self.data).map_err(|_| self.invalid)?;
                        self.data.clear();
                        if self
                            .event
                            .take()
                            .is_some_and(|kind| event["type"].as_str() != Some(kind.as_str()))
                        {
                            return Err(self.invalid.into());
                        }
                        if emit(event)? {
                            return Ok(true);
                        }
                    } else {
                        self.event = None;
                    }
                } else if self.line.starts_with(b"data:") {
                    let data = self.line[5..].strip_prefix(b" ").unwrap_or(&self.line[5..]);
                    if self.data.len() + data.len() + 1 > MAX_FRAME {
                        return Err(self.invalid.into());
                    }
                    if !self.data.is_empty() {
                        self.data.push(b'\n');
                    }
                    self.data.extend_from_slice(data);
                } else if self.line.starts_with(b"event:") {
                    let kind = self.line[6..].strip_prefix(b" ").unwrap_or(&self.line[6..]);
                    self.event = Some(std::str::from_utf8(kind).map_err(|_| self.invalid)?.into());
                }
                self.line.clear();
            } else {
                if self.line.len() >= MAX_FRAME {
                    return Err(self.invalid.into());
                }
                self.line.push(*byte);
            }
        }
        Ok(false)
    }
}
