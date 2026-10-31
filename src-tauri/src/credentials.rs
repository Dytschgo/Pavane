use std::fmt;
use std::path::Path;
use std::sync::atomic::{Ordering, compiler_fence};

const MAX_KEY_BYTES: usize = 2048;
const INVALID_KEY: &str =
    "Enter a Gemini API key containing 1–2048 ASCII characters without spaces.";
const INVALID_CLAUDE_KEY: &str =
    "Enter a Claude API key containing 1–2048 ASCII characters without spaces.";
const INVALID_CLAUDE_WORKSPACE: &str = "Enter a Claude workspace ID beginning with wrkspc_ and containing at most 128 ASCII letters, digits or underscores.";
#[cfg(any(windows, test))]
const CLAUDE_BLOB_MAGIC: &[u8; 4] = b"PVC1";
#[cfg(any(windows, test))]
const MAX_CLAUDE_BLOB_BYTES: usize = 4 + 2 + 1 + MAX_KEY_BYTES + 128;
#[cfg(any(windows, test))]
const CLAUDE_READ_ERROR: &str = "Cannot read the saved Claude API connection.";
#[cfg(not(windows))]
const UNSUPPORTED: &str = "Gemini API key storage is supported only on Windows.";
#[cfg(not(windows))]
const CLAUDE_UNSUPPORTED: &str = "Claude API connection storage is supported only on Windows.";

/// Native-only secret: deliberately neither serializable nor cloneable.
pub(crate) struct Secret {
    bytes: Vec<u8>,
}

impl Secret {
    pub(crate) fn new(value: String) -> Result<Self, String> {
        Self::from_bytes(value.into_bytes())
    }

    fn from_bytes(bytes: Vec<u8>) -> Result<Self, String> {
        // Take ownership before checking so rejected input is also wiped on drop.
        let secret = Self { bytes };
        if secret.bytes.is_empty()
            || secret.bytes.len() > MAX_KEY_BYTES
            || !secret.bytes.iter().all(u8::is_ascii_graphic)
        {
            return Err(INVALID_KEY.into());
        }
        Ok(secret)
    }

    pub(crate) fn as_bytes(&self) -> &[u8] {
        &self.bytes
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("Secret([REDACTED])")
    }
}

impl Drop for Secret {
    fn drop(&mut self) {
        wipe(&mut self.bytes);
    }
}

/// An API key and optional workspace form one native-only connection identity.
/// The workspace is an identifier, not a secret, but Debug hides both fields.
pub(crate) struct ClaudeCredential {
    key: Secret,
    workspace: Option<String>,
}

impl ClaudeCredential {
    pub(crate) fn new(key: String, workspace: Option<String>) -> Result<Self, String> {
        let key = Secret::new(key).map_err(|_| INVALID_CLAUDE_KEY)?;
        let workspace = normalize_claude_workspace(workspace)?;
        Ok(Self { key, workspace })
    }

    pub(crate) fn key(&self) -> &Secret {
        &self.key
    }

    pub(crate) fn workspace(&self) -> Option<&str> {
        self.workspace.as_deref()
    }

    pub(crate) fn same_identity(&self, other: &Self) -> bool {
        self.key.as_bytes() == other.key.as_bytes() && self.workspace == other.workspace
    }

    #[cfg(any(windows, test))]
    fn encode(&self) -> WipeBuffer {
        // A fixed binary envelope avoids serializing the API key into a String.
        // PVC1 identifies this format/version. Both fields replace atomically.
        let workspace = self.workspace.as_deref().unwrap_or_default().as_bytes();
        let mut bytes = Vec::with_capacity(7 + self.key.bytes.len() + workspace.len());
        bytes.extend_from_slice(CLAUDE_BLOB_MAGIC);
        bytes.extend_from_slice(&(self.key.bytes.len() as u16).to_le_bytes());
        bytes.push(workspace.len() as u8);
        bytes.extend_from_slice(self.key.as_bytes());
        bytes.extend_from_slice(workspace);
        WipeBuffer(bytes)
    }

