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

class HighDPIScaling:
    def __init__(self):
        self.scaling_factor = self.get_system_scaling()
    
    def get_system_scaling(self):
        try:
            user32 = windll.user32
            shcore = windll.shcore
            
            # 获取主显示器的DPI
            user32.SetProcessDPIAware()
            hdc = user32.GetDC(0)
            dpi_x = windll.gdi32.GetDeviceCaps(hdc, 88)  # LOGPIXELSX
            user32.ReleaseDC(0, hdc)
            
            # 计算缩放因子
            scaling_factor = dpi_x / 96.0
            return max(1.0, min(2.5, scaling_factor))  # 限制在1.0-2.5范围内
        except:
            return 1.0  # 默认缩放因子
    
    def scale(self, value):
        return int(value * self.scaling_factor)

class VirtualMouse:
    """虚拟鼠标状态管理"""
    def __init__(self, screen_width, screen_height):
        self.screen_width = screen_width
        self.screen_height = screen_height
        self.x = 0
        self.y = 0
        self.left_pressed = False
    
    def move_to(self, x, y):
        """移动虚拟鼠标位置"""
        self.x = max(0, min(x, self.screen_width))
        self.y = max(0, min(y, self.screen_height))
    
    def press_left(self):
        """按下左键"""
        self.left_pressed = True
    
    def release_left(self):
        """释放左键"""
        self.left_pressed = False

