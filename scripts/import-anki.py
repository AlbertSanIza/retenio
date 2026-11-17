"""Extract legacy .apkg cards and images using only the Python standard library.

Usage: python3 scripts/import-anki.py ~/Downloads/questions.apkg --collection sketchy-pharm
Writes data/<collection>/collection.json, questions/<anki-card-id>.json, and images/.
Reuse the same collection key for every export of that collection: it namespaces
permanent question IDs. Imports refresh matching cards and retain absent cards.
Votes, scheduling, and other user activity belong in a separate service keyed by ID.
Supports regular card templates, conditional fields, FrontSide, text and hint
filters. Unsupported formats/filters fail explicitly instead of losing content.
For the SketchyPharm note type, export each template's Extra Q / Extra A / Extra
field group, excluding the shared Entire Sketch and More About This Topic fields.
Package reference: https://github.com/ankitects/anki/tree/main/rslib/src/import_export/package
"""

import argparse
import hashlib
import json
import re
import shutil
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


def card_html(model, template, fields):
    if model["name"] == "SketchyPharm":
        # This note type has up to 30 question/answer/image groups. Template names
        # are misleading (e.g. ordinal 0 is named Card 16), so use field references.
        def references(value):
            return {token.strip().split(":")[-1] for token in re.findall(r"{{([^{}]+)}}", value)
                    if not token.strip().startswith(("#", "^", "/"))}

        front_fields = references(template["qfmt"])
        if len(front_fields) != 1:
            raise ValueError("Unsupported SketchyPharm question template")
        question_field = next(iter(front_fields))
        match = re.fullmatch(r"Extra Q(\d*)", question_field)
        if not match:
            raise ValueError("Unsupported SketchyPharm question field")
        suffix = match.group(1)
        answer_field = f"Extra A{suffix}"
        extra_field = f"Extra {suffix}" if suffix else "Extra"
        expected = {question_field, answer_field, extra_field, "Entire Sketch", "More About This Topic"}
        if references(template["afmt"]) != expected or not expected.issubset(fields):
            raise ValueError("Unsupported SketchyPharm answer template or missing fields")
        return fields[question_field], fields[answer_field] + "<br>" + fields[extra_field]

    front = render_template(template["qfmt"], fields)
    return front, render_template(template["afmt"], {**fields, "FrontSide": front})


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


def write_json(path, value):
    data = (json.dumps(value, ensure_ascii=False, indent=4) + "\n").encode("utf-8")
    if path.exists() and path.read_bytes() == data:
        return False
    path.write_bytes(data)
    return True