    #[cfg(any(windows, test))]
    fn decode(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() < 7
            || bytes.len() > MAX_CLAUDE_BLOB_BYTES
            || &bytes[..4] != CLAUDE_BLOB_MAGIC
        {
            return Err(CLAUDE_READ_ERROR.into());
        }
        let key_len = u16::from_le_bytes([bytes[4], bytes[5]]) as usize;
        let workspace_len = bytes[6] as usize;
        if !(1..=MAX_KEY_BYTES).contains(&key_len)
            || workspace_len > 128
            || bytes.len() != 7 + key_len + workspace_len
        {
            return Err(CLAUDE_READ_ERROR.into());
        }
        let key =
            Secret::from_bytes(bytes[7..7 + key_len].to_vec()).map_err(|_| CLAUDE_READ_ERROR)?;
        let workspace = if workspace_len == 0 {
            None
        } else {
            Some(
                std::str::from_utf8(&bytes[7 + key_len..])
                    .map_err(|_| CLAUDE_READ_ERROR)?
                    .to_owned(),
            )
        };
        let workspace = normalize_claude_workspace(workspace).map_err(|_| CLAUDE_READ_ERROR)?;
        Ok(Self { key, workspace })
    }
}

impl fmt::Debug for ClaudeCredential {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ClaudeCredential([REDACTED])")
    }
}

fn normalize_claude_workspace(workspace: Option<String>) -> Result<Option<String>, String> {
    let workspace = workspace.filter(|workspace| !workspace.is_empty());
    if let Some(value) = workspace.as_deref() {
        let valid = value.len() <= 128
            && value.strip_prefix("wrkspc_").is_some_and(|suffix| {
                !suffix.is_empty()
                    && suffix
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
            });
        if !valid {
            return Err(INVALID_CLAUDE_WORKSPACE.into());
        }
    }
    Ok(workspace)
}

#[cfg(any(windows, test))]
struct WipeBuffer(Vec<u8>);

#[cfg(any(windows, test))]
impl Drop for WipeBuffer {
    fn drop(&mut self) {
        wipe(&mut self.0);
    }
}

/// Best effort for owned buffers only; HTTP, IPC, and OS transient copies may remain.
pub(crate) fn wipe(bytes: &mut [u8]) {
    for byte in bytes {
        // SAFETY: each pointer comes from a live, exclusively borrowed byte.
        unsafe { std::ptr::write_volatile(byte, 0) };
    }
    compiler_fence(Ordering::SeqCst);
}

/// The native caller supplies the existing database directory, never a vault target.
pub(crate) struct Vault {
    #[cfg(windows)]
    target: Vec<u16>,
}

pub(crate) struct ClaudeVault {
    #[cfg(windows)]
    target: Vec<u16>,
}

#[cfg(windows)]
mod windows {
    use super::*;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::{NonNull, null_mut};
    use std::sync::Mutex;
    use windows_sys::Win32::Foundation::{ERROR_NOT_FOUND, GetLastError};
    use windows_sys::Win32::Security::Credentials::{
        CRED_MAX_CREDENTIAL_BLOB_SIZE, CRED_MAX_GENERIC_TARGET_NAME_LENGTH,
        CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC, CREDENTIALW, CredDeleteW, CredFree,
        CredReadW, CredWriteW,
    };

    const PROFILE_ERROR: &str = "Cannot select Gemini API key storage for this profile.";
    const READ_ERROR: &str = "Cannot read the saved Gemini API key.";
    const WRITE_ERROR: &str = "Cannot save the Gemini API key.";
    const DELETE_ERROR: &str = "Cannot remove the saved Gemini API key.";
    const CLAUDE_PROFILE_ERROR: &str =
        "Cannot select Claude API connection storage for this profile.";
    const CLAUDE_WRITE_ERROR: &str = "Cannot save the Claude API connection.";
    const CLAUDE_DELETE_ERROR: &str = "Cannot remove the saved Claude API connection.";

    // One process-wide boundary across all profile handles. Keep the synchronous
    // OS operation and read-buffer disposal together; never hold this over HTTP
    // or an await. Poisoning fails closed through the existing redacted errors.
    static CREDENTIAL_ACCESS: Mutex<()> = Mutex::new(());

