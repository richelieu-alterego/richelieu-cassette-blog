import json
import math
import pathlib
import re

ROOT = pathlib.Path(__file__).parent
POSTS_DIR = ROOT / "posts"
CONFIG_FILE = ROOT / "site.config.json"
OUT_FILE = ROOT / "public" / "posts.json"
OUT_CONFIG = ROOT / "public" / "site.config.json"


def parse_post(path: pathlib.Path) -> dict:
    raw = path.read_text(encoding="utf-8")
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", raw, re.DOTALL)
    if not m:
        raise ValueError(f"Missing frontmatter in {path}")
    meta_raw, body = m.group(1), m.group(2).strip()
    meta = {}
    for line in meta_raw.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    tags = [t.strip() for t in meta.get("tags", "").split(",") if t.strip()]
    words = len(re.sub(r"\s+", "", body))
    read_min = max(1, math.ceil(words / 400))
    return {
        "id": meta.get("id", path.stem),
        "title": meta.get("title", path.stem),
        "date": meta.get("date", "2026-01-01"),
        "tags": tags,
        "summary": meta.get("summary", ""),
        "words": words,
        "readMin": read_min,
        "body": body,
    }


def main():
    posts = [parse_post(p) for p in sorted(POSTS_DIR.glob("*.md"))]
    posts.sort(key=lambda x: x["date"], reverse=True)
    OUT_FILE.write_text(json.dumps(posts, ensure_ascii=False, indent=2), encoding="utf-8")
    if CONFIG_FILE.exists():
        OUT_CONFIG.write_text(CONFIG_FILE.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"Built {len(posts)} posts -> {OUT_FILE}")


if __name__ == "__main__":
    main()
