"""Offline fresh-clone restoration and strict corruption rejection."""

import copy
import gzip
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import acquire


class ArchivedSources(unittest.TestCase):
    def setUp(self):
        self.project = acquire.ROOT
        local_temp = self.project / ".cache" / "tmp"
        local_temp.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=local_temp)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.entries = [
            e
            for e in json.loads((self.project / "sources.lock.json").read_text())[
                "files"
            ]
            if e.get("archive")
        ]
        self.assertEqual(
            {e["id"] for e in self.entries}, {"osm", "tile_index", "lod2_tileset"}
        )
        for e in self.entries:
            dest = self.root / e["archive"]["path"]
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(self.project / e["archive"]["path"], dest)
        self.root_patch = patch.object(acquire, "ROOT", self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        network = patch.object(
            acquire.urllib.request,
            "urlopen",
            side_effect=AssertionError(
                "Archived snapshots must not query live wrappers"
            ),
        )
        self.urlopen = network.start()
        self.addCleanup(network.stop)

    def test_fresh_clone_restores_original_bytes_without_network(self):
        for e in self.entries:
            self.assertFalse((self.root / e["path"]).exists())
            acquire.fetch(e)
            self.assertEqual(acquire.digest(self.root / e["path"]), e["sha256"])
            self.assertEqual((self.root / e["path"]).stat().st_size, e["size_bytes"])
            acquire.fetch(e)  # Also strictly verify cached bytes and the archive.
        self.urlopen.assert_not_called()

    def test_corrupt_archive_rejected_even_with_valid_cached_source(self):
        e = self.entries[0]
        acquire.fetch(e)
        (self.root / e["archive"]["path"]).write_bytes(b"corrupt archive")
        with self.assertRaisesRegex(ValueError, "Changed archive"):
            acquire.fetch(e)

    def test_corrupt_restored_content_rejected_despite_valid_archive_hash(self):
        e = copy.deepcopy(self.entries[0])
        archive = self.root / e["archive"]["path"]
        archive.write_bytes(gzip.compress(b"different response", mtime=0))
        e["archive"]["sha256"] = acquire.digest(archive)
        e["archive"]["size_bytes"] = archive.stat().st_size
        with self.assertRaisesRegex(ValueError, "Checksum mismatch"):
            acquire.fetch(e)
        self.assertFalse((self.root / e["path"]).exists())
        self.assertFalse((self.root / (e["path"] + ".partial")).exists())

    def test_corrupt_cached_source_is_not_silently_repaired(self):
        e = self.entries[0]
        acquire.fetch(e)
        (self.root / e["path"]).write_bytes(b"corrupt cached response")
        with self.assertRaisesRegex(ValueError, "Changed source"):
            acquire.fetch(e)


if __name__ == "__main__":
    unittest.main()
