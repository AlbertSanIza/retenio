"""Extract legacy .apkg cards and images using only the Python standard library.

Usage: python3 scripts/import-anki.py ~/Downloads/questions.apkg
Supports regular card templates, conditional fields, FrontSide, text and hint
filters. Unsupported formats/filters fail explicitly instead of losing content.
Package reference: https://github.com/ankitects/anki/tree/main/rslib/src/import_export/package
"""

import argparse
import hashlib
import json
import re
import sqlite3
import tempfile
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote


class CardHTML(HTMLParser):
    """Convert card HTML to readable text, keeping image positions and line breaks."""

    BLOCKS = {"div", "p", "br", "hr", "li", "ul", "ol", "tr", "h1", "h2", "h3", "center"}

    def __init__(self, image_reference):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.images = []
        self.hidden = 0
        self.image_reference = image_reference

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.hidden += 1
        if self.hidden:
            return
        if tag in self.BLOCKS:
            self.parts.append("\n")
        elif tag in {"td", "th"}:
            self.parts.append(" | ")
        elif tag == "img":
            source = dict(attrs).get("src")
            if not source:
                raise ValueError("Image is missing its src attribute")
            image_id = self.image_reference(unquote(source))
            if image_id not in self.images:
                self.images.append(image_id)
            self.parts.append(f"\n[Image: {image_id}]\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self.hidden = max(0, self.hidden - 1)
        elif not self.hidden and tag in self.BLOCKS:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)

    def result(self):
        text = re.sub(r"[^\S\n]+", " ", "".join(self.parts))
        text = "\n".join(line.strip() for line in text.splitlines())
        return {"text": re.sub(r"\n{3,}", "\n\n", text).strip(), "imageIds": self.images}


def parse_html(value, image_reference):
    parser = CardHTML(image_reference)
    parser.feed(value)
    parser.close()
    return parser.result()


def render_template(template, fields):
    # Parse only the template, never re-interpret field content as template code.
    parts = re.split(r"({{[^{}]+}})", template)
    conditions = []
    output = []
    for part in parts:
        if not part.startswith("{{"):
            if all(enabled for _, enabled in conditions):
                output.append(part)
            continue
        token = part[2:-2].strip()
        if token.startswith(("#", "^")):
            name = token[1:]
            if name not in fields:
                raise ValueError(f"Unknown conditional field: {name}")
            populated = bool(fields[name].strip())
            conditions.append((name, populated if token[0] == "#" else not populated))
        elif token.startswith("/"):
            if not conditions or conditions.pop()[0] != token[1:]:
                raise ValueError(f"Unmatched template section: {token}")
        else:
            filters = token.split(":")
            name = filters.pop()
            if name not in fields:
                raise ValueError(f"Unknown template field: {name}")
            value = fields[name]
            for filter_name in reversed(filters):
                if filter_name == "hint":
                    # Expose hint content to the agent without Anki's click-to-reveal UI.
                    continue
                if filter_name == "text":
                    value = re.sub(r"<[^>]+>", "", value)
                else:
                    raise ValueError(f"Unsupported template filter: {filter_name}")
            if all(enabled for _, enabled in conditions):
                output.append(value)
    if conditions:
        raise ValueError("Unclosed template section")
    return "".join(output)


def image_format(data):
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg", "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", "image/png"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "gif", "image/gif"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "webp", "image/webp"
    raise ValueError("Unsupported image format; expected JPEG, PNG, GIF or WebP")


def extract_package(source, output):
    if output.exists():
        raise ValueError(f"Output already exists: {output}. Choose a new --output directory.")
    output.parent.mkdir(parents=True, exist_ok=True)
    # Stage everything first: a bad package must not leave a partial catalog.
    with zipfile.ZipFile(source) as archive, tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        staging = Path(temporary)
        media_dir = staging / "media"
        media_dir.mkdir()
        entries = set(archive.namelist())
        if "collection.anki21b" in entries:
            raise ValueError("Compressed Anki packages are not supported yet. Re-export with compatibility enabled.")
        collection = "collection.anki21" if "collection.anki21" in entries else "collection.anki2"
        db_path = staging / "collection.sqlite"
        db_path.write_bytes(archive.read(collection))
        media_map = json.loads(archive.read("media"))
        if any(not re.fullmatch(r"[0-9]+", key) for key in media_map):
            raise ValueError("Invalid media archive entry")
        by_filename = {filename: key for key, filename in media_map.items()}
        if len(by_filename) != len(media_map):
            raise ValueError("Duplicate media filenames")
        media = {}
        resolved = {}

        def image_reference(filename):
            if filename in resolved:
                return resolved[filename]
            if filename not in by_filename:
                raise ValueError(f"Image is missing from the package: {filename}")
            data = archive.read(by_filename[filename])
            extension, mime_type = image_format(data)
            image_id = hashlib.sha256(data).hexdigest()
            stored_name = f"{image_id}.{extension}"
            # Original names never become output paths (including ../ or absolute names).
            (media_dir / stored_name).write_bytes(data)
            media[image_id] = {"file": stored_name, "filename": filename, "mimeType": mime_type, "bytes": len(data)}
            resolved[filename] = image_id
            return image_id

        db = sqlite3.connect(f"{db_path.as_uri()}?mode=ro", uri=True)
        try:
            version, models_json, decks_json = db.execute("select ver, models, decks from col").fetchone()
            if version != 11:
                raise ValueError(f"Unsupported Anki database schema: {version}")
            models, decks = json.loads(models_json), json.loads(decks_json)
            cards = []
            rows = db.execute("""
                select c.id, c.nid, c.did, c.odid, c.ord, n.mid, n.flds, n.tags
                from cards c join notes n on n.id = c.nid order by c.id
            """)
            for card_id, note_id, deck_id, original_deck_id, ordinal, model_id, values, tags in rows:
                model = models[str(model_id)]
                if model["type"] != 0:
                    raise ValueError(f"Unsupported note type: {model['name']} (cloze cards need Anki's renderer)")
                templates = {template["ord"]: template for template in model["tmpls"]}
                template = templates[ordinal]
                field_values = values.split("\x1f")
                if len(field_values) != len(model["flds"]):
                    raise ValueError(f"Field count mismatch for note {note_id}")
                fields = {field["name"]: field_values[field["ord"]] for field in model["flds"]}
                deck = decks[str(original_deck_id or deck_id)]["name"].strip()
                fields.update({"Tags": tags, "Type": model["name"], "Deck": deck,
                               "Subdeck": deck.split("::")[-1], "Card": template["name"]})
                front = render_template(template["qfmt"], fields)
                back = render_template(template["afmt"], {**fields, "FrontSide": front})
                question, answer = parse_html(front, image_reference), parse_html(back, image_reference)
                if not question["text"] or not answer["text"]:
                    raise ValueError(f"Empty question or answer for card {card_id}")
                cards.append({"id": str(card_id), "noteId": str(note_id), "deck": deck,
                              "tags": tags.split(), "question": question, "answer": answer})
            if not cards:
                raise ValueError("Package contains no cards")
        finally:
            db.close()
        db_path.unlink()
        catalog = {"schemaVersion": 1, "source": source.name, "cards": cards, "media": media}
        (staging / "cards.json").write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        staging.rename(output)
        return len(cards), len(media)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "anki")
    args = parser.parse_args()
    try:
        card_count, image_count = extract_package(args.package.resolve(), args.output.resolve())
    except (ValueError, KeyError, sqlite3.Error, zipfile.BadZipFile) as error:
        parser.exit(1, f"Import failed: {error}\n")
    print(f"Extracted {card_count} cards and {image_count} unique images to {args.output}")
