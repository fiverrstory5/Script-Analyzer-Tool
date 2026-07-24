#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script Analyzer Tool — Smart Local Server
==========================================
यह server automatically सभी project folders detect करता है।
कोई भी config या projects.json की जरूरत नहीं।

चलाने के लिए:
    python server.py

फिर browser में खोलें:
    http://localhost:8000
"""

import http.server
import socketserver
import os
import json
import webbrowser
from pathlib import Path
from threading import Timer

PORT     = 8000
BASE_DIR = Path(__file__).parent

# Auto-assigned colors (cycle through if more projects than colors)
_COLORS = [
    '#3498db', '#8e44ad', '#16a085', '#e67e22',
    '#c0392b', '#27ae60', '#2980b9', '#d35400',
    '#1abc9c', '#9b59b6', '#e74c3c', '#f39c12',
]

# Optional: emoji icons cycle
_ICONS = ['📚', '📖', '🎯', '📝', '🎓', '📋', '🗒️', '📒', '📔', '📕', '📗', '📘']


def _scan_projects():
    """
    Scan BASE_DIR for subfolders that contain a data.json file.
    Returns a list of project dicts sorted by folder name.
    Skips hidden folders (starting with .) and __pycache__ etc.
    """
    projects = []
    skip_prefixes = ('.', '__')

    folders = sorted(
        item for item in BASE_DIR.iterdir()
        if item.is_dir()
        and not any(item.name.startswith(p) for p in skip_prefixes)
        and (item / 'data.json').exists()
    )

    for i, folder in enumerate(folders):
        projects.append({
            'folder':      folder.name,
            'name':        folder.name,
            'icon':        _ICONS[i % len(_ICONS)],
            'color':       _COLORS[i % len(_COLORS)],
            'description': None,
        })

    return projects


class ScriptAnalyzerHandler(http.server.SimpleHTTPRequestHandler):

    def do_GET(self):
        # ── Auto-discover endpoint ──────────────────────────────────────
        if self.path.split('?')[0] == '/api/projects':
            self._send_json(_scan_projects())
            return

        # ── Everything else: serve as static file ──────────────────────
        super().do_GET()

    def _send_json(self, data):
        body = json.dumps(data, ensure_ascii=False, indent=2).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type',   'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control',  'no-cache')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # Only log errors, not every GET request
        if '404' in str(args):
            print(f"  ⚠️  Not found: {args[1] if len(args) > 1 else ''}")


def _open_browser():
    webbrowser.open(f'http://localhost:{PORT}')


if __name__ == '__main__':
    import sys
    # Fix Windows console encoding
    if sys.platform == 'win32':
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')

    os.chdir(BASE_DIR)

    projects = _scan_projects()

    print()
    print("=" * 52)
    print("  [*]  Script Analyzer Tool -- Local Server")
    print("=" * 52)
    print(f"\n  [URL]   : http://localhost:{PORT}")
    print(f"  [DIR]   : {BASE_DIR}")
    print()

    if projects:
        print(f"  [OK]  {len(projects)} project(s) detected:")
        for p in projects:
            print(f"         -  {p['name']}")
    else:
        print("  [!]  No projects found!")
        print("       Each project folder must contain data.json")

    print()
    print("  [Ctrl+C to stop]")
    print("=" * 52)
    print()

    # Auto-open browser after 1 second
    Timer(1.0, _open_browser).start()

    with socketserver.TCPServer(('', PORT), ScriptAnalyzerHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  [STOP] Server stopped.\n")
