#!/usr/bin/env python3
"""Load an HTML test page in WebKitGTK (the engine the HYTE panel kiosk uses)
and print the JSON the page posts to window.webkit.messageHandlers.result
(or puts in its <title> after a RESULT: prefix).

    automata/test/run-webkit.py automata/test/gpu.html

Exit status is 0 when the JSON has "ok": true. Needs python3-gi, gir1.2-gtk-4.0
and gir1.2-webkit-6.0, and a running display session."""
import json
import os
import sys

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("WebKit", "6.0")
from gi.repository import GLib, Gtk, WebKit  # noqa: E402

path = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "automata/test/gpu.html")
timeout = int(sys.argv[2]) if len(sys.argv) > 2 else 30
result = {}


class App(Gtk.Application):
    def do_activate(self):
        win = Gtk.ApplicationWindow(application=self, title="ca test")
        win.set_default_size(480, 360)
        view = WebKit.WebView()
        view.get_settings().set_enable_developer_extras(True)
        # Pages report with window.webkit.messageHandlers.result.postMessage(json).
        # Titles are a fallback but WebKit truncates long ones.
        ucm = view.get_user_content_manager()
        ucm.register_script_message_handler("result", None)

        def on_message(_ucm, value):
            result.update(json.loads(value.to_string()))
            self.quit()

        ucm.connect("script-message-received::result", on_message)
        win.set_child(view)
        win.present()

        def on_title(*_):
            title = view.get_title() or ""
            if title.startswith("RESULT:"):
                result.update(json.loads(title[7:]))
                self.quit()

        view.connect("notify::title", on_title)
        view.load_uri("file://" + path)
        GLib.timeout_add_seconds(timeout, lambda: (result.update({"ok": False, "error": "timeout"}), self.quit()) and False)


App(application_id="dev.ca.test").run([])
print(json.dumps(result, indent=1))
sys.exit(0 if result.get("ok") else 1)