    fn profile_target(directory: &Path, prefix: &str, error: &str) -> Result<Vec<u16>, String> {
        let directory = directory.canonicalize().map_err(|_| error)?;
        if !directory.is_dir() {
            return Err(error.into());
        }
        let mut target: Vec<u16> = prefix
            .encode_utf16()
            .chain(directory.as_os_str().encode_wide())
            .collect();
        if target.len() > CRED_MAX_GENERIC_TARGET_NAME_LENGTH as usize || target.contains(&0) {
            return Err(error.into());
        }
        target.push(0);
        Ok(target)
    }

    fn read_credential<T>(
        target: &[u16],
        maximum: usize,
        error_message: &str,
        decode: impl FnOnce(&[u8]) -> Result<T, String>,
    ) -> Result<Option<T>, String> {
        let _access = CREDENTIAL_ACCESS.lock().map_err(|_| error_message)?;
        let mut raw = null_mut();
        // SAFETY: only profile_target constructs these NUL-terminated targets;
        // raw is a valid output pointer.
        let success = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut raw) };
        // Capture before any other Windows call can change the thread error.
        let error = if success == 0 {
            // SAFETY: GetLastError has no preconditions.
            unsafe { GetLastError() }
        } else {
            0
        };
        // Own even an unexpected non-null failure result. Read-buffer disposal
        // and decoding stay inside the same process-wide credential lock.
        let buffer = NonNull::new(raw).map(CredentialBuffer);
        if success == 0 {
            return if error == ERROR_NOT_FOUND {
                Ok(None)
            } else {
                Err(error_message.into())
            };
        }
        let buffer = buffer.ok_or(error_message)?;
        // SAFETY: a successful CredReadW returns a CREDENTIALW allocation.
        let credential = unsafe { buffer.0.as_ref() };
        let size = credential.CredentialBlobSize as usize;
        if credential.Type != CRED_TYPE_GENERIC
            || size == 0
            || size > maximum
            || credential.CredentialBlob.is_null()
        {
            return Err(error_message.into());
        }
        // SAFETY: size is bounded and the OS-owned pointer is non-null.
        let bytes = unsafe { std::slice::from_raw_parts(credential.CredentialBlob, size) };
        decode(bytes).map(Some)
    }

    fn write_credential(target: &[u16], bytes: &mut [u8], error: &str) -> Result<(), String> {
        if bytes.len() > CRED_MAX_CREDENTIAL_BLOB_SIZE as usize {
            return Err(error.into());
        }
        let _access = CREDENTIAL_ACCESS.lock().map_err(|_| error)?;
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_ptr().cast_mut(),
            CredentialBlobSize: bytes.len() as u32,
            CredentialBlob: bytes.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..CREDENTIALW::default()
        };
        // SAFETY: the bounded owned bytes and NUL-terminated target live through
        // this synchronous replacement. Never delete before writing.
        if unsafe { CredWriteW(&credential, 0) } == 0 {
            return Err(error.into());
        }
        Ok(())
    }

    fn delete_credential(target: &[u16], error: &str) -> Result<(), String> {
        let _access = CREDENTIAL_ACCESS.lock().map_err(|_| error)?;
        // SAFETY: target is a valid NUL-terminated string.
        if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } != 0 {
            return Ok(());
        }
        // SAFETY: GetLastError has no preconditions.
        if unsafe { GetLastError() } == ERROR_NOT_FOUND {
            Ok(())
        } else {
            Err(error.into())
        }
    }

    impl Vault {
        pub(crate) fn new(directory: &Path) -> Result<Self, String> {
            Ok(Self {
                target: profile_target(directory, "Pavane/Gemini/v1/", PROFILE_ERROR)?,
            })
        }

        pub(crate) fn read(&self) -> Result<Option<Secret>, String> {
            read_credential(&self.target, MAX_KEY_BYTES, READ_ERROR, |bytes| {
                Secret::from_bytes(bytes.to_vec()).map_err(|_| READ_ERROR.into())
            })
        }

        pub(crate) fn write(&self, mut secret: Secret) -> Result<(), String> {
            write_credential(&self.target, &mut secret.bytes, WRITE_ERROR)
        }

        pub(crate) fn delete(&self) -> Result<(), String> {
            delete_credential(&self.target, DELETE_ERROR)
        }
    }

    impl ClaudeVault {
        pub(crate) fn new(directory: &Path) -> Result<Self, String> {
            Ok(Self {
                target: profile_target(directory, "Pavane/Claude/v1/", CLAUDE_PROFILE_ERROR)?,
            })
        }

        pub(crate) fn read(&self) -> Result<Option<ClaudeCredential>, String> {
            read_credential(
                &self.target,
                MAX_CLAUDE_BLOB_BYTES,
                CLAUDE_READ_ERROR,
                ClaudeCredential::decode,
            )
        }

        pub(crate) fn write(&self, connection: ClaudeCredential) -> Result<(), String> {
            let mut blob = connection.encode();
            write_credential(&self.target, &mut blob.0, CLAUDE_WRITE_ERROR)
        }

        pub(crate) fn delete(&self) -> Result<(), String> {
            delete_credential(&self.target, CLAUDE_DELETE_ERROR)
        }

        #[cfg(test)]
        pub(super) fn write_fixture_blob(&self, bytes: Vec<u8>) {
            let mut blob = WipeBuffer(bytes);
            assert!(blob.0.len() <= CRED_MAX_CREDENTIAL_BLOB_SIZE as usize);
            // Test-only raw fixture writer: production exposes only validated
            // ClaudeCredential replacement, never an arbitrary serialized blob.
            write_credential(&self.target, &mut blob.0, CLAUDE_WRITE_ERROR).unwrap();
        }
    }

    struct CredentialBuffer(NonNull<CREDENTIALW>);

    impl Drop for CredentialBuffer {
        fn drop(&mut self) {
            // SAFETY: this guard uniquely owns a CredReadW allocation until CredFree.
            unsafe {
                let credential = self.0.as_ref();
                if !credential.CredentialBlob.is_null() {
                    // Wipe even rejected (>2048-byte) blobs. Bound unexpected OS
                    // metadata by the documented Credential Manager blob maximum.
                    let size = credential
                        .CredentialBlobSize
                        .min(CRED_MAX_CREDENTIAL_BLOB_SIZE) as usize;
                    wipe(std::slice::from_raw_parts_mut(
                        credential.CredentialBlob,
                        size,
                    ));
                }
                CredFree(self.0.as_ptr().cast());
            }
        }
    }
}

