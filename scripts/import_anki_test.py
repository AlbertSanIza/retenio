import hashlib
import importlib.util
import json
import shutil
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("import_anki", Path(__file__).with_name("import-anki.py"))
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


class ImportAnkiTest(unittest.TestCase):
    def snapshot(self, directory):
        return {str(p.relative_to(directory)): hashlib.sha256(p.read_bytes()).hexdigest() for p in directory.rglob("*") if p.is_file()}

    def make_package(self, directory, *, cloze=False, missing_image=False, answer="First answer", extra_card=False, only_first=False, guid="note-guid"):
        database = directory / "source.sqlite"
        database.unlink(missing_ok=True)
        connection = sqlite3.connect(database)
        connection.executescript("""
            create table col (ver integer, models text, decks text);
            create table notes (id integer, mid integer, flds text, tags text, guid text);
            create table cards (id integer, nid integer, did integer, odid integer, ord integer);
        """)
        model = {
            "name": "Two cards per note", "type": 1 if cloze else 0,
            "flds": [{"name": name, "ord": i} for i, name in enumerate(["Q1", "A1", "Q2", "A2", "Hint"])],
            # Deliberately unordered: card ordinal, not array index, determines its template.
            "tmpls": [
                {"ord": 1, "name": "Second", "qfmt": "{{#Q2}}{{Q2}}{{/Q2}}", "afmt": "{{FrontSide}}<hr>{{A2}}"},
                {"ord": 0, "name": "First", "qfmt": "{{Q1}}", "afmt": "{{A1}}<br>{{hint:Hint}}"},
            ],
        }
        connection.execute("insert into col values (11, ?, ?)", (json.dumps({"1": model}), json.dumps({"10": {"name": "Topic"}})))
        # A malicious filename must never be used as a filesystem output path.
        fields = ["First &amp; question", answer, "Second question", '<div>Second answer</div><img src="../image%20one.jpg">', "Extra hint"]
        connection.execute("insert into notes values (1, 1, ?, ' tag1 tag2 ', ?)", ("\x1f".join(fields), guid))
        connection.executemany("insert into cards values (?, 1, 10, 0, ?)", [(101, 0)] if only_first else [(101, 0), (102, 1)])
        if extra_card:
            connection.execute("insert into notes values (2, 1, ?, '', 'new-note-guid')", ("\x1f".join(["New question", "New answer", "", "", ""]),))
            connection.execute("insert into cards values (103, 2, 10, 0, 0)")
        connection.commit()
        connection.close()
        package = directory / "sample.apkg"
        with zipfile.ZipFile(package, "w") as archive:
            archive.write(database, "collection.anki2")
            archive.writestr("media", json.dumps({} if missing_image else {"0": "../image one.jpg"}))
            archive.writestr("0", b"\xff\xd8\xfftest-image")
        return package

    def test_card_ordinals_hints_frontside_and_media(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = self.make_package(root)
            output = root / "output"
            self.assertEqual(importer.extract_package(package, output, "sample"), (2, 1))
            collection = output / "sample"
            first = json.loads((collection / "questions/101.json").read_text())
            second = json.loads((collection / "questions/102.json").read_text())
            self.assertEqual(first["id"], "sample:101")
            self.assertEqual(first["collectionId"], "sample")
            self.assertEqual(first["question"]["text"], "First & question")
            self.assertEqual(first["answer"]["text"], "First answer\nExtra hint")
            self.assertEqual(first["tags"], ["tag1", "tag2"])
            self.assertEqual(first["source"]["noteId"], second["source"]["noteId"])
            self.assertEqual(second["question"]["text"], "Second question")
            self.assertIn("Second question\n\nSecond answer", second["answer"]["text"])
            image_id = second["answer"]["imageIds"][0]
            self.assertIn(f"[Image: {image_id}]", second["answer"]["text"])
            image = second["images"][image_id]
            self.assertEqual((collection / image["file"]).read_bytes(), b"\xff\xd8\xfftest-image")
            self.assertFalse((root / "image one.jpg").exists())
            before = self.snapshot(collection)
            mtimes = {str(p.relative_to(collection)): p.stat().st_mtime_ns for p in collection.rglob("*") if p.is_file()}
            importer.extract_package(package, output, "sample")
            self.assertEqual(before, self.snapshot(collection))
            self.assertEqual(mtimes, {str(p.relative_to(collection)): p.stat().st_mtime_ns for p in collection.rglob("*") if p.is_file()})

    def test_missing_media_aborts_instead_of_silently_omitting(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = self.make_package(root, missing_image=True)
            with self.assertRaisesRegex(ValueError, "missing from the package"):
                importer.extract_package(package, root / "output", "sample")
            self.assertFalse((root / "output/sample").exists())

    def test_cloze_is_explicitly_unsupported(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = self.make_package(root, cloze=True)
            with self.assertRaisesRegex(ValueError, "cloze"):
                importer.extract_package(package, root / "output", "sample")
            self.assertFalse((root / "output/sample").exists())

    def test_modern_package_does_not_import_dummy_legacy_database(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = self.make_package(root)
            with zipfile.ZipFile(package, "a") as archive:
                archive.writestr("collection.anki21b", b"compressed")
            with self.assertRaisesRegex(ValueError, "compatibility"):
                importer.extract_package(package, root / "output", "sample")

    def test_nested_conditions_and_literal_field_content(self):
        fields = {"A": "{{not a template}}", "B": "", "C": "yes"}
        self.assertEqual(importer.render_template("{{#A}}{{^B}}{{A}}{{/B}}{{/A}}{{#B}}hidden{{/B}}", fields), "{{not a template}}")
        with self.assertRaisesRegex(ValueError, "Unsupported template filter"):
            importer.render_template("{{cloze:A}}", fields)

    def test_clean_imports_are_identical_even_when_package_is_renamed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = self.make_package(root)
            renamed = root / "renamed.apkg"
            shutil.copyfile(package, renamed)
            importer.extract_package(package, root / "one", "sample")
            importer.extract_package(renamed, root / "two", "sample")
            self.assertEqual(self.snapshot(root / "one"), self.snapshot(root / "two"))

    def test_new_cards_do_not_change_existing_files_and_partial_exports_do_not_delete(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "output"
            importer.extract_package(self.make_package(root), output, "sample")
            before = self.snapshot(output)
            importer.extract_package(self.make_package(root, extra_card=True), output, "sample")
            after = self.snapshot(output)
            self.assertEqual(set(after) - set(before), {"sample/questions/103.json"})
            self.assertTrue(all(after[key] == value for key, value in before.items()))
            importer.extract_package(self.make_package(root, only_first=True), output, "sample")
            self.assertEqual(after, self.snapshot(output))

    def test_content_updates_preserve_identity_and_do_not_touch_other_cards(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "output"
            importer.extract_package(self.make_package(root), output, "sample")
            before = self.snapshot(output)
            old = json.loads((output / "sample/questions/101.json").read_text())
            importer.extract_package(self.make_package(root, answer="Corrected answer"), output, "sample")
            new = json.loads((output / "sample/questions/101.json").read_text())
            self.assertEqual(old["id"], new["id"])
            self.assertEqual(old["source"], new["source"])
            self.assertIn("Corrected answer", new["answer"]["text"])
            changed = {key for key, value in self.snapshot(output).items() if value != before[key]}
            self.assertEqual(changed, {"sample/questions/101.json"})

    def test_later_collision_does_not_publish_earlier_content_updates(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "output"
            importer.extract_package(self.make_package(root), output, "sample")
            second_path = output / "sample/questions/102.json"
            second = json.loads(second_path.read_text())
            second["source"]["noteGuid"] = "different-note"
            second_path.write_text(json.dumps(second))
            before = self.snapshot(output)
            with self.assertRaisesRegex(ValueError, "ID collision"):
                importer.extract_package(self.make_package(root, answer="Changed first answer"), output, "sample")
            self.assertEqual(before, self.snapshot(output))

    def test_collections_namespace_ids_and_collisions_leave_existing_data_intact(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "output"
            package = self.make_package(root)
            importer.extract_package(package, output, "first")
            importer.extract_package(package, output, "second")
            first = json.loads((output / "first/questions/101.json").read_text())
            second = json.loads((output / "second/questions/101.json").read_text())
            self.assertEqual(first["id"], "first:101")
            self.assertEqual(second["id"], "second:101")
            before = self.snapshot(output)
            with self.assertRaisesRegex(ValueError, "ID collision"):
                importer.extract_package(self.make_package(root, guid="different-note"), output, "first")
            self.assertEqual(before, self.snapshot(output))
            with self.assertRaisesRegex(ValueError, "Collection key"):
                importer.extract_package(package, output, "../escape")

    def test_html_preserves_lines_symbols_and_suppresses_scripts(self):
        result = importer.parse_html('<div>Na<sup>+</sup> &amp; Ca<sup>2+</sup></div><div>↓ next</div><script>bad()</script>', lambda src: src)
        self.assertEqual(result["text"], "Na+ & Ca2+\n\n↓ next")


if __name__ == "__main__":
    unittest.main()
