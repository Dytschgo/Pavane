use std::fmt;
use std::path::Path;
use std::sync::atomic::{Ordering, compiler_fence};

const MAX_KEY_BYTES: usize = 2048;
const INVALID_KEY: &str =
    "Enter a Gemini API key containing 1–2048 ASCII characters without spaces.";
#[cfg(not(windows))]
const UNSUPPORTED: &str = "Gemini API key storage is supported only on Windows.";

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

/// Best effort for owned buffers only; HTTP, IPC, and OS transient copies may remain.
fn wipe(bytes: &mut [u8]) {
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

#[cfg(windows)]
mod windows {
    use super::*;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::{NonNull, null_mut};
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

    impl Vault {
        pub(crate) fn new(directory: &Path) -> Result<Self, String> {
            let directory = directory.canonicalize().map_err(|_| PROFILE_ERROR)?;
            if !directory.is_dir() {
                return Err(PROFILE_ERROR.into());
            }
            let mut target: Vec<u16> = "Pavane/Gemini/v1/"
                .encode_utf16()
                .chain(directory.as_os_str().encode_wide())
                .collect();
            if target.len() > CRED_MAX_GENERIC_TARGET_NAME_LENGTH as usize || target.contains(&0) {
                return Err(PROFILE_ERROR.into());
            }
            target.push(0);
            Ok(Self { target })
        }

        pub(crate) fn read(&self) -> Result<Option<Secret>, String> {
            let mut raw = null_mut();
            // SAFETY: target is NUL terminated; raw is a valid output pointer.
            let success =
                unsafe { CredReadW(self.target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut raw) };
            // Capture before any other Windows call can change the thread error.
            let error = if success == 0 {
                // SAFETY: GetLastError has no preconditions.
                unsafe { GetLastError() }
            } else {
                0
            };
            // Own even an unexpected non-null failure result so it is always freed.
            let buffer = NonNull::new(raw).map(CredentialBuffer);
            if success == 0 {
                return if error == ERROR_NOT_FOUND {
                    Ok(None)
                } else {
                    Err(READ_ERROR.into())
                };
            }
            let buffer = buffer.ok_or(READ_ERROR)?;
            // SAFETY: a successful CredReadW returns a CREDENTIALW allocation.
            let credential = unsafe { buffer.0.as_ref() };
            let size = credential.CredentialBlobSize as usize;
            if credential.Type != CRED_TYPE_GENERIC
                || size == 0
                || size > MAX_KEY_BYTES
                || credential.CredentialBlob.is_null()
            {
                return Err(READ_ERROR.into());
            }
            // SAFETY: CredReadW owns this blob; size was bounded and pointer checked.
            let bytes = unsafe { std::slice::from_raw_parts(credential.CredentialBlob, size) };
            let secret = Secret::from_bytes(bytes.to_vec()).map_err(|_| READ_ERROR)?;
            Ok(Some(secret))
        }

        pub(crate) fn write(&self, mut secret: Secret) -> Result<(), String> {
            let credential = CREDENTIALW {
                Type: CRED_TYPE_GENERIC,
                TargetName: self.target.as_ptr().cast_mut(),
                CredentialBlobSize: secret.bytes.len() as u32,
                CredentialBlob: secret.bytes.as_mut_ptr(),
                Persist: CRED_PERSIST_LOCAL_MACHINE,
                ..CREDENTIALW::default()
            };
            // SAFETY: all pointers remain valid through this synchronous call.
            // Replace in one write; never delete the prior credential before saving.
            if unsafe { CredWriteW(&credential, 0) } == 0 {
                return Err(WRITE_ERROR.into());
            }
            Ok(())
        }

        pub(crate) fn delete(&self) -> Result<(), String> {
            // SAFETY: target is a valid NUL-terminated string.
            if unsafe { CredDeleteW(self.target.as_ptr(), CRED_TYPE_GENERIC, 0) } != 0 {
                return Ok(());
            }
            // SAFETY: GetLastError has no preconditions.
            if unsafe { GetLastError() } == ERROR_NOT_FOUND {
                Ok(())
            } else {
                Err(DELETE_ERROR.into())
            }
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
    }
}
