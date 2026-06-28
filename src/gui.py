import os
import sys
import json
import threading
import logging
import customtkinter as ctk

from licensing import LicenseManager
import config
import connection
from strategies.double_martingale import DoubleMartingaleBot


class GUILogHandler(logging.Handler):
    def __init__(self, text_widget):
        super().__init__()
        self.text_widget = text_widget

    def emit(self, record):
        msg = self.format(record)
        def append():
            self.text_widget.configure(state="normal")
            self.text_widget.insert("end", msg + "\n")
            self.text_widget.see("end")
            self.text_widget.configure(state="disabled")
        self.text_widget.after(0, append)


class BotApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("Besta Bot v1.1")
        self.geometry("900x700")

        self.license_manager = LicenseManager()
        self.bot_thread = None
        self.bot_instance = None
        self.is_running = False

        self._load_settings()
        self._build_ui()
        self._setup_logging()

    def _load_settings(self):
        self.settings_file = "user_settings.json"
        self.settings = {
            "email": "",
            "password": "",
            "token": "",
            "account_type": "PRACTICE",
            "tiers": [
                "[2, 5, 11]",
                "[7, 18, 39]",
                "[25, 63, 140]",
                "[88, 221, 490]",
                "[308, 774, 1715]",
                "[1078, 2709, 6003]",
                "[3773, 9483, 21011]",
                "[13206, 33191, 73539]"
            ]
        }
        if os.path.exists(self.settings_file):
            try:
                with open(self.settings_file, "r") as f:
                    data = json.load(f)
                    self.settings.update(data)
            except Exception:
                pass

    def _save_settings(self):
        try:
            with open(self.settings_file, "w") as f:
                json.dump(self.settings, f, indent=4)
        except Exception:
            pass

    def _build_ui(self):
        self.tabview = ctk.CTkTabview(self)
        self.tabview.pack(fill="both", expand=True, padx=10, pady=10)

        self.tab_main = self.tabview.add("Main & Logs")
        self.tab_settings = self.tabview.add("Settings & Tiers")

        self._build_main_tab()
        self._build_settings_tab()

    def _build_main_tab(self):
        cred_frame = ctk.CTkFrame(self.tab_main)
        cred_frame.pack(fill="x", padx=10, pady=10)

        ctk.CTkLabel(cred_frame, text="Email:").grid(row=0, column=0, padx=5, pady=5)
        self.email_entry = ctk.CTkEntry(cred_frame, width=200)
        self.email_entry.grid(row=0, column=1, padx=5, pady=5)
        self.email_entry.insert(0, self.settings["email"])

        ctk.CTkLabel(cred_frame, text="Password:").grid(row=0, column=2, padx=5, pady=5)
        self.password_entry = ctk.CTkEntry(cred_frame, width=200, show="*")
        self.password_entry.grid(row=0, column=3, padx=5, pady=5)
        self.password_entry.insert(0, self.settings["password"])

        ctk.CTkLabel(cred_frame, text="Access Token:").grid(row=1, column=0, padx=5, pady=5)
        self.token_entry = ctk.CTkEntry(cred_frame, width=200)
        self.token_entry.grid(row=1, column=1, padx=5, pady=5)
        self.token_entry.insert(0, self.settings["token"])

        self.account_type_var = ctk.StringVar(value=self.settings["account_type"])
        ctk.CTkOptionMenu(cred_frame, variable=self.account_type_var, values=["PRACTICE", "REAL"]).grid(row=1, column=3, padx=5, pady=5)

        control_frame = ctk.CTkFrame(self.tab_main)
        control_frame.pack(fill="x", padx=10, pady=5)

        self.start_btn = ctk.CTkButton(control_frame, text="START BOT", fg_color="green", hover_color="darkgreen", command=self.toggle_bot)
        self.start_btn.pack(pady=10)

        self.log_box = ctk.CTkTextbox(self.tab_main, state="disabled")
        self.log_box.pack(fill="both", expand=True, padx=10, pady=10)

    def _build_settings_tab(self):
        lbl = ctk.CTkLabel(self.tab_settings, text="Risk Tiers (Must be minimum 3 steps each)", font=("Arial", 16, "bold"))
        lbl.pack(pady=10)

        self.tier_entries = []
        for i in range(8):
            frame = ctk.CTkFrame(self.tab_settings)
            frame.pack(fill="x", padx=20, pady=5)
            ctk.CTkLabel(frame, text=f"Tier {i+1}:").pack(side="left", padx=10)
            entry = ctk.CTkEntry(frame, width=400)
            entry.pack(side="left", padx=10)
            entry.insert(0, self.settings["tiers"][i])
            self.tier_entries.append(entry)

        save_btn = ctk.CTkButton(self.tab_settings, text="Save Settings", command=self.save_tiers)
        save_btn.pack(pady=20)

    def _setup_logging(self):
        root_logger = logging.getLogger()
        handler = GUILogHandler(self.log_box)
        handler.setFormatter(logging.Formatter('%(asctime)s - %(message)s', datefmt='%H:%M:%S'))
        root_logger.addHandler(handler)

    def save_tiers(self):
        new_tiers = []
        for entry in self.tier_entries:
            val = entry.get()
            try:
                parsed = json.loads(val)
                if not isinstance(parsed, list):
                    raise ValueError("Not a list")
                if len(parsed) < 3:
                    import tkinter.messagebox
                    tkinter.messagebox.showerror("Validation Error", f"Tier '{val}' has less than 3 steps! Minimum 3 steps required.")
                    return
                new_tiers.append(val)
            except Exception as e:
                import tkinter.messagebox
                tkinter.messagebox.showerror("Validation Error", f"Invalid format for tier: {val}\nUse standard list format like [2, 5, 11]")
                return

        self.settings["tiers"] = new_tiers
        self._save_settings()
        import tkinter.messagebox
        tkinter.messagebox.showinfo("Saved", "Settings saved successfully!")

    def toggle_bot(self):
        if self.is_running:
            self.stop_bot()
        else:
            self.start_bot()

    def start_bot(self):
        email = self.email_entry.get().strip()
        pwd = self.password_entry.get().strip()
        token = self.token_entry.get().strip()
        acc_type = self.account_type_var.get()

        if not email or not pwd or not token:
            logging.error("Missing Email, Password, or Token!")
            return

        valid, msg = self.license_manager.validate_and_activate(token)
        if not valid:
            logging.error(f"LICENSE ERROR: {msg}")
            return

        logging.info(f"LICENSE SUCCESS: {msg}")

        self.settings["email"] = email
        self.settings["password"] = pwd
        self.settings["token"] = token
        self.settings["account_type"] = acc_type
        self._save_settings()

        config.IQ_EMAIL = email
        config.IQ_PASSWORD = pwd
        config.IQ_ACCOUNT_TYPE = acc_type
        connection.IQ_EMAIL = email
        connection.IQ_PASSWORD = pwd
        connection.IQ_ACCOUNT_TYPE = acc_type

        parsed_tiers = []
        for t in self.settings["tiers"]:
            parsed_tiers.append(json.loads(t))

        self.is_running = True
        self.start_btn.configure(text="STOP BOT", fg_color="red", hover_color="darkred")

        self.bot_thread = threading.Thread(target=self._run_bot_loop, args=(parsed_tiers,), daemon=True)
        self.bot_thread.start()

    def stop_bot(self):
        self.is_running = False
        if self.bot_instance:
            self.bot_instance.stop_requested = True
        logging.info("Stopping bot... (Please wait for the current cycle to finish)")
        self.start_btn.configure(text="START BOT", fg_color="green", hover_color="darkgreen")

    def _run_bot_loop(self, parsed_tiers):
        try:
            logging.info("Initializing trading strategy...")
            self.bot_instance = DoubleMartingaleBot(
                asset="GBPJPY-OTC",
                min_profit_pct=None
            )
            self.bot_instance.stop_requested = False
            self.bot_instance.update_config({"budget_tiers": parsed_tiers}, skip_history=True)
            self.bot_instance.run()
        except Exception as e:
            logging.error(f"Bot Error: {e}")
        finally:
            self.is_running = False
            self.start_btn.configure(text="START BOT", fg_color="green", hover_color="darkgreen")


if __name__ == "__main__":
    ctk.set_appearance_mode("Dark")
    ctk.set_default_color_theme("blue")
    app = BotApp()
    app.mainloop()