def extract_package(source, data_root, collection_id, name=None):
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", collection_id):
        raise ValueError("Collection key must contain lowercase letters, digits, and single hyphens")
    output = data_root / collection_id
    if output.exists():
        manifest_path = output / "collection.json"
        if not manifest_path.is_file():
            raise ValueError("Existing collection is missing collection.json; refusing to overwrite")
        existing = json.loads(manifest_path.read_text(encoding="utf-8"))
        if existing.get("id") != collection_id or existing.get("schemaVersion") != 1:
            raise ValueError("Existing collection identity or schema does not match")
    data_root.mkdir(parents=True, exist_ok=True)
    # Build a complete candidate and validate collisions before changing any live file.
    with zipfile.ZipFile(source) as archive, tempfile.TemporaryDirectory(dir=data_root, prefix=f".{collection_id}-import-") as temporary:
        workspace = Path(temporary)
        staging = workspace / "candidate"
        if output.exists():
            shutil.copytree(output, staging)
        else:
            staging.mkdir()
        media_dir = staging / "images"
        questions_dir = staging / "questions"
        media_dir.mkdir(exist_ok=True)
        questions_dir.mkdir(exist_ok=True)
        changed = False
        entries = set(archive.namelist())
        if "collection.anki21b" in entries:
            raise ValueError("Compressed Anki packages are not supported yet. Re-export with compatibility enabled.")
        collection = "collection.anki21" if "collection.anki21" in entries else "collection.anki2"
        db_path = workspace / "collection.sqlite"
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
            nonlocal changed
            if filename in resolved:
                return resolved[filename]
            if filename not in by_filename:
                raise ValueError(f"Image is missing from the package: {filename}")
            data = archive.read(by_filename[filename])
            extension, mime_type = image_format(data)
            image_id = hashlib.sha256(data).hexdigest()
            stored_name = f"{image_id}.{extension}"
            # Original names never become output paths (including ../ or absolute names).
            destination = media_dir / stored_name
            if destination.exists():
                if destination.read_bytes() != data:
                    raise ValueError(f"Existing image has unexpected contents: {stored_name}")
            else:
                destination.write_bytes(data)
                changed = True
            # Pick a deterministic label when the same bytes have multiple names.
            label = min(filename, media.get(image_id, {}).get("filename", filename))
            media[image_id] = {"file": f"images/{stored_name}", "filename": label, "mimeType": mime_type, "bytes": len(data)}
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
                select c.id, c.nid, c.did, c.odid, c.ord, n.mid, n.flds, n.tags, n.guid
                from cards c join notes n on n.id = c.nid order by c.id
            """)
            for card_id, note_id, deck_id, original_deck_id, ordinal, model_id, values, tags, note_guid in rows:
                if card_id <= 0 or note_id <= 0 or not note_guid:
                    raise ValueError("Card and note identities must be present")
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
                front, back = card_html(model, template, fields)
                question, answer = parse_html(front, image_reference), parse_html(back, image_reference)
                if not question["text"] or not answer["text"]:
                    raise ValueError(f"Empty question or answer for card {card_id}")
                cards.append({
                    "schemaVersion": 1,
                    "id": f"{collection_id}:{card_id}",
                    "collectionId": collection_id,
                    "source": {"type": "anki", "cardId": str(card_id), "noteId": str(note_id),
                               "noteGuid": note_guid, "modelId": str(model_id), "templateOrdinal": ordinal},
                    "deck": deck, "tags": sorted(tags.split()), "question": question, "answer": answer
                })
            if not cards:
                raise ValueError("Package contains no cards")
            if len({card["id"] for card in cards}) != len(cards):
                raise ValueError("Package contains duplicate card IDs")
        finally:
            db.close()
        for card in cards:
            question_file = questions_dir / f"{card['source']['cardId']}.json"
            if question_file.exists():
                previous = json.loads(question_file.read_text(encoding="utf-8"))
                identity_fields = ["type", "cardId", "noteId", "noteGuid", "templateOrdinal"]
                if (previous.get("id") != card["id"] or previous.get("collectionId") != collection_id
                        or any(previous.get("source", {}).get(key) != card["source"][key] for key in identity_fields)):
                    raise ValueError(f"ID collision for {card['id']}; refusing to replace a different question")
            image_ids = sorted(set(card["question"]["imageIds"] + card["answer"]["imageIds"]))
            card["images"] = {image_id: media[image_id] for image_id in image_ids}
            changed = write_json(question_file, card) or changed
        manifest = {
            "schemaVersion": 1,
            "id": collection_id,
            "name": name or collection_id.replace("-", " ").title(),
            "source": {"type": "anki-apkg"}
        }
        changed = write_json(staging / "collection.json", manifest) or changed
        if changed:
            backup = workspace / "previous"
            if output.exists():
                output.rename(backup)
            try:
                staging.rename(output)
            except OSError:
                if backup.exists():
                    backup.rename(output)
                raise
        return len(cards), len(media)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    parser.add_argument("--collection", required=True, help="Permanent collection key, e.g. sketchy-pharm; reuse it on every import")
    parser.add_argument("--name", help="Display name (defaults to the collection key in title case)")
    parser.add_argument("--data-dir", type=Path, default=Path(__file__).resolve().parents[1] / "data")
    args = parser.parse_args()
    try:
        card_count, image_count = extract_package(args.package.resolve(), args.data_dir.resolve(), args.collection, args.name)
    except (ValueError, KeyError, sqlite3.Error, zipfile.BadZipFile) as error:
        parser.exit(1, f"Import failed: {error}\n")
    print(f"Imported {card_count} questions and {image_count} referenced images into {args.data_dir / args.collection}")
