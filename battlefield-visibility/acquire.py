"""Restore archived responses and fetch fixed files from the reviewed source lock.

Live-changing API wrappers are restored offline, never re-fetched for reproduction.
Large downloads stay outside git; every archive and original checksum is strict.
"""

from __future__ import annotations
import concurrent.futures
import hashlib
import gzip
import json
from pathlib import Path
import shutil
import urllib.request
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent
LOCK = ROOT / "sources.lock.json"


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for b in iter(lambda: f.read(1024 * 1024), b""):
            h.update(b)
    return "sha256:" + h.hexdigest()


def verify_archive(entry):
    """Validate the durable bytes even when an unpacked source is cached."""
    archive = entry.get("archive")
    if archive is None:
        return None
    path = (ROOT / archive["path"]).resolve()
    if not path.is_relative_to(ROOT.resolve()):
        raise ValueError("Archive path escapes project")
    if archive["compression"] != "gzip" or not entry.get("sha256"):
        raise ValueError("Archive requires gzip and a pinned restored checksum")
    if digest(path) != archive["sha256"] or path.stat().st_size != archive["size_bytes"]:
        raise ValueError(f"Changed archive: {path}")
    return path


def fetch(entry):
    archive = verify_archive(entry)
    path = ROOT / entry["path"]
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and entry.get("sha256"):
        if digest(path) != entry["sha256"]:
            raise ValueError(f"Changed source: {path}")
        return entry
    partial = path.with_suffix(path.suffix + ".partial")
    try:
        if archive is not None:
            print("Restoring archive", entry["path"], flush=True)
            with gzip.open(archive, "rb") as source, partial.open("wb") as target:
                shutil.copyfileobj(source, target)
        else:
            request = urllib.request.Request(
                entry["url"], headers={"User-Agent": "OpenMapStack-Helsinki-demo/1.0"}
            )
            print("Fetching", entry["path"], flush=True)
            with urllib.request.urlopen(request, timeout=180) as r, partial.open("wb") as f:
                shutil.copyfileobj(r, f)
        if entry.get("sha256") and digest(partial) != entry["sha256"]:
            raise ValueError(f"Checksum mismatch: {path}")
        partial.replace(path)
    finally:
        partial.unlink(missing_ok=True)
    if path.suffix == ".laz" and path.open("rb").read(4) != b"LASF":
        raise ValueError(f"Not LAS: {path}")
    return {
        **entry,
        "sha256": digest(path),
        "size_bytes": path.stat().st_size,
        "retrieved_at": entry.get(
            "retrieved_at", datetime.now(timezone.utc).isoformat()
        ),
    }


def main():
    # Reproduction always consumes the reviewed lock. A new acquisition/version
    # needs explicit discovery, archival and review; it is never an implicit fallback.
    lock = json.loads(LOCK.read_text())
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(fetch, lock["files"]))


if __name__ == "__main__":
    main()
