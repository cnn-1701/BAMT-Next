import tkinter as tk
from tkinter import ttk, messagebox, simpledialog
import keyboard
import time
import threading
import sys
import os
import json
import traceback
from ctypes import windll, Structure, c_ulong, POINTER, c_uint, c_long, c_int, sizeof, byref

# 定义Windows API结构
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

# 常量定义
INPUT_MOUSE = 0
MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_ABSOLUTE = 0x8000

class AdvancedMouseController:
    def __init__(self, root):
        self.root = root
        self.root.title("鼠标操作控制器")
        self.root.geometry("700x550")
        
        # 初始化变量
        self.is_listening = False
        self.listening_thread = None
        self.actions = []
        self.config_file = "mouse_controller_config.json"
        self.screen_width, self.screen_height = self.get_screen_resolution()
        
        # 创建状态变量
        self.status_text = tk.StringVar()
        self.status_text.set(f"就绪 - 屏幕分辨率: {self.screen_width}x{self.screen_height}")
        
        # 创建主界面
        self.create_ui()
        
        # 加载配置
        self.load_config()
        
        # 设置关闭窗口时的清理操作
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)
        
        # 错误日志
        self.error_log = "mouse_controller_error.log"
        if os.path.exists(self.error_log):
            os.remove(self.error_log)

    def get_screen_resolution(self):
        """获取屏幕分辨率"""
        user32 = windll.user32
        return user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)

    def create_ui(self):
        """创建用户界面"""
        try:
            # 主框架
            main_frame = ttk.Frame(self.root)
            main_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)
            
            # 分辨率设置区域
            res_frame = ttk.LabelFrame(main_frame, text="屏幕分辨率设置")
            res_frame.pack(fill=tk.X, padx=5, pady=5)
            
            # 常用分辨率
            ttk.Label(res_frame, text="常用分辨率:").grid(row=0, column=0, padx=5, pady=5, sticky=tk.W)
            self.res_combo = ttk.Combobox(res_frame, width=15, values=[
                "1920x1080", "2560x1440", "2500x1600", "3840x2160", "自定义"
            ])
            self.res_combo.grid(row=0, column=1, padx=5, pady=5)
            self.res_combo.set(f"{self.screen_width}x{self.screen_height}")
            self.res_combo.bind("<<ComboboxSelected>>", self.on_resolution_change)
            
            # 自定义分辨率
            ttk.Label(res_frame, text="自定义分辨率:").grid(row=0, column=2, padx=5, pady=5, sticky=tk.W)
            self.custom_width = ttk.Entry(res_frame, width=8)
            self.custom_width.grid(row=0, column=3, padx=5, pady=5)
            self.custom_width.insert(0, str(self.screen_width))
            self.custom_height = ttk.Entry(res_frame, width=8)
            self.custom_height.grid(row=0, column=4, padx=5, pady=5)
            self.custom_height.insert(0, str(self.screen_height))
            
            # 操作配置区域
            config_frame = ttk.LabelFrame(main_frame, text="添加/编辑操作")
            config_frame.pack(fill=tk.X, padx=5, pady=5)
            
            # 操作名称
            ttk.Label(config_frame, text="操作名称:").grid(row=0, column=0, padx=5, pady=5, sticky=tk.W)
            self.action_name = ttk.Entry(config_frame, width=15)
            self.action_name.grid(row=0, column=1, padx=5, pady=5)
            self.action_name.insert(0, "操作1")
            
            # 快捷键
            ttk.Label(config_frame, text="快捷键:").grid(row=0, column=2, padx=5, pady=5, sticky=tk.W)
            self.hotkey_entry = ttk.Entry(config_frame, width=8)
            self.hotkey_entry.grid(row=0, column=3, padx=5, pady=5)
            self.hotkey_entry.insert(0, "F2")
            
            # 操作类型 (只保留点击和拖动)
            ttk.Label(config_frame, text="操作类型:").grid(row=1, column=0, padx=5, pady=5, sticky=tk.W)
            self.action_type = ttk.Combobox(config_frame, width=10, values=["点击", "拖动"])
            self.action_type.grid(row=1, column=1, padx=5, pady=5)
            self.action_type.current(0)  # 默认选择点击
            
            # 目标位置
            ttk.Label(config_frame, text="目标位置 (X,Y):").grid(row=1, column=2, padx=5, pady=5, sticky=tk.W)
            self.target_x = ttk.Entry(config_frame, width=8)
            self.target_x.grid(row=1, column=3, padx=5, pady=5)
            self.target_y = ttk.Entry(config_frame, width=8)
            self.target_y.grid(row=1, column=4, padx=5, pady=5)
            ttk.Button(config_frame, text="捕获位置", command=self.capture_position).grid(row=1, column=5, padx=5, pady=5)
            
            # 拖动时间
            ttk.Label(config_frame, text="拖动时间 (秒):").grid(row=2, column=0, padx=5, pady=5, sticky=tk.W)
            self.drag_duration = ttk.Entry(config_frame, width=8)
            self.drag_duration.grid(row=2, column=1, padx=5, pady=5)
            self.drag_duration.insert(0, "0.3")
            
            # 循环间隔
            ttk.Label(config_frame, text="循环间隔 (秒):").grid(row=2, column=2, padx=5, pady=5, sticky=tk.W)
            self.loop_interval = ttk.Entry(config_frame, width=8)
            self.loop_interval.grid(row=2, column=3, padx=5, pady=5)
            self.loop_interval.insert(0, "0.5")
            
            # 操作按钮
            button_frame = ttk.Frame(config_frame)
            button_frame.grid(row=3, column=0, columnspan=6, pady=5)
            ttk.Button(button_frame, text="添加操作", command=self.add_action).pack(side=tk.LEFT, padx=5)
            ttk.Button(button_frame, text="测试操作", command=self.test_action).pack(side=tk.LEFT, padx=5)
            ttk.Button(button_frame, text="删除选中", command=self.delete_selected).pack(side=tk.RIGHT, padx=5)
            
            # 操作列表区域
            list_frame = ttk.LabelFrame(main_frame, text="操作列表")
            list_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
            
            # 创建滚动条
            scrollbar = ttk.Scrollbar(list_frame)
            scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
            
            # 创建列表
            self.action_list = tk.Listbox(list_frame, height=10, yscrollcommand=scrollbar.set)
            self.action_list.pack(fill=tk.BOTH, expand=True)
            scrollbar.config(command=self.action_list.yview)
            
            # 控制按钮区域
            control_frame = ttk.Frame(main_frame)
            control_frame.pack(fill=tk.X, padx=5, pady=5)
            
            self.listen_btn = ttk.Button(control_frame, text="启动监听 (F1)", command=self.toggle_listening)
            self.listen_btn.pack(side=tk.LEFT, padx=5)
            
            ttk.Button(control_frame, text="保存配置", command=self.save_config).pack(side=tk.RIGHT, padx=5)
            ttk.Button(control_frame, text="加载配置", command=self.load_config).pack(side=tk.RIGHT, padx=5)
            
            # 状态栏
            status_frame = ttk.Frame(self.root)
            status_frame.pack(side=tk.BOTTOM, fill=tk.X)
            ttk.Label(status_frame, textvariable=self.status_text, relief=tk.SUNKEN, anchor=tk.W).pack(fill=tk.X)
        
        except Exception as e:
            self.log_error(f"创建界面错误: {str(e)}")
            messagebox.showerror("初始化错误", f"创建界面时发生错误:\n{str(e)}")
            sys.exit(1)

    def on_resolution_change(self, event):
        """分辨率选择变化事件"""
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
                self.status_text.set(f"分辨率已设置为: {self.screen_width}x{self.screen_height}")

    def set_resolution(self):
        """设置自定义分辨率"""
        try:
            width = int(self.custom_width.get())
            height = int(self.custom_height.get())
            self.screen_width = width
            self.screen_height = height
            self.res_combo.set("自定义")
            self.status_text.set(f"分辨率已设置为: {width}x{height}")
        except ValueError:
            messagebox.showerror("错误", "请输入有效的分辨率")

    def capture_position(self):
        """捕获鼠标位置"""
        try:
            self.status_text.set("5秒后捕获位置，请将鼠标移动到目标位置...")
            self.root.update()
            time.sleep(5)
            
            # 获取鼠标位置
            pt = POINT()
            windll.user32.GetCursorPos(byref(pt))
            
            self.target_x.delete(0, tk.END)
            self.target_x.insert(0, str(pt.x))
            self.target_y.delete(0, tk.END)
            self.target_y.insert(0, str(pt.y))
            self.status_text.set(f"已设置目标位置: ({pt.x}, {pt.y})")
        except Exception as e:
            self.log_error(f"捕获位置错误: {str(e)}")

    def add_action(self):
        """添加新操作"""
        try:
            # 获取输入值
            hotkey = self.hotkey_entry.get().strip().lower()
            action_name = self.action_name.get().strip()
            action_type = self.action_type.get()
            
            # 验证输入
            if not hotkey:
                messagebox.showerror("错误", "请设置快捷键")
                return
                
            if not action_name:
                messagebox.showerror("错误", "请设置操作名称")
                return
                
            try:
                target_x = int(self.target_x.get())
                target_y = int(self.target_y.get())
                drag_duration = float(self.drag_duration.get())
                loop_interval = float(self.loop_interval.get())
            except ValueError:
                messagebox.showerror("错误", "请输入有效的数字")
                return
            
            # 检查快捷键是否已存在
            for action in self.actions:
                if action['hotkey'] == hotkey:
                    messagebox.showerror("错误", f"快捷键 {hotkey} 已被 '{action['name']}' 使用")
                    return
            
            # 创建操作字典
            action = {
                "name": action_name,
                "hotkey": hotkey,
                "type": action_type,
                "target_x": target_x,
                "target_y": target_y,
                "drag_duration": drag_duration,
                "loop_interval": loop_interval
            }
            
            # 添加到操作列表
            self.actions.append(action)
            self.action_list.insert(tk.END, f"{action_name} ({hotkey}) - {action_type} @ ({target_x}, {target_y})")
            self.status_text.set(f"已添加操作: {action_name} (快捷键: {hotkey})")
            
            # 清空输入框
            self.action_name.delete(0, tk.END)
            self.action_name.insert(0, f"操作{len(self.actions)+1}")
            self.hotkey_entry.delete(0, tk.END)
            self.hotkey_entry.insert(0, f"F{len(self.actions)+2}")
        except Exception as e:
            self.log_error(f"添加操作错误: {str(e)}")

    def delete_selected(self):
        """删除选中的操作"""
        try:
            selection = self.action_list.curselection()
            if not selection:
                messagebox.showinfo("提示", "请选择要删除的操作")
                return
                
            index = selection[0]
            action_name = self.actions[index]['name']
            self.actions.pop(index)
            self.action_list.delete(index)
            self.status_text.set(f"已删除操作: {action_name}")
        except Exception as e:
            self.log_error(f"删除操作错误: {str(e)}")

    def test_action(self):
        """测试当前配置的操作"""
        try:
            # 创建临时操作配置
            try:
                target_x = int(self.target_x.get())
                target_y = int(self.target_y.get())
                drag_duration = float(self.drag_duration.get())
            except ValueError:
                messagebox.showerror("错误", "请输入有效的数字")
                return
            
            action_name = self.action_name.get() or "测试操作"
            action_type = self.action_type.get()
            
            action = {
                "name": action_name,
                "type": action_type,
                "target_x": target_x,
                "target_y": target_y,
                "drag_duration": drag_duration
            }
            
            # 执行测试
            self.status_text.set(f"正在测试操作: {action_name}...")
            self.root.update()
            
            # 在新线程中执行测试
            threading.Thread(target=self.perform_action, args=(action,), daemon=True).start()
        except Exception as e:
            self.log_error(f"测试操作错误: {str(e)}")

    def absolute_coordinates(self, x, y):
        """将屏幕坐标转换为绝对坐标 (0-65535)"""
        abs_x = int((x * 65535) / self.screen_width)
        abs_y = int((y * 65535) / self.screen_height)
        return abs_x, abs_y

    def simulate_mouse_move(self, x, y):
        """模拟鼠标移动到指定位置 (不移动实际光标)"""
        abs_x, abs_y = self.absolute_coordinates(x, y)
        
        # 创建输入结构
        move_input = INPUT()
        move_input.type = INPUT_MOUSE
        move_input.mi.dx = abs_x
        move_input.mi.dy = abs_y
        move_input.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE
        
        # 发送输入
        windll.user32.SendInput(1, byref(move_input), sizeof(move_input))

    def simulate_mouse_click(self, x, y):
        """模拟鼠标左键点击"""
        abs_x, abs_y = self.absolute_coordinates(x, y)
        
        # 移动到位置
        move_input = INPUT()
        move_input.type = INPUT_MOUSE
        move_input.mi.dx = abs_x
        move_input.mi.dy = abs_y
        move_input.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE
        windll.user32.SendInput(1, byref(move_input), sizeof(move_input))
        
        # 按下按钮
        down_input = INPUT()
        down_input.type = INPUT_MOUSE
        down_input.mi.dwFlags = MOUSEEVENTF_LEFTDOWN
        windll.user32.SendInput(1, byref(down_input), sizeof(down_input))
        
        # 释放按钮
        up_input = INPUT()
        up_input.type = INPUT_MOUSE
        up_input.mi.dwFlags = MOUSEEVENTF_LEFTUP
        windll.user32.SendInput(1, byref(up_input), sizeof(up_input))

    def simulate_drag(self, start_x, start_y, end_x, end_y, duration):
        """模拟从起点拖动到终点"""
        # 移动到起始位置
        self.simulate_mouse_move(start_x, start_y)
        
        # 按下鼠标左键
        down_input = INPUT()
        down_input.type = INPUT_MOUSE
        down_input.mi.dwFlags = MOUSEEVENTF_LEFTDOWN
        windll.user32.SendInput(1, byref(down_input), sizeof(down_input))
        
        # 计算步数
        steps = max(10, int(duration * 100))
        step_delay = duration / steps
        
        # 平滑移动到终点
        for i in range(1, steps + 1):
            # 计算当前插值位置
            current_x = start_x + (end_x - start_x) * i / steps
            current_y = start_y + (end_y - start_y) * i / steps
            
            # 移动到当前位置
            self.simulate_mouse_move(current_x, current_y)
            time.sleep(step_delay)
        
        # 释放鼠标左键
        up_input = INPUT()
        up_input.type = INPUT_MOUSE
        up_input.mi.dwFlags = MOUSEEVENTF_LEFTUP
        windll.user32.SendInput(1, byref(up_input), sizeof(up_input))

    def perform_action(self, action):
        """执行鼠标操作"""
        try:
            # 获取设置的值
            target_x = action['target_x']
            target_y = action['target_y']
            action_type = action.get('type', '点击')
            drag_duration = action.get('drag_duration', 0.3)
            
            # 获取当前实际光标位置作为拖动终点
            pt = POINT()
            windll.user32.GetCursorPos(byref(pt))
            end_x, end_y = pt.x, pt.y
            
            # 执行操作
            if action_type == "拖动":
                # 先点击目标位置，然后拖动到当前鼠标位置
                self.simulate_mouse_click(target_x, target_y)
                time.sleep(0.1)
                self.simulate_drag(target_x, target_y, end_x, end_y, drag_duration)
                action_desc = f"从 ({target_x}, {target_y}) 拖动到 ({end_x}, {end_y})"
            else:  # 点击操作
                self.simulate_mouse_click(target_x, target_y)
                action_desc = f"点击 ({target_x}, {target_y})"
            
            self.status_text.set(f"完成操作: {action['name']} ({action_desc})")
        except Exception as e:
            self.status_text.set(f"错误: {str(e)}")
            self.log_error(f"执行操作错误: {str(e)}")

    def toggle_listening(self):
        """切换监听状态"""
        try:
            if self.is_listening:
                self.stop_listening()
            else:
                self.start_listening()
        except Exception as e:
            self.log_error(f"切换监听状态错误: {str(e)}")

    def start_listening(self):
        """开始监听键盘快捷键"""
        try:
            if not self.actions:
                messagebox.showwarning("警告", "请先添加至少一个操作")
                return
                
            self.is_listening = True
            self.listen_btn.config(text="停止监听 (F1)")
            self.status_text.set("监听中... 使用快捷键进行操作")
            
            # 在新线程中监听键盘
            threading.Thread(target=self.listen_keys, daemon=True).start()
        except Exception as e:
            self.log_error(f"启动监听错误: {str(e)}")

    def stop_listening(self):
        """停止监听"""
        try:
            self.is_listening = False
            self.listen_btn.config(text="启动监听 (F1)")
            self.status_text.set("已停止监听")
        except Exception as e:
            self.log_error(f"停止监听错误: {str(e)}")

    def listen_keys(self):
        """监听键盘快捷键"""
        try:
            # 创建操作状态字典
            action_states = {action['hotkey']: False for action in self.actions}
            
            while self.is_listening:
                for i, action in enumerate(self.actions):
                    hotkey = action['hotkey']
                    
                    if keyboard.is_pressed(hotkey):
                        if not action_states[hotkey]:
                            # 按键刚按下，开始循环执行
                            action_states[hotkey] = True
                            threading.Thread(
                                target=self.execute_action_loop, 
                                args=(action,),
                                daemon=True
                            ).start()
                    else:
                        action_states[hotkey] = False
                
                time.sleep(0.05)  # 降低CPU使用率
        except Exception as e:
            self.log_error(f"监听键盘错误: {str(e)}")
            self.stop_listening()

    def execute_action_loop(self, action):
        """循环执行指定操作"""
        try:
            hotkey = action['hotkey']
            
            while self.is_listening and keyboard.is_pressed(hotkey):
                # 执行操作
                self.perform_action(action)
                
                # 等待循环间隔时间
                interval = float(action['loop_interval'])
                start_time = time.time()
                
                # 在等待间隔期间持续检查按键状态
                while time.time() - start_time < interval:
                    if not keyboard.is_pressed(hotkey) or not self.is_listening:
                        return
                    time.sleep(0.05)
        except Exception as e:
            self.log_error(f"执行操作循环错误: {str(e)}")

    def save_config(self):
        """保存配置到文件"""
        try:
            # 保存分辨率设置
            config = {
                "resolution": {
                    "width": self.screen_width,
                    "height": self.screen_height
                },
                "actions": self.actions
            }
            
            with open(self.config_file, 'w') as f:
                json.dump(config, f, indent=4)
            self.status_text.set(f"配置已保存到: {self.config_file}")
        except Exception as e:
            messagebox.showerror("保存错误", f"无法保存配置: {str(e)}")
            self.log_error(f"保存配置错误: {str(e)}")

    def load_config(self):
        """从文件加载配置"""
        try:
            if not os.path.exists(self.config_file):
                self.status_text.set("找不到配置文件")
                return
                
            with open(self.config_file, 'r') as f:
                config = json.load(f)
            
            # 加载分辨率
            if "resolution" in config:
                self.screen_width = config["resolution"]["width"]
                self.screen_height = config["resolution"]["height"]
                self.res_combo.set(f"{self.screen_width}x{self.screen_height}")
                self.status_text.set(f"分辨率已设置为: {self.screen_width}x{self.screen_height}")
            
            # 加载操作
            if "actions" in config:
                self.actions = config["actions"]
                self.action_list.delete(0, tk.END)
                for action in self.actions:
                    self.action_list.insert(tk.END, 
                        f"{action['name']} ({action['hotkey']}) - {action['type']} @ ({action['target_x']}, {action['target_y']})"
                    )
            
            self.status_text.set(f"已加载配置: {self.config_file}")
        except Exception as e:
            messagebox.showerror("加载错误", f"无法加载配置: {str(e)}")
            self.log_error(f"加载配置错误: {str(e)}")

    def log_error(self, message):
        """记录错误到日志文件"""
        try:
            with open(self.error_log, "a") as f:
                f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}\n")
        except:
            pass

    def on_close(self):
        """关闭窗口时的清理操作"""
        try:
            self.is_listening = False
            self.save_config()
            self.root.destroy()
            sys.exit()
        except:
            os._exit(0)

# 创建主窗口
if __name__ == "__main__":
    try:
        # 尝试设置DPI感知
        try:
            from ctypes import windll
            windll.shcore.SetProcessDpiAwareness(1)
        except:
            pass
        
        root = tk.Tk()
        app = AdvancedMouseController(root)
        root.mainloop()
    except Exception as e:
        # 创建错误日志文件
        with open("mouse_crash.log", "w") as f:
            f.write(f"崩溃时间: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"错误类型: {type(e).__name__}\n")
            f.write(f"错误信息: {str(e)}\n")
            f.write("\n堆栈跟踪:\n")
            traceback.print_exc(file=f)
        
        # 显示错误信息
        messagebox.showerror("程序崩溃", f"程序启动时发生严重错误:\n{str(e)}\n\n详细信息已保存到日志文件")