"""Capture the home page carousel screenshots from a running workbench server.

    python web/capture_shots.py [--base-url http://127.0.0.1:8770] [--chrome PATH]

Each view is rendered by headless Chrome (or Edge), cropped to 1280x800 below the
workbench chrome and written to web/static/img/shots/<name>.webp. Needs Pillow and the
runs referenced below under artifacts/dsl_debugger/. Re-run after UI changes.
"""
import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

CASE = "runs/dsl-route-causal-timeline-high-unlimited-alf18-20261007-live/GPT-4o_018_alfworld_task_018"
CHAT = "chat/20261013T055822Z-chat-973e08/GPT-4o_018_alfworld_task_018"
WIDTH, HEIGHT = 1280, 800
# name, route, window height, crop top (skips the site header and, for cases, the case header)
SHOTS = [
    ("result", f"case/{CASE}/result", 1300, 310),
    ("trajectory", f"case/{CASE}/trajectory/step/4", 1340, 526),
    ("graph", f"case/{CASE}/graph/entities", 1300, 315),
    ("chat", CHAT, 900, 61),
]
BROWSERS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "google-chrome", "chromium", "chrome", "msedge",
]
OUT = Path(__file__).resolve().parent / "static" / "img" / "shots"


def find_browser(explicit):
    for candidate in [explicit] if explicit else BROWSERS:
        path = shutil.which(candidate) or (candidate if Path(candidate).is_file() else None)
        if path:
            return path
    sys.exit("No Chrome/Edge found; pass --chrome PATH.")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--base-url", default="http://127.0.0.1:8770")
    parser.add_argument("--chrome")
    args = parser.parse_args()
    try:
        from PIL import Image
    except ImportError:
        sys.exit("Pillow is required: pip install pillow")
    browser = find_browser(args.chrome)
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for name, route, height, top in SHOTS:
            png = Path(tmp) / f"{name}.png"
            subprocess.run([browser, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                            f"--window-size={WIDTH},{height}", "--virtual-time-budget=10000",
                            f"--user-data-dir={Path(tmp) / 'profile'}", f"--screenshot={png}",
                            f"{args.base_url}/#/{route}"],
                           check=True, capture_output=True)
            with Image.open(png) as image:
                image.crop((0, top, WIDTH, top + HEIGHT)).save(OUT / f"{name}.webp", quality=84, method=6)
            print(f"{name}: {(OUT / f'{name}.webp').stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
