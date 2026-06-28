import sys
import os
import logging
import traceback
import customtkinter as ctk
from gui import BotApp

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

CURRENT_VERSION = "1.1.0"
VERSION_URL = "https://bestabot.com/version.json"

_CRASH_LOG_DIR = os.path.join(os.path.expanduser("~"), "AppData", "Roaming", "BestaBot") if sys.platform == "win32" else os.path.expanduser("~/.bestabot")


def _check_for_updates():
    try:
        import urllib.request
        import json
        with urllib.request.urlopen(VERSION_URL, timeout=3) as r:
            data = json.loads(r.read())
        latest = data.get("version", CURRENT_VERSION)
        if latest != CURRENT_VERSION:
            return latest, data.get("download_url", ""), data.get("changelog", "")
    except Exception:
        pass
    return None, None, None


def _show_update_dialog(latest, url, changelog):
    import tkinter.messagebox
    msg = f"A new version ({latest}) is available.\n\n{changelog}\n\nDownload now?"
    if tkinter.messagebox.askyesno("Update Available", msg):
        import webbrowser
        webbrowser.open(url)


def _handle_exception(exc_type, exc_value, exc_traceback):
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc_value, exc_traceback)
        return
    logger.error("Uncaught exception", exc_info=(exc_type, exc_value, exc_traceback))
    try:
        os.makedirs(_CRASH_LOG_DIR, exist_ok=True)
        crash_log = os.path.join(_CRASH_LOG_DIR, "crash.log")
        with open(crash_log, "a", encoding="utf-8") as f:
            import datetime
            f.write(f"\n--- Crash at {datetime.datetime.now().isoformat()} ---\n")
            traceback.print_exception(exc_type, exc_value, exc_traceback, file=f)
        import tkinter.messagebox
        tkinter.messagebox.showerror(
            "Besta Bot Crashed",
            f"An unexpected error occurred. A crash log has been saved to:\n{crash_log}\n\nPlease send this file to support."
        )
    except Exception:
        pass


sys.excepthook = _handle_exception


def main():
    logger.info("Starting Besta Bot GUI...")
    ctk.set_appearance_mode("Dark")
    ctk.set_default_color_theme("blue")

    latest, url, changelog = _check_for_updates()

    app = BotApp()

    if latest:
        app.after(1500, lambda: _show_update_dialog(latest, url, changelog))

    app.mainloop()


if __name__ == "__main__":
    main()