#[cfg(not(windows))]
impl Vault {
    pub(crate) fn new(_directory: &Path) -> Result<Self, String> {
        Err(UNSUPPORTED.into())
    }

    pub(crate) fn read(&self) -> Result<Option<Secret>, String> {
        Err(UNSUPPORTED.into())
    }

    pub(crate) fn write(&self, _secret: Secret) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }

    pub(crate) fn delete(&self) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
}

#[cfg(not(windows))]
impl ClaudeVault {
    pub(crate) fn new(_directory: &Path) -> Result<Self, String> {
        Err(CLAUDE_UNSUPPORTED.into())
    }

    pub(crate) fn read(&self) -> Result<Option<ClaudeCredential>, String> {
        Err(CLAUDE_UNSUPPORTED.into())
    }

    pub(crate) fn write(&self, _connection: ClaudeCredential) -> Result<(), String> {
        Err(CLAUDE_UNSUPPORTED.into())
    }

    pub(crate) fn delete(&self) -> Result<(), String> {
        Err(CLAUDE_UNSUPPORTED.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validation_is_bounded_and_errors_and_debug_are_redacted() {
        for invalid in [
            String::new(),
            " ".into(),
            "test key".into(),
            "test\nkey".into(),
            "test\tkey".into(),
            "test\0key".into(),
            "test\u{7f}key".into(),
            "tést-key".into(),
            "x".repeat(MAX_KEY_BYTES + 1),
        ] {
            assert_eq!(Secret::new(invalid).unwrap_err(), INVALID_KEY);
        }
        let secret = Secret::new("fake-test-key".into()).unwrap();
        assert_eq!(format!("{secret:?}"), "Secret([REDACTED])");
        assert_eq!(secret.as_bytes(), b"fake-test-key");
        assert!(Secret::new("x".repeat(MAX_KEY_BYTES)).is_ok());
    }

    #[test]
    fn wiping_overwrites_the_owned_buffer() {
        let mut bytes = b"fake-test-key".to_vec();
        wipe(&mut bytes);
        assert!(bytes.iter().all(|byte| *byte == 0));
    }

    #[test]
    fn claude_connection_validation_and_identity_are_bounded_and_redacted() {
        for key in [
            String::new(),
            "fake key".into(),
            "x".repeat(MAX_KEY_BYTES + 1),
        ] {
            assert_eq!(
                ClaudeCredential::new(key, None).unwrap_err(),
                INVALID_CLAUDE_KEY
            );
        }
        for workspace in [
            "wrkspc_".into(),
            "WRKSPC_fake".into(),
            "wrkspc_fake value".into(),
            "wrkspc_fake\n".into(),
            "wrkspc_faké".into(),
            "wrkspc_fake-value".into(),
            format!("wrkspc_{}", "x".repeat(122)),
        ] {
            assert_eq!(
                ClaudeCredential::new("fake-key".into(), Some(workspace)).unwrap_err(),
                INVALID_CLAUDE_WORKSPACE
            );
        }
        let absent = ClaudeCredential::new("fake-key".into(), None).unwrap();
        let empty = ClaudeCredential::new("fake-key".into(), Some(String::new())).unwrap();
        let selected =
            ClaudeCredential::new("fake-key".into(), Some("wrkspc_First_1".into())).unwrap();
        let rekeyed =
            ClaudeCredential::new("fake-other-key".into(), Some("wrkspc_First_1".into())).unwrap();
        assert!(absent.same_identity(&empty));
        assert!(!absent.same_identity(&selected));
        assert!(!selected.same_identity(&rekeyed));
        assert_eq!(selected.key().as_bytes(), b"fake-key");
        assert_eq!(selected.workspace(), Some("wrkspc_First_1"));
        assert_eq!(format!("{selected:?}"), "ClaudeCredential([REDACTED])");
    }

    #[test]
    fn claude_envelope_roundtrips_and_rejects_corrupt_or_unknown_formats() {
        let maximum = ClaudeCredential::new(
            "x".repeat(MAX_KEY_BYTES),
            Some(format!("wrkspc_{}", "w".repeat(121))),
        )
        .unwrap();
        let encoded = maximum.encode();
        assert_eq!(encoded.0.len(), MAX_CLAUDE_BLOB_BYTES);
        assert!(
            ClaudeCredential::decode(&encoded.0)
                .unwrap()
                .same_identity(&maximum)
        );
        let absent = ClaudeCredential::new("fake-key".into(), None).unwrap();
        assert!(
            ClaudeCredential::decode(&absent.encode().0)
                .unwrap()
                .same_identity(&absent)
        );

        let valid = absent.encode();
        let mut unknown_version = valid.0.clone();
        unknown_version[3] = b'2';
        let mut extra_bytes = valid.0.clone();
        extra_bytes.push(0);
        let mut no_key = valid.0.clone();
        no_key[4] = 0;
        no_key[5] = 0;
        let mut bad_key = valid.0.clone();
        bad_key[7] = b' ';
        let mut bad_workspace = valid.0.clone();
        bad_workspace[6] = 1;
        bad_workspace.push(b'x');
        for bytes in [
            vec![],
            vec![0; 6],
            b"fake-legacy-plaintext-key".to_vec(),
            unknown_version,
            extra_bytes,
            no_key,
            bad_key,
            bad_workspace,
            vec![0; MAX_CLAUDE_BLOB_BYTES + 1],
        ] {
            let bytes = WipeBuffer(bytes);
            assert_eq!(
                ClaudeCredential::decode(&bytes.0).unwrap_err(),
                CLAUDE_READ_ERROR
            );
        }
    }

    #[cfg(not(windows))]
    #[test]
    fn unsupported_platform_has_no_storage_fallback() {
        assert!(matches!(Vault::new(Path::new("missing")), Err(e) if e == UNSUPPORTED));
        let vault = Vault {};
        assert!(matches!(vault.read(), Err(e) if e == UNSUPPORTED));
        assert_eq!(
            vault.write(Secret::new("fake-test-key".into()).unwrap()),
            Err(UNSUPPORTED.into())
        );
        assert_eq!(vault.delete(), Err(UNSUPPORTED.into()));
        assert!(
            matches!(ClaudeVault::new(Path::new("missing")), Err(e) if e == CLAUDE_UNSUPPORTED)
        );
        let claude = ClaudeVault {};
        assert!(matches!(claude.read(), Err(e) if e == CLAUDE_UNSUPPORTED));
        assert_eq!(
            claude.write(ClaudeCredential::new("fake-key".into(), None).unwrap()),
            Err(CLAUDE_UNSUPPORTED.into())
        );
        assert_eq!(claude.delete(), Err(CLAUDE_UNSUPPORTED.into()));
    }

    #[cfg(windows)]
    mod windows_tests {
        use super::*;

        // Every credential target includes a freshly allocated tempfile directory.
        // Drop removes only that target, including during assertion unwinding.
        struct Fixture {
            vault: Vault,
            directory: tempfile::TempDir,
        }

        impl Fixture {
            fn new() -> Self {
                let directory = tempfile::Builder::new()
                    .prefix("pavane-vault-test-")
                    .tempdir()
                    .unwrap();
                let vault = Vault::new(directory.path()).unwrap();
                let fixture = Self { vault, directory };
                assert!(fixture.vault.read().unwrap().is_none());
                fixture
            }
        }

        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = self.vault.delete();
            }
        }

        fn assert_key(vault: &Vault, expected: &[u8]) {
            assert_eq!(vault.read().unwrap().unwrap().as_bytes(), expected);
        }

        #[test]
        fn canonical_profile_reopens_and_other_profiles_are_isolated() {
            let first = Fixture::new();
            let second = Fixture::new();
            first
                .vault
                .write(Secret::new("fake-first-key".into()).unwrap())
                .unwrap();
            let reopened = Vault::new(&first.directory.path().join(".")).unwrap();
            assert_key(&reopened, b"fake-first-key");
            assert!(second.vault.read().unwrap().is_none());
            second
                .vault
                .write(Secret::new("fake-second-key".into()).unwrap())
                .unwrap();
            assert_key(&first.vault, b"fake-first-key");
            assert_key(&second.vault, b"fake-second-key");
            second.vault.delete().unwrap();
            assert_key(&first.vault, b"fake-first-key");
        }

        #[test]
        fn overlapping_read_buffers_and_their_drops_preserve_the_saved_credential() {
            let fixture = Fixture::new();
            let reopened = Vault::new(fixture.directory.path()).unwrap();
            let expected = b"fake-overlapping-read-key";
            fixture
                .vault
                .write(Secret::new(String::from_utf8(expected.to_vec()).unwrap()).unwrap())
                .unwrap();
            let held = fixture.vault.read().unwrap().unwrap();
            for _ in 0..32 {
                let other = reopened.read().unwrap().unwrap();
                assert!(other.as_bytes() == expected);
                drop(other);
                assert!(held.as_bytes() == expected);
                assert_key(&fixture.vault, expected);
            }
            drop(held);
            assert_key(&reopened, expected);
        }

        #[test]
        fn rejected_input_preserves_value_and_replacement_and_delete_work() {
            let fixture = Fixture::new();
            fixture
                .vault
                .write(Secret::new("fake-original-key".into()).unwrap())
                .unwrap();
            for invalid in ["fake key".into(), "x".repeat(MAX_KEY_BYTES + 1)] {
                assert!(
                    Secret::new(invalid)
                        .and_then(|key| fixture.vault.write(key))
                        .is_err()
                );
                assert_key(&fixture.vault, b"fake-original-key");
            }
            fixture
                .vault
                .write(Secret::new("fake-replacement-key".into()).unwrap())
                .unwrap();
            assert_key(&fixture.vault, b"fake-replacement-key");
            fixture.vault.delete().unwrap();
            fixture.vault.delete().unwrap();
            assert!(fixture.vault.read().unwrap().is_none());
        }

        #[test]
        fn fixture_cleans_its_disposable_target_during_panic() {
            let fixture = Fixture::new();
            let observer = Vault::new(fixture.directory.path()).unwrap();
            let result = std::panic::catch_unwind(move || {
                let fixture = fixture;
                fixture
                    .vault
                    .write(Secret::new("fake-panic-test-key".into()).unwrap())
                    .unwrap();
                panic!("exercise disposable credential cleanup");
            });
            assert!(result.is_err());
            assert!(observer.read().unwrap().is_none());
        }

        #[test]
        fn missing_directories_and_files_are_not_profile_targets() {
            let fixture = Fixture::new();
            assert!(Vault::new(&fixture.directory.path().join("missing")).is_err());
            let file = tempfile::NamedTempFile::new_in(fixture.directory.path()).unwrap();
            assert!(Vault::new(file.path()).is_err());
        }

        struct ConnectionFixture {
            claude: ClaudeVault,
            gemini: Vault,
            directory: tempfile::TempDir,
        }

        impl ConnectionFixture {
            fn new() -> Self {
                let directory = tempfile::Builder::new()
                    .prefix("pavane-claude-vault-test-")
                    .tempdir()
                    .unwrap();
                let claude = ClaudeVault::new(directory.path()).unwrap();
                let gemini = Vault::new(directory.path()).unwrap();
                let fixture = Self {
                    claude,
                    gemini,
                    directory,
                };
                assert!(fixture.claude.read().unwrap().is_none());
                assert!(fixture.gemini.read().unwrap().is_none());
                fixture
            }
        }

        impl Drop for ConnectionFixture {
            fn drop(&mut self) {
                let _ = self.claude.delete();
                let _ = self.gemini.delete();
            }
        }

        fn connection(key: &str, workspace: Option<&str>) -> ClaudeCredential {
            ClaudeCredential::new(key.into(), workspace.map(str::to_owned)).unwrap()
        }

        #[test]
        fn distinct_providers_preserve_the_existing_gemini_namespace_and_value() {
            use std::os::windows::ffi::OsStrExt;

            let fixture = ConnectionFixture::new();
            let canonical = fixture.directory.path().canonicalize().unwrap();
            let mut original_target: Vec<u16> = "Pavane/Gemini/v1/"
                .encode_utf16()
                .chain(canonical.as_os_str().encode_wide())
                .collect();
            original_target.push(0);
            assert!(fixture.gemini.target == original_target);
            assert!(fixture.gemini.target != fixture.claude.target);
            fixture
                .gemini
                .write(Secret::new("fake-gemini-key".into()).unwrap())
                .unwrap();
            fixture
                .claude
                .write(connection("fake-claude-key", Some("wrkspc_first")))
                .unwrap();
            assert_key(&fixture.gemini, b"fake-gemini-key");
            fixture.claude.delete().unwrap();
            assert_key(&fixture.gemini, b"fake-gemini-key");
            fixture
                .claude
                .write(connection("fake-claude-key", None))
                .unwrap();
            fixture.gemini.delete().unwrap();
            assert!(
                fixture
                    .claude
                    .read()
                    .unwrap()
                    .unwrap()
                    .same_identity(&connection("fake-claude-key", None))
            );
        }

        #[test]
        fn claude_reopens_and_replaces_workspace_and_key_as_one_identity() {
            let first = ConnectionFixture::new();
            let second = ConnectionFixture::new();
            let reopened = ClaudeVault::new(&first.directory.path().join(".")).unwrap();
            first
                .claude
                .write(connection("fake-first-key", Some("wrkspc_first")))
                .unwrap();
            assert!(
                reopened
                    .read()
                    .unwrap()
                    .unwrap()
                    .same_identity(&connection("fake-first-key", Some("wrkspc_first")))
            );
            assert!(second.claude.read().unwrap().is_none());
            first
                .claude
                .write(connection("fake-first-key", Some("wrkspc_second")))
                .unwrap();
            let replaced = reopened.read().unwrap().unwrap();
            assert!(replaced.same_identity(&connection("fake-first-key", Some("wrkspc_second"))));
            assert!(!replaced.same_identity(&connection("fake-first-key", Some("wrkspc_first"))));
            first
                .claude
                .write(connection("fake-replacement-key", None))
                .unwrap();
            second
                .claude
                .write(connection("fake-second-profile", Some("wrkspc_second")))
                .unwrap();
            assert!(
                reopened
                    .read()
                    .unwrap()
                    .unwrap()
                    .same_identity(&connection("fake-replacement-key", None))
            );
            first.claude.delete().unwrap();
            first.claude.delete().unwrap();
            assert!(reopened.read().unwrap().is_none());
            assert!(second.claude.read().unwrap().is_some());
        }

        #[test]
        fn failed_claude_input_preserves_both_saved_fields_and_maximum_fits_os_blob() {
            let fixture = ConnectionFixture::new();
            fixture
                .claude
                .write(connection("fake-original-key", Some("wrkspc_original")))
                .unwrap();
            for (key, workspace) in [
                ("bad key".into(), Some("wrkspc_new".into())),
                ("fake-new-key".into(), Some("invalid-workspace".into())),
                ("x".repeat(MAX_KEY_BYTES + 1), None),
            ] {
                assert!(
                    ClaudeCredential::new(key, workspace)
                        .and_then(|value| fixture.claude.write(value))
                        .is_err()
                );
                assert!(
                    fixture
                        .claude
                        .read()
                        .unwrap()
                        .unwrap()
                        .same_identity(&connection("fake-original-key", Some("wrkspc_original")))
                );
            }
            let maximum = connection(
                &"x".repeat(MAX_KEY_BYTES),
                Some(&format!("wrkspc_{}", "w".repeat(121))),
            );
            fixture.claude.write(maximum).unwrap();
            let saved = fixture.claude.read().unwrap().unwrap();
            assert_eq!(saved.key().as_bytes().len(), MAX_KEY_BYTES);
            assert_eq!(saved.workspace().unwrap().len(), 128);
        }

        #[test]
        fn corrupt_versioned_and_oversize_claude_blobs_fail_closed() {
            let fixture = ConnectionFixture::new();
            for bytes in [
                b"fake-legacy-key".to_vec(),
                b"PVC2\x08\0\0fake-key".to_vec(),
                b"PVC1\x08\0\0bad key ".to_vec(),
                b"PVC1\x08\0\x01fake-keyx".to_vec(),
                vec![b'x'; MAX_CLAUDE_BLOB_BYTES + 1],
            ] {
                fixture.claude.write_fixture_blob(bytes);
                assert_eq!(fixture.claude.read().unwrap_err(), CLAUDE_READ_ERROR);
            }
            fixture
                .claude
                .write(connection("fake-recovered-key", None))
                .unwrap();
            assert!(fixture.claude.read().unwrap().is_some());
        }

        #[test]
        fn claude_fixture_cleanup_survives_panic_and_rejects_invalid_profiles() {
            let fixture = ConnectionFixture::new();
            assert!(ClaudeVault::new(&fixture.directory.path().join("missing")).is_err());
            let file = tempfile::NamedTempFile::new_in(fixture.directory.path()).unwrap();
            assert!(ClaudeVault::new(file.path()).is_err());
            drop(file);
            let observer = ClaudeVault::new(fixture.directory.path()).unwrap();
            let result = std::panic::catch_unwind(move || {
                let fixture = fixture;
                fixture
                    .claude
                    .write(connection("fake-panic-key", Some("wrkspc_panic")))
                    .unwrap();
                panic!("exercise disposable Claude credential cleanup");
            });
            assert!(result.is_err());
            assert!(observer.read().unwrap().is_none());
        }
    }
}
