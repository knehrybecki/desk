//! Antigravity sends quota buckets to its status line. Keep only those buckets
//! in desk's state directory, shared by tiles using the same CLI account.
use crate::usage::Window;
use serde_json::{Value, json};
use std::io::{self, Write};
use std::path::Path;

const CACHE: &str = "antigravity.quota";

pub fn settings(path: &Path, home: &Path) -> io::Result<()> {
    let exe = std::env::current_exe()?.display().to_string();
    let exe = if cfg!(windows) {
        format!(r#""{exe}""#)
    } else {
        crate::tmux::shell_quote(&exe)
    };
    let mut line = json!({"type": "command", "enabled": true, "stack_with_default": true});
    let mut command = format!("{exe} --desk-antigravity-statusline");
    // Only honor a command from the user's own CLI settings.
    let settings = std::fs::read(home.join(".gemini/antigravity-cli/settings.json"))
        .ok()
        .and_then(|v| serde_json::from_slice::<Value>(&v).ok());
    if let Some(user) = settings.as_ref().and_then(|v| v.get("statusLine"))
        && user["enabled"] != false
        && let Some(original) = user["command"].as_str().filter(|s| !s.trim().is_empty())
    {
        line = user.clone();
        command = format!("{command} --forward | ({original})");
    }
    line["command"] = Value::String(command);
    let mut file = tempfile::NamedTempFile::new_in(path.parent().unwrap_or(Path::new(".")))?;
    serde_json::to_writer(&mut file, &json!({"statusLine": line}))?;
    file.persist(path)?;
    Ok(())
}

pub fn statusline(forward: bool) {
    let Ok(data) = serde_json::from_reader::<_, Value>(io::stdin().lock()) else {
        return;
    };
    if forward {
        let _ = serde_json::to_writer(io::stdout().lock(), &data);
    }
    let Some(dir) = std::env::var_os("DESK_STATE_DIR") else {
        return;
    };
    let Some(quota) = data.get("quota").and_then(Value::as_object) else {
        return;
    };
    let dir = Path::new(&dir);
    let cache = dir.join(CACHE);
    let bytes = serde_json::to_vec(quota).unwrap_or_default();
    if std::fs::read(&cache).ok().as_ref() == Some(&bytes) {
        return;
    }
    // Separate writers may run simultaneously from different tiles.
    if let Ok(mut tmp) = tempfile::NamedTempFile::new_in(dir)
        && tmp.write_all(&bytes).is_ok()
    {
        let _ = tmp.persist(cache);
    }
}

pub fn windows(dir: &Path, now: u64) -> Option<Vec<Window>> {
    let data = std::fs::read(dir.join(CACHE)).ok()?;
    let quota: serde_json::Map<String, Value> = serde_json::from_slice(&data).ok()?;
    let windows: Vec<_> = quota
        .iter()
        .filter_map(|(id, bucket)| {
            let remaining = bucket.get("remaining_fraction")?.as_f64()?;
            let reset = crate::usage::iso_seconds(bucket.get("reset_time")?.as_str()?)?;
            if bucket["disabled"] == true || !(0.0..=1.0).contains(&remaining) || reset <= now {
                return None;
            }
            let label = match id.as_str() {
                "gemini-weekly" => "7d",
                "gemini-five-hour" | "gemini-5h" => "5h",
                other => other,
            };
            Some(Window {
                label: label.to_string(),
                used_percent: (1.0 - remaining) * 100.0,
                resets_at: reset,
                severity: None,
            })
        })
        .collect();
    (!windows.is_empty()).then_some(windows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_used_fraction_and_ignores_unavailable_or_expired_buckets() {
        let tmp = tempfile::tempdir().unwrap();
        let quota = json!({
            "gemini-weekly": {"remaining_fraction": 0.75, "reset_time": "2026-07-06T07:50:32Z"},
            "expired": {"remaining_fraction": 0, "reset_time": "2020-01-01T00:00:00Z"},
            "credits": {"remaining_amount": 200}, "disabled": {"disabled":true,
                "remaining_fraction": 0, "reset_time": "2026-07-06T07:50:32Z"}
        });
        std::fs::write(tmp.path().join(CACHE), quota.to_string()).unwrap();
        let got = windows(tmp.path(), 1_780_000_000).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].label, "7d");
        assert_eq!(got[0].used_percent, 25.0);
        assert!(windows(tmp.path(), got[0].resets_at).is_none());
    }
}
