import tkinter as tk
from tkinter import ttk, messagebox
import keyboard
import time
import threading
import sys
import os
import json
import traceback
from ctypes import windll, Structure, c_ulong, POINTER, c_uint, c_long, c_int, sizeof, byref

class POINT(Structure):
    _fields_ = [("x", c_long), ("y", c_long)]

class MOUSEINPUT(Structure):
    _fields_ = [
        ("dx", c_long),
        ("dy", c_long),
        ("mouseData", c_ulong),
        ("dwFlags", c_ulong),
        ("time", c_ulong),
        ("dwExtraInfo", POINTER(c_ulong))
    ]

class INPUT(Structure):
    class _INPUT(Structure):
        _fields_ = [("mi", MOUSEINPUT)]
    _anonymous_ = ("_input",)
    _fields_ = [("type", c_uint), ("_input", _INPUT)]

INPUT_MOUSE = 0
MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_ABSOLUTE = 0x8000

class BlueArchiveMacro:
    def __init__(self, root):
        self.root = root
        self.root.title("Blue Archive Macro")
        self.root.geometry("800x600")
        
        self.is_listening = False
        self.listening_thread = None
        self.actions = []
        self.config_file = "blue_archive_macro.json"
        self.screen_width, self.screen_height = self.get_screen_resolution()
        
        self.status_text = tk.StringVar()
        self.status_text.set(f"Ready - Resolution: {self.screen_width}x{self.screen_height}")
        
        self.create_ui()
        self.load_config()
        
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.error_log = "macro_error.log"
        if os.path.exists(self.error_log):
            os.remove(self.error_log)

    def get_screen_resolution(self):
        user32 = windll.user32
        return user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)

    def create_ui(self):
        try:
            style = ttk.Style()
            style.configure("TLabel", font=("Segoe UI", 11))
            style.configure("TButton", font=("Segoe UI", 11))
            style.configure("TEntry", font=("Segoe UI", 11))
            style.configure("TCombobox", font=("Segoe UI", 11))
            
            main_frame = ttk.Frame(self.root)
            main_frame.pack(fill=tk.BOTH, expand=True, padx=15, pady=15)
            
            res_frame = ttk.LabelFrame(main_frame, text="Screen Resolution")
            res_frame.pack(fill=tk.X, padx=10, pady=10, ipadx=10, ipady=10)
            
            ttk.Label(res_frame, text="Resolution:").grid(row=0, column=0, padx=10, pady=10)
            self.res_combo = ttk.Combobox(res_frame, width=15, values=[
                "1920x1080", "2560x1440", "2500x1600", "3840x2160", "Custom"
            ], font=("Segoe UI", 11))
            self.res_combo.grid(row=0, column=1, padx=10, pady=10)
            self.res_combo.set(f"{self.screen_width}x{self.screen_height}")
            self.res_combo.bind("<<ComboboxSelected>>", self.on_resolution_change)
            
            ttk.Label(res_frame, text="Custom Width:").grid(row=0, column=2, padx=10, pady=10)
            self.custom_width = ttk.Entry(res_frame, width=8, font=("Segoe UI", 11))
            self.custom_width.grid(row=0, column=3, padx=10, pady=10)
            self.custom_width.insert(0, str(self.screen_width))
            
            ttk.Label(res_frame, text="Custom Height:").grid(row=0, column=4, padx=10, pady=10)
            self.custom_height = ttk.Entry(res_frame, width=8, font=("Segoe UI", 11))
            self.custom_height.grid(row=0, column=5, padx=10, pady=10)
            self.custom_height.insert(0, str(self.screen_height))
            
            config_frame = ttk.LabelFrame(main_frame, text="Macro Configuration")
            config_frame.pack(fill=tk.X, padx=10, pady=10, ipadx=10, ipady=10)
            
            ttk.Label(config_frame, text="Macro Name:").grid(row=0, column=0, padx=10, pady=10)
            self.action_name = ttk.Entry(config_frame, width=15, font=("Segoe UI", 11))
            self.action_name.grid(row=0, column=1, padx=10, pady=10)
            self.action_name.insert(0, "Macro1")
            
            ttk.Label(config_frame, text="Hotkey:").grid(row=0, column=2, padx=10, pady=10)
            self.hotkey_entry = ttk.Entry(config_frame, width=8, font=("Segoe UI", 11))
            self.hotkey_entry.grid(row=0, column=3, padx=10, pady=10)
            self.hotkey_entry.insert(0, "q")
            
            ttk.Label(config_frame, text="Action Type:").grid(row=1, column=0, padx=10, pady=10)
            self.action_type = ttk.Combobox(config_frame, width=10, values=["Click", "Drag"], font=("Segoe UI", 11))
            self.action_type.grid(row=1, column=1, padx=10, pady=10)
            self.action_type.current(0)
            
            ttk.Label(config_frame, text="Target (X,Y):").grid(row=1, column=2, padx=10, pady=10)
            self.target_x = ttk.Entry(config_frame, width=8, font=("Segoe UI", 11))
            self.target_x.grid(row=1, column=3, padx=10, pady=10)
            self.target_y = ttk.Entry(config_frame, width=8, font=("Segoe UI", 11))
            self.target_y.grid(row=1, column=4, padx=10, pady=10)
            
            capture_btn = ttk.Button(config_frame, text="Capture Position", command=self.capture_position)
            capture_btn.grid(row=1, column=5, padx=10, pady=10)
            
            ttk.Label(config_frame, text="Drag Duration (s):").grid(row=2, column=0, padx=10, pady=10)
            self.drag_duration = ttk.Entry(config_frame, width=8, font=("Segoe UI", 11))
            self.drag_duration.grid(row=2, column=1, padx=10, pady=10)
            self.drag_duration.insert(0, "0.03")
            
            ttk.Label(config_frame, text="Loop Interval (s):").grid(row=2, column=2, padx=10, pady=10)
            self.loop_interval = ttk.Entry(config_frame, width=8, font=("Segoe UI", 11))
            self.loop_interval.grid(row=2, column=3, padx=10, pady=10)
            self.loop_interval.insert(0, "0.05")
            
            button_frame = ttk.Frame(config_frame)
            button_frame.grid(row=3, column=0, columnspan=6, pady=15)
            
            ttk.Button(button_frame, text="Add Macro", command=self.add_action).pack(side=tk.LEFT, padx=15)
            ttk.Button(button_frame, text="Test Macro", command=self.test_action).pack(side=tk.LEFT, padx=15)
            ttk.Button(button_frame, text="Delete Selected", command=self.delete_selected).pack(side=tk.RIGHT, padx=15)
            
            list_frame = ttk.LabelFrame(main_frame, text="Macro List")
            list_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10, ipadx=10, ipady=10)
            
            scrollbar = ttk.Scrollbar(list_frame)
            scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
            
            self.action_list = tk.Listbox(
                list_frame, 
                height=12, 
                yscrollcommand=scrollbar.set,
                font=("Segoe UI", 11)
            )
            self.action_list.pack(fill=tk.BOTH, expand=True)
            scrollbar.config(command=self.action_list.yview)
            
            control_frame = ttk.Frame(main_frame)
            control_frame.pack(fill=tk.X, padx=10, pady=15)
            
            self.listen_btn = ttk.Button(
                control_frame, 
                text="Start Game (s)", 
                command=self.toggle_listening,
                style="Accent.TButton"
            )
            self.listen_btn.pack(side=tk.LEFT, padx=15)
            
            ttk.Button(control_frame, text="Save Config", command=self.save_config).pack(side=tk.RIGHT, padx=15)
            ttk.Button(control_frame, text="Load Config", command=self.load_config).pack(side=tk.RIGHT, padx=15)
            
            status_frame = ttk.Frame(self.root)
            status_frame.pack(side=tk.BOTTOM, fill=tk.X)
            
            status_label = ttk.Label(
                status_frame, 
                textvariable=self.status_text, 
                relief=tk.SUNKEN, 
                anchor=tk.W,
                padding=5,
                font=("Segoe UI", 10)
            )
            status_label.pack(fill=tk.X, side=tk.LEFT)
            
            style.configure("Accent.TButton", font=("Segoe UI", 11, "bold"))
        
        except Exception as e:
            self.log_error(f"UI creation error: {str(e)}")
            messagebox.showerror("Error", f"Initialization failed: {str(e)}")
            sys.exit(1)

    def on_resolution_change(self, event):
        selected = self.res_combo.get()
        if selected == "Custom":
            self.custom_width.config(state="normal")
            self.custom_height.config(state="normal")
        else:
            self.custom_width.config(state="disabled")
            self.custom_height.config(state="disabled")
            if "x" in selected:
                width, height = selected.split("x")
                self.screen_width = int(width)
                self.screen_height = int(height)
                self.status_text.set(f"Resolution set: {self.screen_width}x{self.screen_height}")

    def capture_position(self):
        try:
            self.status_text.set("Capturing position in 3 seconds...")
            self.root.update()
            time.sleep(3)
            
            pt = POINT()
            windll.user32.GetCursorPos(byref(pt))
            
            self.target_x.delete(0, tk.END)
            self.target_x.insert(0, str(pt.x))
            self.target_y.delete(0, tk.END)
            self.target_y.insert(0, str(pt.y))
            self.status_text.set(f"Position captured: ({pt.x}, {pt.y})")
        except Exception as e:
            self.log_error(f"Position capture error: {str(e)}")

    def add_action(self):
        try:
            hotkey = self.hotkey_entry.get().strip().lower()
            action_name = self.action_name.get().strip()
            action_type = self.action_type.get()
            
            if not hotkey:
                messagebox.showerror("Error", "Hotkey required")
                return
            if not action_name:
                messagebox.showerror("Error", "Macro name required")
                return
                
            try:
                target_x = int(self.target_x.get())
                target_y = int(self.target_y.get())
                drag_duration = float(self.drag_duration.get())
                loop_interval = float(self.loop_interval.get())
            except ValueError:
                messagebox.showerror("Error", "Invalid number format")
                return
            
            for action in self.actions:
                if action['hotkey'] == hotkey:
                    messagebox.showerror("Error", f"Hotkey {hotkey} used by '{action['name']}'")
                    return
            
            action = {
                "name": action_name,
                "hotkey": hotkey,
                "type": action_type,
                "target_x": target_x,
                "target_y": target_y,
                "drag_duration": drag_duration,
                "loop_interval": loop_interval
            }
            
            self.actions.append(action)
            self.action_list.insert(tk.END, f"{action_name} ({hotkey}) - {action_type} @ ({target_x}, {target_y})")
            self.status_text.set(f"Macro added: {action_name} (Hotkey: {hotkey})")
            
            self.action_name.delete(0, tk.END)
            self.action_name.insert(0, f"Macro{len(self.actions)+1}")
            
            if hotkey == 'q': next_key = 'w'
            elif hotkey == 'w': next_key = 'e'
            elif hotkey == 'e': next_key = 'r'
            elif hotkey == 'r': next_key = 't'
            elif hotkey == 't': next_key = 'y'
            elif hotkey == 'y': next_key = 'u'
            elif hotkey == 'u': next_key = 'i'
            elif hotkey == 'i': next_key = 'o'
            elif hotkey == 'o': next_key = 'p'
            elif hotkey == 'p': next_key = 'a'
            elif hotkey == 'a': next_key = 's'
            elif hotkey == 's': next_key = 'd'
            elif hotkey == 'd': next_key = 'f'
            elif hotkey == 'f': next_key = 'g'
            elif hotkey == 'g': next_key = 'h'
            elif hotkey == 'h': next_key = 'j'
            elif hotkey == 'j': next_key = 'k'
            elif hotkey == 'k': next_key = 'l'
            elif hotkey == 'l': next_key = 'z'
            elif hotkey == 'z': next_key = 'x'
            elif hotkey == 'x': next_key = 'c'
            elif hotkey == 'c': next_key = 'v'
            elif hotkey == 'v': next_key = 'b'
            elif hotkey == 'b': next_key = 'n'
            elif hotkey == 'n': next_key = 'm'
            else: next_key = 'q'
            
            self.hotkey_entry.delete(0, tk.END)
            self.hotkey_entry.insert(0, next_key)
        except Exception as e:
            self.log_error(f"Add macro error: {str(e)}")

    def delete_selected(self):
        try:
            selection = self.action_list.curselection()
            if not selection:
                messagebox.showinfo("Info", "Select a macro to delete")
                return
                
            index = selection[0]
            action_name = self.actions[index]['name']
            self.actions.pop(index)
            self.action_list.delete(index)
            self.status_text.set(f"Deleted macro: {action_name}")
        except Exception as e:
            self.log_error(f"Delete macro error: {str(e)}")

    def test_action(self):
        try:
            try:
                target_x = int(self.target_x.get())
                target_y = int(self.target_y.get())
                drag_duration = float(self.drag_duration.get())
            except ValueError:
                messagebox.showerror("Error", "Invalid number format")
                return
            
            action_name = self.action_name.get() or "Test Macro"
            action_type = self.action_type.get()
            
            action = {
                "name": action_name,
                "type": action_type,
                "target_x": target_x,
                "target_y": target_y,
                "drag_duration": drag_duration
            }
            
            self.status_text.set(f"Testing: {action_name}...")
            self.root.update()
            
            threading.Thread(target=self.perform_action, args=(action,), daemon=True).start()
        except Exception as e:
            self.log_error(f"Test macro error: {str(e)}")

    def absolute_coordinates(self, x, y):
        abs_x = int((x * 65535) / self.screen_width)
        abs_y = int((y * 65535) / self.screen_height)
        return abs_x, abs_y

    def simulate_mouse_move(self, x, y):
        abs_x, abs_y = self.absolute_coordinates(x, y)
        
        move_input = INPUT()
        move_input.type = INPUT_MOUSE
        move_input.mi.dx = abs_x
        move_input.mi.dy = abs_y
        move_input.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE
        
        windll.user32.SendInput(1, byref(move_input), sizeof(move_input))

    def simulate_mouse_click(self, x, y):
        abs_x, abs_y = self.absolute_coordinates(x, y)
        
        move_input = INPUT()
        move_input.type = INPUT_MOUSE
        move_input.mi.dx = abs_x
        move_input.mi.dy = abs_y
        move_input.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE
        windll.user32.SendInput(1, byref(move_input), sizeof(move_input))
        
        down_input = INPUT()
        down_input.type = INPUT_MOUSE
        down_input.mi.dwFlags = MOUSEEVENTF_LEFTDOWN
        windll.user32.SendInput(1, byref(down_input), sizeof(down_input))
        
        up_input = INPUT()
        up_input.type = INPUT_MOUSE
        up_input.mi.dwFlags = MOUSEEVENTF_LEFTUP
        windll.user32.SendInput(1, byref(up_input), sizeof(up_input))

    def simulate_drag(self, start_x, start_y, end_x, end_y, duration):
        self.simulate_mouse_move(start_x, start_y)
        
        down_input = INPUT()
        down_input.type = INPUT_MOUSE
        down_input.mi.dwFlags = MOUSEEVENTF_LEFTDOWN
        windll.user32.SendInput(1, byref(down_input), sizeof(down_input))
        
        self.simulate_mouse_move(start_x, start_y - 300)
        time.sleep(duration * 0.3)
        
        steps = max(10, int(duration * 70))
        step_delay = duration * 0.7 / steps
        
        for i in range(1, steps + 1):
            current_x = start_x + (end_x - start_x) * i / steps
            current_y = (start_y - 300) + (end_y - (start_y - 300)) * i / steps
            self.simulate_mouse_move(current_x, current_y)
            time.sleep(step_delay)
        
        up_input = INPUT()
        up_input.type = INPUT_MOUSE
        up_input.mi.dwFlags = MOUSEEVENTF_LEFTUP
        windll.user32.SendInput(1, byref(up_input), sizeof(up_input))

    def perform_action(self, action):
        try:
            target_x = action['target_x']
            target_y = action['target_y']
            action_type = action.get('type', 'Click')
            drag_duration = action.get('drag_duration', 0.03)
            
            pt = POINT()
            windll.user32.GetCursorPos(byref(pt))
            end_x, end_y = pt.x, pt.y
            
            if action_type == "Drag":
                self.simulate_drag(target_x, target_y, end_x, end_y, drag_duration)
                action_desc = f"Drag from ({target_x}, {target_y}) to ({end_x}, {end_y})"
            else:
                self.simulate_mouse_click(target_x, target_y)
                action_desc = f"Click at ({target_x}, {target_y})"
            
            self.status_text.set(f"Completed: {action['name']} ({action_desc})")
        except Exception as e:
            self.status_text.set(f"Error: {str(e)}")
            self.log_error(f"Execution error: {str(e)}")

    def toggle_listening(self):
        try:
            if self.is_listening:
                self.stop_listening()
            else:
                self.start_listening()
        except Exception as e:
            self.log_error(f"Toggle listening error: {str(e)}")

    def start_listening(self):
        try:
            if not self.actions:
                messagebox.showwarning("Warning", "Add at least one macro")
                return
                
            self.is_listening = True
            self.listen_btn.config(text="Stop Game (s)")
            self.status_text.set("Listening... Press hotkeys to execute macros")
            
            threading.Thread(target=self.listen_keys, daemon=True).start()
        except Exception as e:
            self.log_error(f"Start listening error: {str(e)}")

    def stop_listening(self):
        try:
            self.is_listening = False
            self.listen_btn.config(text="Start Game (s)")
            self.status_text.set("Stopped listening")
        except Exception as e:
            self.log_error(f"Stop listening error: {str(e)}")

    def listen_keys(self):
        try:
            action_states = {action['hotkey']: False for action in self.actions}
            
            while self.is_listening:
                for action in self.actions:
                    hotkey = action['hotkey']
                    
                    if keyboard.is_pressed(hotkey):
                        if not action_states[hotkey]:
                            action_states[hotkey] = True
                            threading.Thread(
                                target=self.execute_action_loop, 
                                args=(action,),
                                daemon=True
                            ).start()
                    else:
                        action_states[hotkey] = False
                
                time.sleep(0.05)
        except Exception as e:
            self.log_error(f"Key listening error: {str(e)}")
            self.stop_listening()

    def execute_action_loop(self, action):
        try:
            hotkey = action['hotkey']
            
            while self.is_listening and keyboard.is_pressed(hotkey):
                self.perform_action(action)
                
                interval = float(action['loop_interval'])
                start_time = time.time()
                
                while time.time() - start_time < interval:
                    if not keyboard.is_pressed(hotkey) or not self.is_listening:
                        return
                    time.sleep(0.05)
        except Exception as e:
            self.log_error(f"Loop execution error: {str(e)}")

    def save_config(self):
        try:
            config = {
                "resolution": {
                    "width": self.screen_width,
                    "height": self.screen_height
                },
                "actions": self.actions
            }
            
            with open(self.config_file, 'w') as f:
                json.dump(config, f, indent=4)
            self.status_text.set(f"Config saved: {self.config_file}")
        except Exception as e:
            messagebox.showerror("Save Error", f"Save failed: {str(e)}")
            self.log_error(f"Save error: {str(e)}")

    def load_config(self):
        try:
            if not os.path.exists(self.config_file):
                self.status_text.set("Config file not found")
                return
                
            with open(self.config_file, 'r') as f:
                config = json.load(f)
            
            if "resolution" in config:
                self.screen_width = config["resolution"]["width"]
                self.screen_height = config["resolution"]["height"]
                self.res_combo.set(f"{self.screen_width}x{self.screen_height}")
                self.status_text.set(f"Resolution: {self.screen_width}x{self.screen_height}")
            
            if "actions" in config:
                self.actions = config["actions"]
                self.action_list.delete(0, tk.END)
                for action in self.actions:
                    self.action_list.insert(tk.END, 
                        f"{action['name']} ({action['hotkey']}) - {action['type']} @ ({action['target_x']}, {action['target_y']})"
                    )
            
            self.status_text.set(f"Config loaded: {self.config_file}")
        except Exception as e:
            messagebox.showerror("Load Error", f"Load failed: {str(e)}")
            self.log_error(f"Load error: {str(e)}")

    def log_error(self, message):
        try:
            with open(self.error_log, "a") as f:
                f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}\n")
        except:
            pass

    def on_close(self):
        try:
            self.is_listening = False
            self.save_config()
            self.root.destroy()
            sys.exit()
        except:
            os._exit(0)

if __name__ == "__main__":
    try:
        try:
            from ctypes import windll
            windll.shcore.SetProcessDpiAwareness(1)
        except:
            pass
        
        root = tk.Tk()
        app = BlueArchiveMacro(root)
        root.mainloop()
    except Exception as e:
        with open("macro_crash.log", "w") as f:
            f.write(f"Crash time: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"Error type: {type(e).__name__}\n")
            f.write(f"Error message: {str(e)}\n")
            f.write("\nStack trace:\n")
            traceback.print_exc(file=f)
        
        messagebox.showerror("Crash", f"Application failed to start:\n{str(e)}\n\nSee log for details")