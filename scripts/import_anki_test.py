import importlib.util
import json
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("import_anki", Path(__file__).with_name("import-anki.py"))
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


class ImportAnkiTest(unittest.TestCase):
    def make_package(self, directory, *, cloze=False, missing_image=False):
        database = directory / "source.sqlite"
        connection = sqlite3.connect(database)
        connection.executescript("""
            create table col (ver integer, models text, decks text);
            create table notes (id integer, mid integer, flds text, tags text);
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
        fields = ["First &amp; question", "First answer", "Second question", '<div>Second answer</div><img src="../image%20one.jpg">', "Extra hint"]
        connection.execute("insert into notes values (1, 1, ?, ' tag1 tag2 ')", ("\x1f".join(fields),))
        connection.executemany("insert into cards values (?, 1, 10, 0, ?)", [(101, 0), (102, 1)])
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
            self.assertEqual(importer.extract_package(package, output), (2, 1))
            catalog = json.loads((output / "cards.json").read_text())
            first, second = catalog["cards"]
            self.assertEqual(first["question"]["text"], "First & question")
            self.assertEqual(first["answer"]["text"], "First answer\nExtra hint")
            self.assertEqual(first["tags"], ["tag1", "tag2"])
            self.assertEqual(first["noteId"], second["noteId"])
            self.assertEqual(second["question"]["text"], "Second question")
            self.assertIn("Second question\n\nSecond answer", second["answer"]["text"])
            image_id = second["answer"]["imageIds"][0]
            self.assertIn(f"[Image: {image_id}]", second["answer"]["text"])
            image = catalog["media"][image_id]
            self.assertEqual((output / "media" / image["file"]).read_bytes(), b"\xff\xd8\xfftest-image")
            self.assertFalse((root / "image one.jpg").exists())
            with self.assertRaisesRegex(ValueError, "already exists"):
                importer.extract_package(package, output)

    def test_missing_media_aborts_instead_of_silently_omitting(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = self.make_package(root, missing_image=True)
            with self.assertRaisesRegex(ValueError, "missing from the package"):
                importer.extract_package(package, root / "output")
            self.assertFalse((root / "output").exists())

    def test_cloze_is_explicitly_unsupported(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = self.make_package(root, cloze=True)
            with self.assertRaisesRegex(ValueError, "cloze"):
                importer.extract_package(package, root / "output")
            self.assertFalse((root / "output").exists())

    def test_modern_package_does_not_import_dummy_legacy_database(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = self.make_package(root)
            with zipfile.ZipFile(package, "a") as archive:
                archive.writestr("collection.anki21b", b"compressed")
            with self.assertRaisesRegex(ValueError, "compatibility"):
                importer.extract_package(package, root / "output")

    def test_nested_conditions_and_literal_field_content(self):
        fields = {"A": "{{not a template}}", "B": "", "C": "yes"}
        self.assertEqual(importer.render_template("{{#A}}{{^B}}{{A}}{{/B}}{{/A}}{{#B}}hidden{{/B}}", fields), "{{not a template}}")
        with self.assertRaisesRegex(ValueError, "Unsupported template filter"):
            importer.render_template("{{cloze:A}}", fields)

    def test_html_preserves_lines_symbols_and_suppresses_scripts(self):
        result = importer.parse_html('<div>Na<sup>+</sup> &amp; Ca<sup>2+</sup></div><div>↓ next</div><script>bad()</script>', lambda src: src)
        self.assertEqual(result["text"], "Na+ & Ca2+\n\n↓ next")


if __name__ == "__main__":
    unittest.main()