class BlueArchiveMacro:
    def __init__(self, root):
        self.root = root
        self.root.title("碧蓝档案PC宏")
        
        # 初始化DPI缩放
        self.dpi = HighDPIScaling()
        self.root.geometry(f"{self.dpi.scale(750)}x{self.dpi.scale(600)}")
        
        # 设置DPI感知
        try:
            windll.shcore.SetProcessDpiAwareness(1)
        except:
            pass
        
        self.is_listening = False
        self.actions = []
        self.config_file = "blue_archive_macro.json"
        self.screen_width, self.screen_height = self.get_screen_resolution()
        
        # 初始化虚拟鼠标
        self.virtual_mouse = VirtualMouse(self.screen_width, self.screen_height)
        
        self.status_text = tk.StringVar()
        self.status_text.set(f"就绪 - 屏幕分辨率: {self.screen_width}x{self.screen_height}")
        
        self.create_ui()
        self.load_config()
        
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.error_log = "macro_error.log"
        
        keyboard.add_hotkey('s', self.toggle_listening, suppress=True)
        self.running = True

    def get_screen_resolution(self):
        try:
            user32 = windll.user32
            return user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)
        except:
            return 1920, 1080

    def create_ui(self):
        try:
            # 应用缩放因子
            padx = self.dpi.scale(8)
            pady = self.dpi.scale(8)
            entry_width = self.dpi.scale(12)
            button_width = self.dpi.scale(12)
            list_height = self.dpi.scale(15)
            font_size = self.dpi.scale(9)
            
            main_frame = ttk.Frame(self.root)
            main_frame.pack(fill=tk.BOTH, expand=True, padx=padx, pady=pady)
            
            # 分辨率设置区域 - 更简洁
            res_frame = ttk.LabelFrame(main_frame, text="分辨率设置", padding=(padx, pady))
            res_frame.pack(fill=tk.X, padx=padx, pady=pady)
            
            ttk.Label(res_frame, text="分辨率:", font=("", font_size)).grid(
                row=0, column=0, padx=padx, pady=pady, sticky=tk.W)
            
            self.res_combo = ttk.Combobox(res_frame, width=entry_width, font=("", font_size), values=[
                "1920x1080", "2560x1440", "2500x1600", "3840x2160", "自定义"
            ])
            self.res_combo.grid(row=0, column=1, padx=padx, pady=pady)
            self.res_combo.set(f"{self.screen_width}x{self.screen_height}")
            self.res_combo.bind("<<ComboboxSelected>>", self.on_resolution_change)
            
            # 宏配置区域 - 更紧凑
            config_frame = ttk.LabelFrame(main_frame, text="宏配置", padding=(padx, pady))
            config_frame.pack(fill=tk.X, padx=padx, pady=pady)
            
            # 第一行：名称和快捷键
            ttk.Label(config_frame, text="宏名称:", font=("", font_size)).grid(
                row=0, column=0, padx=padx, pady=pady, sticky=tk.W)
            
            self.action_name = ttk.Entry(config_frame, width=entry_width, font=("", font_size))
            self.action_name.grid(row=0, column=1, padx=padx, pady=pady)
            self.action_name.insert(0, "宏1")
            
            ttk.Label(config_frame, text="快捷键:", font=("", font_size)).grid(
                row=0, column=2, padx=padx, pady=pady, sticky=tk.W)
            
            self.hotkey_entry = ttk.Entry(config_frame, width=self.dpi.scale(5), font=("", font_size))
            self.hotkey_entry.grid(row=0, column=3, padx=padx, pady=pady)
            self.hotkey_entry.insert(0, "q")
            
            # 第二行：操作类型和位置
            ttk.Label(config_frame, text="操作类型:", font=("", font_size)).grid(
                row=1, column=0, padx=padx, pady=pady, sticky=tk.W)
            
            self.action_type = ttk.Combobox(config_frame, width=self.dpi.scale(8), font=("", font_size), 
                                           values=["点击", "拖动"])
            self.action_type.grid(row=1, column=1, padx=padx, pady=pady)
            self.action_type.current(0)
            
            ttk.Label(config_frame, text="位置 (X,Y):", font=("", font_size)).grid(
                row=1, column=2, padx=padx, pady=pady, sticky=tk.W)
            
            self.target_x = ttk.Entry(config_frame, width=self.dpi.scale(6), font=("", font_size))
            self.target_x.grid(row=1, column=3, padx=padx, pady=pady)
            
            self.target_y = ttk.Entry(config_frame, width=self.dpi.scale(6), font=("", font_size))
            self.target_y.grid(row=1, column=4, padx=padx, pady=pady)
            
            capture_btn = ttk.Button(config_frame, text="捕获位置", width=button_width, 
                                    command=self.capture_position)
            capture_btn.grid(row=1, column=5, padx=padx, pady=pady)
            
            # 第三行：拖动参数设置
            ttk.Label(config_frame, text="拖动距离:", font=("", font_size)).grid(
                row=2, column=0, padx=padx, pady=pady, sticky=tk.W)
            
            self.up_drag_distance = ttk.Entry(config_frame, width=self.dpi.scale(6), font=("", font_size))
            self.up_drag_distance.grid(row=2, column=1, padx=padx, pady=pady)
            self.up_drag_distance.insert(0, "300")
            
            ttk.Label(config_frame, text="拖动时间 (秒):", font=("", font_size)).grid(
                row=2, column=2, padx=padx, pady=pady, sticky=tk.W)
            
            self.drag_duration = ttk.Entry(config_frame, width=self.dpi.scale(6), font=("", font_size))
            self.drag_duration.grid(row=2, column=3, padx=padx, pady=pady)
            self.drag_duration.insert(0, "0.3")
            
            ttk.Label(config_frame, text="循环间隔 (秒):", font=("", font_size)).grid(
                row=2, column=4, padx=padx, pady=pady, sticky=tk.W)
            
            self.loop_interval = ttk.Entry(config_frame, width=self.dpi.scale(6), font=("", font_size))
            self.loop_interval.grid(row=2, column=5, padx=padx, pady=pady)
            self.loop_interval.insert(0, "0.5")
            
            # 按钮区域
            button_frame = ttk.Frame(config_frame)
            button_frame.grid(row=3, column=0, columnspan=6, pady=pady)
            
            add_btn = ttk.Button(button_frame, text="添加宏", width=button_width, command=self.add_action)
            add_btn.pack(side=tk.LEFT, padx=padx)
            
            test_btn = ttk.Button(button_frame, text="测试宏", width=button_width, command=self.test_action)
            test_btn.pack(side=tk.LEFT, padx=padx)
            
            del_btn = ttk.Button(button_frame, text="删除选中", width=button_width, command=self.delete_selected)
            del_btn.pack(side=tk.RIGHT, padx=padx)
            
            # 宏列表区域
            list_frame = ttk.LabelFrame(main_frame, text="宏列表", padding=(padx, pady))
            list_frame.pack(fill=tk.BOTH, expand=True, padx=padx, pady=pady)
            
            scrollbar = ttk.Scrollbar(list_frame)
            scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
            
            self.action_list = tk.Listbox(list_frame, height=list_height, font=("", font_size), 
                                         yscrollcommand=scrollbar.set)
            self.action_list.pack(fill=tk.BOTH, expand=True)
            scrollbar.config(command=self.action_list.yview)
            
            # 控制按钮区域
            control_frame = ttk.Frame(main_frame)
            control_frame.pack(fill=tk.X, padx=padx, pady=pady)
            
            self.listen_btn = ttk.Button(control_frame, text="开始游戏 (s)", width=button_width, 
                                        command=self.toggle_listening)
            self.listen_btn.pack(side=tk.LEFT, padx=padx)
            
            save_btn = ttk.Button(control_frame, text="保存配置", width=button_width, command=self.save_config)
            save_btn.pack(side=tk.RIGHT, padx=padx)
            
            load_btn = ttk.Button(control_frame, text="加载配置", width=button_width, command=self.load_config)
            load_btn.pack(side=tk.RIGHT, padx=padx)
            
            # 状态栏
            status_frame = ttk.Frame(self.root)
            status_frame.pack(side=tk.BOTTOM, fill=tk.X)
            
            status_label = ttk.Label(status_frame, textvariable=self.status_text, relief=tk.SUNKEN, anchor=tk.W,
                                    font=("", self.dpi.scale(8)))
            status_label.pack(fill=tk.X, side=tk.LEFT)
            
            footer_label = ttk.Label(status_frame, text="真理部", relief=tk.SUNKEN, anchor=tk.E,
                                   font=("", self.dpi.scale(8)))
            footer_label.pack(fill=tk.X, side=tk.RIGHT, expand=True)
        
        except Exception as e:
            messagebox.showerror("初始化错误", f"界面创建失败: {str(e)}")
            self.root.destroy()
            sys.exit(1)

    def on_resolution_change(self, event):
        selected = self.res_combo.get()
        if selected == "自定义":
            self.custom_width.config(state="normal")
            self.custom_height.config(state="normal")
        else:
            self.custom_width.config(state="disabled")
            self.custom_height.config(state="disabled")
            if "x" in selected:
                try:
                    width, height = selected.split("x")
                    self.screen_width = int(width)
                    self.screen_height = int(height)
                    self.virtual_mouse = VirtualMouse(self.screen_width, self.screen_height)
                    self.status_text.set(f"分辨率已设置为: {self.screen_width}x{self.screen_height}")
                except:
                    pass

    def capture_position(self):
        try:
            self.status_text.set("5秒后捕获位置，请将鼠标移动到目标位置...")
            self.root.update()
            time.sleep(5)
            
            pt = POINT()
            if windll.user32.GetCursorPos(byref(pt)):
                self.target_x.delete(0, tk.END)
                self.target_x.insert(0, str(pt.x))
                self.target_y.delete(0, tk.END)
                self.target_y.insert(0, str(pt.y))
                self.status_text.set(f"位置已设置: ({pt.x}, {pt.y})")
            else:
                self.status_text.set("捕获位置失败")
        except:
            self.status_text.set("捕获位置时出错")

    def add_action(self):
        try:
            hotkey = self.hotkey_entry.get().strip().lower()
            action_name = self.action_name.get().strip()
            action_type = self.action_type.get()
            
            if not hotkey:
                messagebox.showerror("错误", "请设置快捷键")
                return
            if not action_name:
                messagebox.showerror("错误", "请设置宏名称")
                return
                
            try:
                target_x = int(self.target_x.get())
                target_y = int(self.target_y.get())
                drag_distance = int(self.up_drag_distance.get())
                drag_duration = float(self.drag_duration.get())
                loop_interval = float(self.loop_interval.get())
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
                "loop_interval": loop_interval
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
        except Exception as e:
            self.status_text.set(f"添加宏失败: {str(e)}")

    def delete_selected(self):
        try:
            selection = self.action_list.curselection()
            if not selection:
                return
                
            index = selection[0]
            action_name = self.actions[index]['name']
            self.actions.pop(index)
            self.action_list.delete(index)
            self.status_text.set(f"已删除宏: {action_name}")
        except:
            pass

    def test_action(self):
        try:
            try:
                target_x = int(self.target_x.get())
                target_y = int(self.target_y.get())
                drag_distance = int(self.up_drag_distance.get())
                drag_duration = float(self.drag_duration.get())
            except:
                messagebox.showerror("错误", "请输入有效数字")
                return
            
            action_name = self.action_name.get() or "测试宏"
            action_type = self.action_type.get()
            
            action = {
                "name": action_name,
                "type": action_type,
                "target_x": target_x,
                "target_y": target_y,
                "drag_distance": drag_distance,
                "drag_duration": drag_duration
            }
            
            self.status_text.set(f"测试中: {action_name}...")
            self.root.update()
            
            threading.Thread(target=self.perform_action, args=(action,), daemon=True).start()
        except:
            self.status_text.set("测试宏时出错")

    def absolute_coordinates(self, x, y):
        try:
            abs_x = int((x * 65535) / self.screen_width)
            abs_y = int((y * 65535) / self.screen_height)
            return abs_x, abs_y
        except:
            return x, y

    def send_mouse_event(self, flags, dx=0, dy=0, data=0):
        """发送鼠标事件但不移动实际光标"""
        mi = MOUSEINPUT(dx, dy, data, flags, 0, None)
        input_struct = INPUT()
        input_struct.type = INPUT_MOUSE
        input_struct.mi = mi
        windll.user32.SendInput(1, byref(input_struct), sizeof(input_struct))

    def simulate_virtual_drag(self, start_x, start_y, drag_distance, drag_duration):
        """虚拟鼠标拖动操作（不移动实际光标）"""
        try:
            # 1. 获取当前实际光标位置（拖动终点）
            pt = POINT()
            if not windll.user32.GetCursorPos(byref(pt)):
                self.status_text.set("获取光标位置失败")
                return
            end_x, end_y = pt.x, pt.y
            
            # 2. 计算向上拖动后的位置
            up_x = start_x
            up_y = start_y - drag_distance
            
            # 3. 设置虚拟鼠标位置
            self.virtual_mouse.move_to(start_x, start_y)
            
            # 4. 在目标位置按下鼠标（虚拟）
            self.send_mouse_event(MOUSEEVENTF_LEFTDOWN)
            self.virtual_mouse.press_left()
            
            # 5. 向上拖动指定距离（虚拟）
            self.simulate_virtual_move(start_x, start_y, up_x, up_y, drag_duration * 0.3)
            
            # 6. 拖动到实际光标位置（虚拟）
            self.simulate_virtual_move(up_x, up_y, end_x, end_y, drag_duration * 0.7)
            
            # 7. 释放鼠标（虚拟）
            self.send_mouse_event(MOUSEEVENTF_LEFTUP)
            self.virtual_mouse.release_left()
            
            return end_x, end_y
        except Exception as e:
            self.status_text.set(f"虚拟拖动失败: {str(e)}")
            return start_x, start_y

    def simulate_virtual_move(self, from_x, from_y, to_x, to_y, duration):
        """虚拟鼠标平滑移动（不移动实际光标）"""
        if duration <= 0:
            return
        
        steps = max(10, int(duration * 30))  # 每0.033秒一步
        step_delay = duration / steps
        
        # 计算每一步的移动量
        dx = (to_x - from_x) / steps
        dy = (to_y - from_y) / steps
        
        for i in range(1, steps + 1):
            # 更新虚拟鼠标位置
            current_x = from_x + dx * i
            current_y = from_y + dy * i
            self.virtual_mouse.move_to(current_x, current_y)
            
            # 发送移动事件（使用绝对坐标）
            abs_x, abs_y = self.absolute_coordinates(current_x, current_y)
            self.send_mouse_event(MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_MOVE, abs_x, abs_y)
            
            time.sleep(step_delay)

    def simulate_virtual_click(self, x, y):
        """虚拟鼠标点击（不移动实际光标）"""
        try:
            # 设置虚拟鼠标位置
            self.virtual_mouse.move_to(x, y)
            
            # 发送绝对坐标点击事件
            abs_x, abs_y = self.absolute_coordinates(x, y)
            
            # 按下
            self.send_mouse_event(MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_LEFTDOWN, abs_x, abs_y)
            self.virtual_mouse.press_left()
            time.sleep(0.1)
            
            # 释放
            self.send_mouse_event(MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_LEFTUP, abs_x, abs_y)
            self.virtual_mouse.release_left()
        except Exception as e:
            self.status_text.set(f"虚拟点击失败: {str(e)}")

    def perform_action(self, action):
        try:
            target_x = action['target_x']
            target_y = action['target_y']
            action_type = action.get('type', '点击')
            drag_distance = action.get('drag_distance', 300)
            drag_duration = action.get('drag_duration', 0.3)
            
            if action_type == "拖动":
                end_x, end_y = self.simulate_virtual_drag(target_x, target_y, drag_distance, drag_duration)
                action_desc = f"从 ({target_x}, {target_y}) 拖动到 ({end_x}, {end_y})"
            else:
                self.simulate_virtual_click(target_x, target_y)
                action_desc = f"点击 ({target_x}, {target_y})"
            
            self.status_text.set(f"完成: {action['name']} ({action_desc})")
        except Exception as e:
            self.status_text.set(f"执行失败: {str(e)}")

    def toggle_listening(self):
        try:
            if self.is_listening:
                self.stop_listening()
            else:
                self.start_listening()
        except:
            self.status_text.set("切换监听状态失败")

    def start_listening(self):
        try:
            if not self.actions:
                messagebox.showwarning("警告", "请先添加宏")
                return
                
            self.is_listening = True
            self.listen_btn.config(text="停止游戏 (s)")
            self.status_text.set("游戏中... 使用快捷键执行宏")
            
            self.keyboard_listener = threading.Thread(target=self.listen_keys, daemon=True)
            self.keyboard_listener.start()
        except:
            self.status_text.set("启动监听失败")

    def stop_listening(self):
        try:
            self.is_listening = False
            self.listen_btn.config(text="开始游戏 (s)")
            self.status_text.set("已停止")
        except:
            pass

    def listen_keys(self):
        try:
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
                
                time.sleep(0.05)
        except Exception as e:
            self.status_text.set(f"监听键盘失败: {str(e)}")
            self.stop_listening()

    def execute_action_loop(self, action):
        try:
            hotkey = action['hotkey']
            
            while self.is_listening and self.running and keyboard.is_pressed(hotkey):
                self.perform_action(action)
                
                interval = float(action['loop_interval'])
                start_time = time.time()
                
                while time.time() - start_time < interval and self.is_listening and self.running:
                    if not keyboard.is_pressed(hotkey):
                        return
                    time.sleep(0.05)
        except:
            pass

    def save_config(self):
        try:
            config = {
                "resolution": {
                    "width": self.screen_width,
                    "height": self.screen_height
                },
                "actions": self.actions
            }
            
            with open(self.config_file, 'w', encoding='utf-8') as f:
                json.dump(config, f, indent=2, ensure_ascii=False)
            self.status_text.set(f"配置已保存")
        except Exception as e:
            self.status_text.set(f"保存配置失败: {str(e)}")

    def load_config(self):
        try:
            if os.path.exists(self.config_file):
                with open(self.config_file, 'r', encoding='utf-8') as f:
                    config = json.load(f)
                
                if "resolution" in config:
                    self.screen_width = config["resolution"].get("width", 1920)
                    self.screen_height = config["resolution"].get("height", 1080)
                    self.virtual_mouse = VirtualMouse(self.screen_width, self.screen_height)
                    self.res_combo.set(f"{self.screen_width}x{self.screen_height}")
                
                if "actions" in config:
                    self.actions = config["actions"]
                    self.action_list.delete(0, tk.END)
                    for action in self.actions:
                        self.action_list.insert(tk.END, 
                            f"{action['name']} ({action['hotkey']}) - {action['type']} @ ({action['target_x']}, {action['target_y']})"
                        )
                
                self.status_text.set(f"配置已加载")
        except Exception as e:
            self.status_text.set(f"加载配置失败: {str(e)}")

    def on_close(self):
        try:
            self.running = False
            self.is_listening = False
            time.sleep(0.2)  # 给线程一点时间退出
            self.save_config()
            self.root.destroy()
        except:
            pass
        sys.exit()

def main():
    try:
        def excepthook(exc_type, exc_value, exc_traceback):
            error_msg = ''.join(traceback.format_exception(exc_type, exc_value, exc_traceback))
            with open("macro_error.log", "w") as f:
                f.write(f"程序崩溃:\n{error_msg}")
            messagebox.showerror("严重错误", "程序发生致命错误，详情见日志文件")
        
        sys.excepthook = excepthook
        
        root = tk.Tk()
        app = BlueArchiveMacro(root)
        root.mainloop()
    except Exception as e:
        with open("macro_crash.log", "w") as f:
            f.write(f"启动崩溃:\n{str(e)}\n\n{traceback.format_exc()}")
        messagebox.showerror("启动失败", f"程序启动失败: {str(e)}")

if __name__ == "__main__":
    main()