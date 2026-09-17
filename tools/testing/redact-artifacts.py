"""Write a shareable copy of Playwright artifacts; never upload the raw trace directory.

Trace/network files and body resources can contain cookies, reconnect tokens and form
values. Discover secrets first, then replace them throughout text and zip members.
Binary screenshots are preserved. Inputs must be disposable test accounts only.
"""
import json
from pathlib import Path
import re
import shutil
import sys
import zipfile

source, destination = map(Path, sys.argv[1:])
if destination.exists():
    raise SystemExit("Output directory must be new")
secrets = {"contract-test-password", "browser-backend-token"}
sensitive = re.compile(r"password|reconnect.?token|authorization|^cookie$|^set-cookie$", re.I)


def discover(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if sensitive.search(key) and isinstance(item, str) and item:
                secrets.add(item)
            discover(item)
        if sensitive.search(str(value.get("name", ""))) and isinstance(value.get("value"), str):
            secrets.add(value["value"])
        params = value.get("params", {})
        if isinstance(params, dict) and re.search(r"password|비밀번호", str(params.get("selector", "")), re.I):
            if isinstance(params.get("value"), str):
                secrets.add(params["value"])
    elif isinstance(value, list):
        for item in value:
            discover(item)
    elif isinstance(value, str) and value[:1] in ("{", "["):
        try:
            discover(json.loads(value))
        except (ValueError, RecursionError):
            pass


def texts(data):
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return None


def scan(data):
    text = texts(data)
    if text is None:
        return
    for line in text.splitlines():
        try:
            discover(json.loads(line))
        except (ValueError, RecursionError):
            pass
    try:
        discover(json.loads(text))
    except (ValueError, RecursionError):
        pass


files = list(source.rglob("*")) if source.exists() else []
for path in files:
    if path.is_file():
        if path.suffix == ".zip":
            with zipfile.ZipFile(path) as archive:
                for name in archive.namelist():
                    scan(archive.read(name))
        else:
            scan(path.read_bytes())
# A cookie header can combine credentials; redact values even if later shown alone.
for secret in list(secrets):
    for pair in secret.split(";"):
        if "=" in pair:
            value = pair.split("=", 1)[1].strip()
            if len(value) >= 8:
                secrets.add(value)
secrets.discard("")


def redact(data):
    text = texts(data)
    if text is None:
        return data
    for secret in sorted(secrets, key=len, reverse=True):
        text = text.replace(secret, "[REDACTED]")
        text = text.replace(json.dumps(secret, ensure_ascii=False)[1:-1], "[REDACTED]")
    return text.encode("utf-8")


destination.mkdir(parents=True)
for path in files:
    if not path.is_file():
        continue
    target = destination / path.relative_to(source)
    target.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix == ".zip":
        with zipfile.ZipFile(path) as original, zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as output:
            for item in original.infolist():
                output.writestr(item, redact(original.read(item.filename)))
    elif path.suffix.lower() in (".png", ".jpg", ".jpeg", ".webm"):
        shutil.copyfile(path, target)
    else:
        target.write_bytes(redact(path.read_bytes()))
print("Sanitized artifact copy written; raw input retained locally.")
