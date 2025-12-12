#!/usr/bin/env python3
import os
import re
import json
import sqlite3
import urllib.request
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from zoneinfo import ZoneInfo

ARCHIVE_BASE = "https://archive.theroseburgreceiver.com/fire/"
DB_PATH      = "/opt/transcript_data/fire_cache.sqlite"
OUT_DIR      = "/var/www/transcript-cache"
OUT_TXT      = os.path.join(OUT_DIR, "fire_last24h.txt")
OUT_META     = os.path.join(OUT_DIR, "fire_last24h_meta.json")

WINDOW_HOURS = 24

# Matches: fire_YYYYMMDD_HHMMSS.json OR fire_YYYYMMDD_HHMMSS_123.json
FN_RE = re.compile(r"^fire_(\d{8})_(\d{6})(?:_\d+)?\.json$")

PACIFIC = ZoneInfo("America/Los_Angeles")

class LinkParser(HTMLParser):
  def __init__(self):
    super().__init__()
    self.hrefs = []
  def handle_starttag(self, tag, attrs):
    if tag.lower() == "a":
      for k, v in attrs:
        if k.lower() == "href" and v:
          self.hrefs.append(v)

def utc_from_filename(fn: str):
  m = FN_RE.match(fn)
  if not m:
    return None
  d, t = m.group(1), m.group(2)
  return datetime(
    int(d[0:4]), int(d[4:6]), int(d[6:8]),
    int(t[0:2]), int(t[2:4]), int(t[4:6]),
    tzinfo=timezone.utc
  )

def fetch_text(url: str, timeout=20) -> str:
  req = urllib.request.Request(url, headers={"User-Agent": "RR-Transcript-Aggregator/1.0"})
  with urllib.request.urlopen(req, timeout=timeout) as r:
    return r.read().decode("utf-8", errors="replace")

def fetch_json(url: str, timeout=20) -> dict:
  return json.loads(fetch_text(url, timeout=timeout))

def list_json_files(dir_url: str):
  try:
    html = fetch_text(dir_url, timeout=20)
  except Exception:
    return []
  p = LinkParser()
  p.feed(html)
  files = [h for h in p.hrefs if h.endswith(".json")]
  return sorted(set(files))

def ensure_db():
  os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
  con = sqlite3.connect(DB_PATH)
  con.execute("""
    CREATE TABLE IF NOT EXISTS transcripts (
      id TEXT PRIMARY KEY,
      ts_utc INTEGER NOT NULL,
      text TEXT NOT NULL
    )
  """)
  con.execute("CREATE INDEX IF NOT EXISTS idx_ts ON transcripts(ts_utc)")
  con.commit()
  return con

def normalize_text(raw: str) -> str:
  if re.search(r"Thanks\s*for\s*watching|Thank\s*you\s*for\s*watching", raw, flags=re.I):
    return "-- FIRE TONE OR NO AUDIO --"
  s = raw.replace("\r", " ").replace("\n", " ")
  s = re.sub(r"\s+", " ", s).strip()
  return s if s else "No transcript available"

def main():
  now = datetime.now(timezone.utc)
  cutoff = now - timedelta(hours=WINDOW_HOURS)

  def ymd(dt):
    return dt.year, dt.month, dt.day

  y, m, d = ymd(now)
  y2, m2, d2 = ymd(now - timedelta(days=1))
  dirs = [
    f"{ARCHIVE_BASE}{y}/{m}/{d}/",
    f"{ARCHIVE_BASE}{y2}/{m2}/{d2}/",
  ]

  con = ensure_db()

  candidates = []
  for base in dirs:
    for fn in list_json_files(base):
      ts = utc_from_filename(fn)
      if not ts:
        continue
      if ts >= cutoff:
        candidates.append((ts, base + fn, fn))

  candidates.sort(key=lambda x: x[0], reverse=True)

  cur = con.cursor()
  inserted = 0
  for ts, url, fn in candidates:
    row = cur.execute("SELECT 1 FROM transcripts WHERE id = ?", (fn,)).fetchone()
    if row:
      continue
    try:
      j = fetch_json(url, timeout=20)
      raw = (j.get("transcript") or {}).get("transcript") or "No transcript available"
      text = normalize_text(raw)
      cur.execute(
        "INSERT OR IGNORE INTO transcripts(id, ts_utc, text) VALUES(?,?,?)",
        (fn, int(ts.timestamp()), text)
      )
      inserted += 1
    except Exception:
      continue

  cur.execute("DELETE FROM transcripts WHERE ts_utc < ?", (int(cutoff.timestamp()),))
  con.commit()

  rows = cur.execute(
    "SELECT ts_utc, text FROM transcripts WHERE ts_utc >= ? ORDER BY ts_utc DESC",
    (int(cutoff.timestamp()),)
  ).fetchall()

  os.makedirs(OUT_DIR, exist_ok=True)

  lines = []
  for ts_utc, text in rows:
    dt_utc = datetime.fromtimestamp(ts_utc, tz=timezone.utc)
    dt_pac = dt_utc.astimezone(PACIFIC)
    stamp = dt_pac.strftime("%m/%d/%Y %H:%M:%S")
    lines.append(f"{stamp}: {text}")

  tmp = OUT_TXT + ".tmp"
  with open(tmp, "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")
  os.replace(tmp, OUT_TXT)

  meta = {
    "generated_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
    "window_hours": WINDOW_HOURS,
    "lines": len(lines),
    "inserted_this_run": inserted,
  }
  with open(OUT_META + ".tmp", "w", encoding="utf-8") as f:
    json.dump(meta, f)
  os.replace(OUT_META + ".tmp", OUT_META)

  con.close()

if __name__ == "__main__":
  main()
