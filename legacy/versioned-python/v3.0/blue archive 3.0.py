import tkinter as tk
from tkinter import ttk, messagebox
import keyboard
import time
import threading
import sys
import os
import json
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

class HighDPIScaling:
    def __init__(self):
        self.scaling_factor = self.get_system_scaling()
    
    def get_system_scaling(self):
        user32 = windll.user32
        user32.SetProcessDPIAware()
        hdc = user32.GetDC(0)
        dpi_x = windll.gdi32.GetDeviceCaps(hdc, 88)
        user32.ReleaseDC(0, hdc)
        return max(1.0, min(2.5, dpi_x / 96.0))
    
    def scale(self, value):
        return int(value * self.scaling_factor)

class VirtualMouse:
    def __init__(self, screen_width, screen_height):
        self.screen_width = screen_width
        self.screen_height = screen_height
        self.x = 0
        self.y = 0
        self.left_pressed = False
    
    def move_to(self, x, y):
        self.x = max(0, min(x, self.screen_width))
        self.y = max(0, min(y, self.screen_height))
    
    def press_left(self):
        self.left_pressed = True
    
    def release_left(self):
        self.left_pressed = False

class BlueArchiveMacro:
    def __init__(self, root):
        self.root = root
        self.root.title("碧蓝档案PC宏")
        
        self.dpi = HighDPIScaling()
        self.root.geometry(f"{self.dpi.scale(900)}x{self.dpi.scale(700)}")
        
        try:
            windll.shcore.SetProcessDpiAwareness(1)
        except:
            pass
        
        self.is_listening = False
        self.actions = []
        self.config_file = "blue_archive_macro.json"
        self.screen_width, self.screen_height = self.get_screen_resolution()
        self.virtual_mouse = VirtualMouse(self.screen_width, self.screen_height)
        self.exit_key = 's'
        self.macro_keys = set()
        self.blocked_keys = set()
        
        self.status_text = tk.StringVar()
        self.status_text.set(f"就绪 - 屏幕分辨率: {self.screen_width}x{self.screen_height}")
        
        self.create_ui()
        self.load_config()
        
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.running = True

    def get_screen_resolution(self):
        user32 = windll.user32
        return user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)

    def create_ui(self):
        padx = self.dpi.scale(10)
        pady = self.dpi.scale(8)
        button_width = 15
        list_height = 15
        font_size = self.dpi.scale(14)
        
        style = ttk.Style()
        style.configure(".", font=("", font_size))
        
        main_frame = ttk.Frame(self.root)
        main_frame.pack(fill=tk.BOTH, expand=True, padx=padx, pady=pady)
        
        res_frame = ttk.LabelFrame(main_frame, text="屏幕分辨率设置", padding=(padx, pady))
        res_frame.pack(fill=tk.X, padx=padx, pady=pady)
        
        ttk.Label(res_frame, text="常用分辨率:").grid(row=0, column=0, padx=padx, pady=pady, sticky=tk.W)
        self.res_combo = ttk.Combobox(res_frame, width=15, values=[
            "1920x1080", "2560x1440", "2500x1600", "3840x2160", "自定义"
        ], font=("", font_size))
        self.res_combo.grid(row=0, column=1, padx=padx, pady=pady)
        self.res_combo.set(f"{self.screen_width}x{self.screen_height}")
        self.res_combo.bind("<<ComboboxSelected>>", self.on_resolution_change)
        
        ttk.Label(res_frame, text="自定义分辨率:").grid(row=0, column=2, padx=padx, pady=pady, sticky=tk.W)
        self.custom_width = ttk.Entry(res_frame, width=8, font=("", font_size))
        self.custom_width.grid(row=0, column=3, padx=padx, pady=pady)
        self.custom_width.insert(0, str(self.screen_width))
        self.custom_height = ttk.Entry(res_frame, width=8, font=("", font_size))
        self.custom_height.grid(row=0, column=4, padx=padx, pady=pady)
        self.custom_height.insert(0, str(self.screen_height))
        
        config_frame = ttk.LabelFrame(main_frame, text="宏配置", padding=(padx, pady))
        config_frame.pack(fill=tk.X, padx=padx, pady=pady)
        
        ttk.Label(config_frame, text="宏名称:").grid(row=0, column=0, padx=padx, pady=pady, sticky=tk.W)
        self.action_name = ttk.Entry(config_frame, width=15, font=("", font_size))
        self.action_name.grid(row=0, column=1, padx=padx, pady=pady)
        self.action_name.insert(0, "宏1")
        
        ttk.Label(config_frame, text="快捷键:").grid(row=0, column=2, padx=padx, pady=pady, sticky=tk.W)
        self.hotkey_entry = ttk.Entry(config_frame, width=5, font=("", font_size))
        self.hotkey_entry.grid(row=0, column=3, padx=padx, pady=pady)
        self.hotkey_entry.insert(0, "q")
        
        ttk.Label(config_frame, text="操作类型:").grid(row=1, column=0, padx=padx, pady=pady, sticky=tk.W)
        self.action_type = ttk.Combobox(config_frame, width=8, values=["点位", "拖动", "连点"], font=("", font_size))
        self.action_type.grid(row=1, column=1, padx=padx, pady=pady)
        self.action_type.current(0)
        
        ttk.Label(config_frame, text="目标位置 (X,Y):").grid(row=1, column=2, padx=padx, pady=pady, sticky=tk.W)
        self.target_x = ttk.Entry(config_frame, width=6, font=("", font_size))
        self.target_x.grid(row=1, column=3, padx=padx, pady=pady)
        self.target_y = ttk.Entry(config_frame, width=6, font=("", font_size))
        self.target_y.grid(row=1, column=4, padx=padx, pady=pady)
        
        capture_btn = ttk.Button(config_frame, text="捕获位置", width=button_width, command=self.capture_position)
        capture_btn.grid(row=1, column=5, padx=padx, pady=pady)
        
        ttk.Label(config_frame, text="向上拖动距离:").grid(row=2, column=0, padx=padx, pady=pady, sticky=tk.W)
        self.up_drag_distance = ttk.Entry(config_frame, width=6, font=("", font_size))
        self.up_drag_distance.grid(row=2, column=1, padx=padx, pady=pady)
        self.up_drag_distance.insert(0, "300")
        
        ttk.Label(config_frame, text="拖动时间 (秒):").grid(row=2, column=2, padx=padx, pady=pady, sticky=tk.W)
        self.drag_duration = ttk.Entry(config_frame, width=6, font=("", font_size))
        self.drag_duration.grid(row=2, column=3, padx=padx, pady=pady)
        self.drag_duration.insert(0, "0.02")
        
        ttk.Label(config_frame, text="连点间隔 (秒):").grid(row=2, column=4, padx=padx, pady=pady, sticky=tk.W)
        self.click_interval = ttk.Entry(config_frame, width=6, font=("", font_size))
        self.click_interval.grid(row=2, column=5, padx=padx, pady=pady)
        self.click_interval.insert(0, "0.1")
        
        button_frame = ttk.Frame(config_frame)
        button_frame.grid(row=3, column=0, columnspan=6, pady=pady)
        
        add_btn = ttk.Button(button_frame, text="添加宏", width=button_width, command=self.add_action)
        add_btn.pack(side=tk.LEFT, padx=padx)
        test_btn = ttk.Button(button_frame, text="测试宏", width=button_width, command=self.test_action)
        test_btn.pack(side=tk.LEFT, padx=padx)
        del_btn = ttk.Button(button_frame, text="删除选中", width=button_width, command=self.delete_selected)
        del_btn.pack(side=tk.RIGHT, padx=padx)
        
        list_frame = ttk.LabelFrame(main_frame, text="宏列表", padding=(padx, pady))
        list_frame.pack(fill=tk.BOTH, expand=True, padx=padx, pady=pady)
        
        scrollbar = ttk.Scrollbar(list_frame)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        
        self.action_list = tk.Listbox(list_frame, height=list_height, font=("", font_size),
                                    yscrollcommand=scrollbar.set, width=50)
        self.action_list.pack(fill=tk.BOTH, expand=True)
        scrollbar.config(command=self.action_list.yview)
        
        control_frame = ttk.Frame(main_frame)
        control_frame.pack(fill=tk.X, padx=padx, pady=pady)
        
        ttk.Label(control_frame, text="退出键:").pack(side=tk.LEFT, padx=padx)
        self.exit_key_entry = ttk.Entry(control_frame, width=5, font=("", font_size))
        self.exit_key_entry.pack(side=tk.LEFT, padx=padx)
        self.exit_key_entry.insert(0, "s")
        
        self.listen_btn = ttk.Button(control_frame, text="开始游戏", width=button_width, 
                                    command=self.toggle_listening)
        self.listen_btn.pack(side=tk.LEFT, padx=padx)
        
        save_btn = ttk.Button(control_frame, text="保存配置", width=button_width, command=self.save_config)
        save_btn.pack(side=tk.RIGHT, padx=padx)
        load_btn = ttk.Button(control_frame, text="加载配置", width=button_width, command=self.load_config)
        load_btn.pack(side=tk.RIGHT, padx=padx)
        
        status_frame = ttk.Frame(self.root)
        status_frame.pack(side=tk.BOTTOM, fill=tk.X)
        
        status_label = ttk.Label(status_frame, textvariable=self.status_text, relief=tk.SUNKEN, anchor=tk.W,
                                font=("", font_size))
        status_label.pack(fill=tk.X, side=tk.LEFT)
        
        footer_label = ttk.Label(status_frame, text="真理部最新力作", relief=tk.SUNKEN, anchor=tk.E,
                                font=("", font_size))
        footer_label.pack(fill=tk.X, side=tk.RIGHT, expand=True)

    def on_resolution_change(self, event):
        selected = self.res_combo.get()
        if selected == "自定义":
            self.custom_width.config(state="normal")
            self.custom_height.config(state="normal")
        else:
            self.custom_width.config(state="disabled")
            self.custom_height.config(state="disabled")
            if "x" in selected:
                width, height = selected.split("x")
                self.screen_width = int(width)
                self.screen_height = int(height)
                self.virtual_mouse = VirtualMouse(self.screen_width, self.screen_height)
                self.status_text.set(f"分辨率已设置为: {self.screen_width}x{self.screen_height}")

    def capture_position(self):
        self.status_text.set("2秒后捕获位置，请将鼠标移动到目标位置...")
        self.root.update()
        time.sleep(2)
        
        pt = POINT()
        if windll.user32.GetCursorPos(byref(pt)):
            self.target_x.delete(0, tk.END)
            self.target_x.insert(0, str(pt.x))
            self.target_y.delete(0, tk.END)
            self.target_y.insert(0, str(pt.y))
            self.status_text.set(f"位置已设置: ({pt.x}, {pt.y})")

    def add_action(self):
        hotkey = self.hotkey_entry.get().strip().lower()
        action_name = self.action_name.get().strip()
        action_type = self.action_type.get()
        
        if not hotkey or not action_name:
            messagebox.showerror("错误", "请设置宏名称和快捷键")
            return
            
        try:
            target_x = int(self.target_x.get())
            target_y = int(self.target_y.get())
            drag_distance = int(self.up_drag_distance.get())
            drag_duration = float(self.drag_duration.get())
            click_interval = float(self.click_interval.get())
        except:
            messagebox.showerror("错误", "请输入有效数字")
            return
        
        for action in self.actions:
            if action['hotkey'] == hotkey:
                messagebox.showerror("错误", f"快捷键 {hotkey} 已被 '{action['name']}' 使用")
                return
        
        action = {
            "name": action_name,
            "hotkey": hotkey,
            "type": action_type,
            "target_x": target_x,
            "target_y": target_y,
            "drag_distance": drag_distance,
            "drag_duration": drag_duration,
            "click_interval": click_interval
        }
        
        self.actions.append(action)
        self.action_list.insert(tk.END, f"{action_name} ({hotkey}) - {action_type} @ ({target_x}, {target_y})")
        self.status_text.set(f"宏已添加: {action_name} (快捷键: {hotkey})")
        
        self.action_name.delete(0, tk.END)
        self.action_name.insert(0, f"宏{len(self.actions)+1}")
        
        keys = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', 
                'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 
                'z', 'x', 'c', 'v', 'b', 'n', 'm']
        next_key = keys[(keys.index(hotkey) + 1) % len(keys)] if hotkey in keys else 'q'
        self.hotkey_entry.delete(0, tk.END)
        self.hotkey_entry.insert(0, next_key)

    def delete_selected(self):
        selection = self.action_list.curselection()
        if not selection:
            return
            
        index = selection[0]
        action_name = self.actions[index]['name']
        self.actions.pop(index)
        self.action_list.delete(index)
        self.status_text.set(f"已删除宏: {action_name}")

    def test_action(self):
        try:
            target_x = int(self.target_x.get())
            target_y = int(self.target_y.get())
            action_type = self.action_type.get()
            action_name = self.action_name.get() or "测试宏"
            
            action = {
                "name": action_name,
                "type": action_type,
                "target_x": target_x,
                "target_y": target_y,
                "drag_distance": int(self.up_drag_distance.get()),
                "drag_duration": float(self.drag_duration.get()),
                "click_interval": float(self.click_interval.get())
            }
            
            self.status_text.set(f"测试中: {action_name}...")
            self.root.update()
            
            if action_type == "点位":
                original_pt = POINT()
                windll.user32.GetCursorPos(byref(original_pt))
                original_x, original_y = original_pt.x, original_pt.y
                
                self.perform_point_action(target_x, target_y, action_name)
                time.sleep(0.5)
                self.release_point_action(original_x, original_y)
                self.status_text.set(f"测试完成: {action_name}")
            elif action_type == "拖动":
                threading.Thread(target=self.perform_drag_action, args=(action,), daemon=True).start()
            elif action_type == "连点":
                self.perform_click_action(action)
                self.status_text.set(f"测试完成: {action_name}")
        except Exception as e:
            self.status_text.set(f"测试宏时出错: {str(e)}")

    def absolute_coordinates(self, x, y):
        abs_x = int((x * 65535) / self.screen_width)
        abs_y = int((y * 65535) / self.screen_height)
        return abs_x, abs_y

    def send_mouse_event(self, flags, dx=0, dy=0, data=0):
        mi = MOUSEINPUT(dx, dy, data, flags, 0, None)
        input_struct = INPUT()
        input_struct.type = INPUT_MOUSE
        input_struct.mi = mi
        windll.user32.SendInput(1, byref(input_struct), sizeof(input_struct))

    def perform_drag_action(self, action):
        start_x = action['target_x']
        start_y = action['target_y']
        drag_distance = action.get('drag_distance', 300)
        drag_duration = action.get('drag_duration', 0.03)
        
        pt = POINT()
        windll.user32.GetCursorPos(byref(pt))
        end_x, end_y = pt.x, pt.y
        
        up_x = start_x
        up_y = start_y - drag_distance
        
        self.virtual_mouse.move_to(start_x, start_y)
        abs_x, abs_y = self.absolute_coordinates(start_x, start_y)
        self.send_mouse_event(MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_MOVE, abs_x, abs_y)
        
        self.send_mouse_event(MOUSEEVENTF_LEFTDOWN)
        self.virtual_mouse.press_left()
        
        self.simulate_virtual_move(start_x, start_y, up_x, up_y, drag_duration * 0.3)
        self.simulate_virtual_move(up_x, up_y, end_x, end_y, drag_duration * 0.7)
        
        self.send_mouse_event(MOUSEEVENTF_LEFTUP)
        self.virtual_mouse.release_left()
        
        self.status_text.set(f"完成拖动: {action['name']}")
        return end_x, end_y

    def simulate_virtual_move(self, from_x, from_y, to_x, to_y, duration):
        if duration <= 0:
            return
        
        steps = max(10, int(duration * 30))
        step_delay = duration / steps
        
        dx = (to_x - from_x) / steps
        dy = (to_y - from_y) / steps
        
        for i in range(1, steps + 1):
            current_x = from_x + dx * i
            current_y = from_y + dy * i
            self.virtual_mouse.move_to(current_x, current_y)
            
            abs_x, abs_y = self.absolute_coordinates(current_x, current_y)
            self.send_mouse_event(MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_MOVE, abs_x, abs_y)
            
            time.sleep(step_delay)

    def perform_point_action(self, target_x, target_y, action_name):
        self.virtual_mouse.move_to(target_x, target_y)
        abs_x, abs_y = self.absolute_coordinates(target_x, target_y)
        self.send_mouse_event(MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_MOVE, abs_x, abs_y)
        self.send_mouse_event(MOUSEEVENTF_LEFTDOWN)
        self.virtual_mouse.press_left()
        self.status_text.set(f"按下: {action_name} @ ({target_x}, {target_y})")
    
    def release_point_action(self, original_x, original_y):
        self.send_mouse_event(MOUSEEVENTF_LEFTUP)
        self.virtual_mouse.release_left()
        time.sleep(0.005)
        self.virtual_mouse.move_to(original_x, original_y)
        abs_x, abs_y = self.absolute_coordinates(original_x, original_y)
        self.send_mouse_event(MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_MOVE, abs_x, abs_y)

    def perform_click_action(self, action):
        pt = POINT()
        windll.user32.GetCursorPos(byref(pt))
        x, y = pt.x, pt.y
        
        self.virtual_mouse.move_to(x, y)
        abs_x, abs_y = self.absolute_coordinates(x, y)
        
        self.send_mouse_event(MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_LEFTDOWN, abs_x, abs_y)
        self.virtual_mouse.press_left()
        time.sleep(0.05)
        self.send_mouse_event(MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_LEFTUP, abs_x, abs_y)
        self.virtual_mouse.release_left()

    def toggle_listening(self):
        if self.is_listening:
            self.stop_listening()
        else:
            self.start_listening()

    def start_listening(self):
        if not self.actions:
            messagebox.showwarning("警告", "请先添加宏")
            return
            
        self.exit_key = self.exit_key_entry.get().strip().lower()
        if not self.exit_key:
            messagebox.showerror("错误", "请设置退出键")
            return
            
        self.is_listening = True
        self.listen_btn.config(text="停止游戏")
        self.status_text.set(f"游戏中... 使用快捷键执行宏 (退出键: {self.exit_key})")
        
        self.macro_keys = {action['hotkey'] for action in self.actions}
        
        for key in self.macro_keys:
            keyboard.block_key(key)
            self.blocked_keys.add(key)
        
        self.keyboard_listener = threading.Thread(target=self.listen_keys, daemon=True)
        self.keyboard_listener.start()

    def stop_listening(self):
        self.is_listening = False
        self.listen_btn.config(text="开始游戏")
        self.status_text.set("已停止")
        
        for key in self.blocked_keys:
            keyboard.unblock_key(key)
        self.blocked_keys.clear()

    def listen_keys(self):
        action_states = {action['hotkey']: False for action in self.actions}
        
        while self.is_listening and self.running:
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
            
            if keyboard.is_pressed(self.exit_key):
                self.stop_listening()
                break
            
            time.sleep(0.05)

    def execute_action_loop(self, action):
        hotkey = action['hotkey']
        action_type = action.get('type', '点位')
        
        if action_type == "拖动":
            while self.is_listening and self.running and keyboard.is_pressed(hotkey):
                self.perform_drag_action(action)
                
                interval = float(action.get('loop_interval', 0.05))
                start_time = time.time()
                
                while time.time() - start_time < interval and self.is_listening and self.running:
                    if not keyboard.is_pressed(hotkey):
                        return
                    time.sleep(0.01)
                    
                if keyboard.is_pressed(self.exit_key):
                    self.stop_listening()
                    return
        elif action_type == "连点":
            interval = float(action.get('click_interval', 0.1))
            while self.is_listening and self.running and keyboard.is_pressed(hotkey):
                self.perform_click_action(action)
                
                start_time = time.time()
                while time.time() - start_time < interval and self.is_listening and self.running:
                    if not keyboard.is_pressed(hotkey):
                        return
                    time.sleep(0.01)
        else:
            original_pt = POINT()
            windll.user32.GetCursorPos(byref(original_pt))
            original_x, original_y = original_pt.x, original_pt.y
            
            self.perform_point_action(action['target_x'], action['target_y'], action['name'])
            
            while self.is_listening and self.running and keyboard.is_pressed(hotkey):
                time.sleep(0.01)
            
            self.release_point_action(original_x, original_y)
            self.status_text.set(f"完成: {action['name']}")

    def save_config(self):
        config = {
            "resolution": {
                "width": self.screen_width,
                "height": self.screen_height
            },
            "actions": self.actions,
            "exit_key": self.exit_key
        }
        
        with open(self.config_file, 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        self.status_text.set(f"配置已保存")

    def load_config(self):
        if os.path.exists(self.config_file):
            with open(self.config_file, 'r', encoding='utf-8') as f:
                config = json.load(f)
            
            if "resolution" in config:
                self.screen_width = config["resolution"].get("width", 2500)
                self.screen_height = config["resolution"].get("height", 1600)
                self.virtual_mouse = VirtualMouse(self.screen_width, self.screen_height)
                self.res_combo.set(f"{self.screen_width}x{self.screen_height}")
            
            if "actions" in config:
                self.actions = config["actions"]
                self.action_list.delete(0, tk.END)
                for action in self.actions:
                    self.action_list.insert(tk.END, 
                        f"{action['name']} ({action['hotkey']}) - {action['type']} @ ({action['target_x']}, {action['target_y']})"
                    )
            
            if "exit_key" in config:
                self.exit_key = config["exit_key"]
                self.exit_key_entry.delete(0, tk.END)
                self.exit_key_entry.insert(0, self.exit_key)
            
            self.status_text.set(f"配置已加载")

    def on_close(self):
        self.running = False
        self.is_listening = False
        time.sleep(0.1)
        self.save_config()
        self.root.destroy()
        sys.exit()

def main():
    root = tk.Tk()
    app = BlueArchiveMacro(root)
    root.mainloop()

if __name__ == "__main__":
    main()