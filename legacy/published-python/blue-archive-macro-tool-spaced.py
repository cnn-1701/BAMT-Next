# 小钩晴的技术笔记
# 项目：碧蓝档案PC版作战辅助工具
#
# 老师您好...这是给碧蓝档案PC版开发的总力战卷分工具。
# 主要功能：
#   - 点击屏幕固定位置：在按下键盘的预设键后宏点击固定预设点位，松开键盘后鼠标释放并复位
#   - 拖动操作：按下预设按键后循环释放ex技能至鼠标光标位置
#   - 自动连点：按下后持续点击光标位置
#
# 分辨率自适应已经做好了，但如果老师用超宽屏显示器...
# 可能需要额外调整参数（可以随时找我帮忙）
#
# （凌晨3点备注：能量饮料库存告急，明天记得补货...）
# UID:1340343294


import tkinter as tk
from tkinter import ttk, messagebox
import keyboard  # 热键监听库（各务前辈推荐的）
import time
import threading
import sys
import os
import json
from ctypes import windll, Structure, c_ulong, POINTER, c_uint, c_long, c_int, sizeof, byref
import logging  # 真理部要求的错误记录模块

# 配置日志（各务前辈说故障诊断很重要）
logging.basicConfig(filename='macro_errors.log', level=logging.INFO, 
                    format='%(asctime)s - %(message)s')

class POINT(Structure):
    # Windows标准坐标结构（这个API用了十年没变过...）
    _fields_ = [("x", c_long), ("y", c_long)]

class MOUSEINPUT(Structure):
    # 鼠标输入结构体（系统级定义）
    _fields_ = [
        ("dx", c_long),          # X轴偏移
        ("dy", c_long),          # Y轴偏移
        ("mouseData", c_ulong),  # 滚轮值
        ("dwFlags", c_ulong),    # 动作标志
        ("time", c_ulong),       # 时间戳
        ("dwExtraInfo", POINTER(c_ulong))  # 扩展信息
    ]

class INPUT(Structure):
    # 输入事件封装（为了SendInput API）
    class _INPUT(Structure):
        _fields_ = [("mi", MOUSEINPUT)]
    _anonymous_ = ("_input",)
    _fields_ = [("type", c_uint), ("_input", _INPUT)]

# 鼠标事件常量（真理部标准操作码）
INPUT_MOUSE = 0
MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_ABSOLUTE = 0x8000

class BlueArchiveMacro:
    """碧蓝档案PC版作战辅助主程序"""
    
    def __init__(self, root):
        # 主窗口设置（尺寸参考千禧年UI规范v2）
        self.root = root
        self.root.title("BA战术辅助 v1.3")  
        
        # Windows高DPI处理（这个API在旧系统容易崩溃）
        try:
            windll.shcore.SetProcessDpiAwareness(1)
        except Exception as e:
            logging.warning(f"DPI设置失败: {str(e)}")
        
        # 显示缩放系数
        self.scaling_factor = self.get_scaling()
        self.root.geometry(f"{int(900 * self.scaling_factor)}x{int(700 * self.scaling_factor)}")
        
        # 运行状态变量
        self.is_listening = False  # 宏键监听状态
        self.actions = []          # 存储所有宏动作
        self.config_file = "blue_archive_config.json"  # 真理部标准配置文件
        self.screen_width, self.screen_height = self.get_resolution()
        self.exit_key = 's'        # 游戏结束键
        self.macro_keys = set()     # 已注册宏键
        self.blocked_keys = set()   # 已屏蔽宏键位
        
        # 鼠标状态跟踪
        self.x = 0
        self.y = 0
        self.left_pressed = False
        
        # 状态栏提示
        self.status_text = tk.StringVar()
        self.status_text.set(f"就绪 | 当前分辨率: {self.screen_width}x{self.screen_height}")
        
        try:
            # 初始化界面 - 自定设定这一块
            self.setup_ui()
            
            # 加载配置（真理部要求长期设置）
            self.load_cfg()
        except Exception as e:
            logging.error(f"初始化失败: {str(e)}")
            messagebox.showerror("致命错误", f"初始化失败: {str(e)}")
            self.root.destroy()
            return
        
        # 关闭事件处理
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.running = True
        self.thread_lock = threading.Lock()  # 线程安全锁

    def get_resolution(self):
        """获取当前屏幕分辨率（兼容多显示器）"""
        user32 = windll.user32
        return user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)

    def get_scaling(self):
        """计算系统缩放比例（高分辨率屏适配）"""
        try:
            windll.user32.SetProcessDPIAware()
        except Exception:
            pass  # 旧系统回退方案
        hdc = windll.user32.GetDC(0)
        dpi_x = windll.gdi32.GetDeviceCaps(hdc, 88)  # LOGPIXELSX
        windll.user32.ReleaseDC(0, hdc)
        return max(1.0, min(2.5, dpi_x / 96.0))  # 限制在100%-250%之间

    def setup_ui(self):
        """初始化用户界面（真理部标准布局）"""
        try:
            padx = int(10 * self.scaling_factor)
            pady = int(8 * self.scaling_factor)
            button_width = 15
            list_height = 15
            font_size = int(14 * self.scaling_factor)
            
            # 样式设置（千禧年UI指南）
            style = ttk.Style()
            style.configure(".", font=("Segoe UI", font_size))
            
            # 通用字体配置
            entry_font = ("Segoe UI", font_size)
            combobox_font = ("Segoe UI", font_size)
            
            # 主框架
            main_frame = ttk.Frame(self.root)
            main_frame.pack(fill=tk.BOTH, expand=True, padx=padx, pady=pady)
            
            # 控制按钮区域
            control_frame = ttk.Frame(main_frame)
            control_frame.pack(fill=tk.X, padx=padx, pady=pady)
            
            # 添加信件按钮到右上角
            letter_btn = ttk.Button(control_frame, text="来自晴的一封信", 
                                   command=self.show_letter, width=15)
            letter_btn.pack(side=tk.RIGHT, padx=padx)
            
            self.listen_btn = ttk.Button(control_frame, text="开始作战", width=button_width, 
                                        command=self.toggle_listen)
            self.listen_btn.pack(side=tk.LEFT, padx=padx)
            
            ttk.Label(control_frame, text="退出键:").pack(side=tk.LEFT, padx=padx)
            self.exit_key_entry = ttk.Entry(control_frame, width=5, font=entry_font)
            self.exit_key_entry.pack(side=tk.LEFT, padx=padx)
            self.exit_key_entry.insert(0, "s")
            
            # 保存/加载按钮（已加载真理部数据安全协议）
            save_btn = ttk.Button(control_frame, text="保存配置", width=button_width, command=self.save_cfg)
            save_btn.pack(side=tk.RIGHT, padx=padx)
            load_btn = ttk.Button(control_frame, text="加载配置", width=button_width, command=self.load_cfg)
            load_btn.pack(side=tk.RIGHT, padx=padx)
            
            # 分辨率设置区域
            res_frame = ttk.LabelFrame(main_frame, text="分辨率设置", padding=(padx, pady))
            res_frame.pack(fill=tk.X, padx=padx, pady=pady)
            
            ttk.Label(res_frame, text="常用分辨率:").grid(row=0, column=0, padx=padx, pady=pady, sticky=tk.W)
            res_values = ["1920x1080", "2560x1440", "2500x1600", "3840x2160", "自定义"]
            self.res_combo = ttk.Combobox(res_frame, width=15, values=res_values, font=combobox_font)
            self.res_combo.grid(row=0, column=1, padx=padx, pady=pady)
            self.res_combo.set(f"{self.screen_width}x{self.screen_height}")
            self.res_combo.bind("<<ComboboxSelected>>", self.change_res)
            
            ttk.Label(res_frame, text="宽:").grid(row=0, column=2, padx=padx, pady=pady, sticky=tk.W)
            self.custom_width = ttk.Entry(res_frame, width=6, font=entry_font)
            self.custom_width.grid(row=0, column=3, padx=padx, pady=pady)
            self.custom_width.insert(0, str(self.screen_width))
            
            ttk.Label(res_frame, text="高:").grid(row=0, column=4, padx=padx, pady=pady, sticky=tk.W)
            self.custom_height = ttk.Entry(res_frame, width=6, font=entry_font)
            self.custom_height.grid(row=0, column=5, padx=padx, pady=pady)
            self.custom_height.insert(0, str(self.screen_height))
            
            # 宏配置区域
            config_frame = ttk.LabelFrame(main_frame, text="作战指令配置", padding=(padx, pady))
            config_frame.pack(fill=tk.X, padx=padx, pady=pady)
            
            ttk.Label(config_frame, text="指令名称:").grid(row=0, column=0, padx=padx, pady=5, sticky=tk.W)
            self.action_name = ttk.Entry(config_frame, width=15, font=entry_font)
            self.action_name.grid(row=0, column=1, padx=padx, pady=5)
            self.action_name.insert(0, "指令1")
            
            ttk.Label(config_frame, text="快捷键:").grid(row=0, column=2, padx=padx, pady=5, sticky=tk.W)
            self.hotkey_entry = ttk.Entry(config_frame, width=4, font=entry_font)
            self.hotkey_entry.grid(row=0, column=3, padx=padx, pady=5)
            self.hotkey_entry.insert(0, "q")
            
            ttk.Label(config_frame, text="操作类型:").grid(row=1, column=0, padx=padx, pady=5, sticky=tk.W)
            self.action_type = ttk.Combobox(config_frame, width=8, values=["点位", "拖动", "连点"], font=combobox_font)
            self.action_type.grid(row=1, column=1, padx=padx, pady=5)
            self.action_type.current(0)
            
            ttk.Label(config_frame, text="目标位置:").grid(row=1, column=2, padx=padx, pady=5, sticky=tk.W)
            self.target_x = ttk.Entry(config_frame, width=6, font=entry_font)
            self.target_x.grid(row=1, column=3, padx=padx, pady=5)
            self.target_y = ttk.Entry(config_frame, width=6, font=entry_font)
            self.target_y.grid(row=1, column=4, padx=padx, pady=5)
            
            # 捕获位置按钮（游戏开发部说这个功能很实用༼ つ ◕_◕ ༽つ）
            capture_btn = ttk.Button(config_frame, text="捕获位置", width=12, command=self.capture_pos)
            capture_btn.grid(row=1, column=5, padx=padx, pady=5)
            
            ttk.Label(config_frame, text="拖动距离:").grid(row=2, column=0, padx=padx, pady=5, sticky=tk.W)
            self.drag_dist = ttk.Entry(config_frame, width=6, font=entry_font)
            self.drag_dist.grid(row=2, column=1, padx=padx, pady=5)
            self.drag_dist.insert(0, "300")
            
            ttk.Label(config_frame, text="拖动时间:").grid(row=2, column=2, padx=padx, pady=5, sticky=tk.W)
            self.drag_time = ttk.Entry(config_frame, width=6, font=entry_font)
            self.drag_time.grid(row=2, column=3, padx=padx, pady=5)
            self.drag_time.insert(0, "0.02")
            
            ttk.Label(config_frame, text="连点间隔:").grid(row=2, column=4, padx=padx, pady=5, sticky=tk.W)
            self.click_gap = ttk.Entry(config_frame, width=6, font=entry_font)
            self.click_gap.grid(row=2, column=5, padx=padx, pady=5)
            self.click_gap.insert(0, "0.1")
            
            # 按钮区域
            btn_frame = ttk.Frame(config_frame)
            btn_frame.grid(row=3, column=0, columnspan=6, pady=10)
            
            add_btn = ttk.Button(btn_frame, text="添加指令", width=button_width, command=self.add_macro)
            add_btn.pack(side=tk.LEFT, padx=5)
            test_btn = ttk.Button(btn_frame, text="测试指令", width=button_width, command=self.test_macro)
            test_btn.pack(side=tk.LEFT, padx=5)
            del_btn = ttk.Button(btn_frame, text="删除选中", width=button_width, command=self.remove_selected)
            del_btn.pack(side=tk.RIGHT, padx=5)
            
            # 指令列表区域（真理部作战日志）
            list_frame = ttk.LabelFrame(main_frame, text="作战指令列表", padding=(padx, pady))
            list_frame.pack(fill=tk.BOTH, expand=True, padx=padx, pady=pady)
            
            scrollbar = ttk.Scrollbar(list_frame)
            scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
            
            # 字体这一块！
            self.macro_list = tk.Listbox(list_frame, height=list_height, 
                                        yscrollcommand=scrollbar.set, width=50,
                                        font=("Segoe UI", font_size))
            self.macro_list.pack(fill=tk.BOTH, expand=True)
            scrollbar.config(command=self.macro_list.yview)
            
            # 状态栏
            status_frame = ttk.Frame(self.root)
            status_frame.pack(side=tk.BOTTOM, fill=tk.X)
            
            status_label = ttk.Label(status_frame, textvariable=self.status_text, relief=tk.SUNKEN, anchor=tk.W)
            status_label.pack(fill=tk.X, side=tk.LEFT)
            
            # 真理部版权声明（各务前辈坚持要加）
            footer_label = ttk.Label(status_frame, text="真理部技术支援科", relief=tk.SUNKEN, anchor=tk.E)
            footer_label.pack(fill=tk.X, side=tk.RIGHT, expand=True)
            
        except Exception as e:
            logging.exception("UI初始化失败")
            raise

    def show_letter(self):
        """显示小钩晴给老师的信"""
        letter_window = tk.Toplevel(self.root)
        letter_window.title("小钩晴的信")
        letter_window.geometry(f"{int(600 * self.scaling_factor)}x{int(700 * self.scaling_factor)}")
        letter_window.resizable(True, True)
        letter_window.transient(self.root)  
        letter_window.grab_set()  
        
        # 背景
        letter_window.configure(bg="#fcf9f2")
        
        # 小绿萝
        header_frame = ttk.Frame(letter_window)
        header_frame.pack(fill=tk.X, pady=(10, 0))
        ttk.Label(header_frame, text="🌱", font=("Arial", 16)).pack(side=tk.LEFT, padx=10)
        
        # 滚动
        frame = ttk.Frame(letter_window)
        frame.pack(fill=tk.BOTH, expand=True, padx=20, pady=10)
        
        scrollbar = ttk.Scrollbar(frame)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        
        # 文本框
        letter_text = tk.Text(frame, wrap=tk.WORD, yscrollcommand=scrollbar.set,
                             font=("微软雅黑", 11), padx=15, pady=15,
                             bg="#fcf9f2", fg="#5a3e36", 
                             spacing2=8,  
                             selectbackground="#e8d5c4",
                             borderwidth=0, highlightthickness=0)
        letter_text.pack(fill=tk.BOTH, expand=True)
        scrollbar.config(command=letter_text.yview)
        
        # 内容
        letter_content = """
亲爱的老师：

窗外的无人机正在给社团窗台的绿萝浇水——啊，水雾在阳光下画出了小小的彩虹！突然想到您总在屏幕前研究战术到深夜，彩虹的光应该照不到您那里吧...所以和贝里塔斯的大家做了个小礼物。

您还记得野营时那个烤焦的红薯吗？真理部的烤箱最近总把点心烤成炭块（部长说这是防火墙的副作用），可当测试程序到凌晨三点时，热乎乎的失败品竟然比"妖怪MAX"更提神呢。这次的工具就像这样的存在：不够精致，但足够温暖。

它能为您做的事：
• 游戏预设点位的替换与再绑定（方便老师自定键位）
• 按下按键连续点击鼠标光标（老师可以自己设置间隔时间参数哦）
• 把复杂耗时的技能滑动释放变得轻松自如（测试时桃井说"就像游戏里那样！"）
• 摸轴后设置按键点击屏幕上固定按键（老师再也不用怕记错点错点位了）

昨天看到您的总力战排名又刷新了。明明说好"群四摆烂"的，结果为了弥补上p失误，您硬是用多刀凹进前百...这种时候就会想起暴雨困在网咖的那天，您把最后的热可可推给我时说："小钩晴的代码里藏着比星空更浪漫的东西。"

——其实啊，那杯可可的甜度刚刚好卡在47%，正是让人眼眶发热的数值呢。

程序设置了小小的"反熬夜协议"：
🌙 22点后启动时，会弹出我新拍的绿萝成长日记（第7片叶子有猫咪爪印哦）
⏰ 每30分钟强制播放部长的走音摇篮曲（她坚持这是"真理部式关怀"）（已关闭哦老师）

PS：实验室冰箱第三格有惊喜！用无人机冷链送的草莓大福，红豆馅比例参照了您上次称赞的和果子店配方~吃完记得把盒子扣在窗台上，我会回收来做导线收纳盒！

在数据洪流里守护您指尖的温度，
就是我的"总力战"呀。

小钩晴
于贝里塔斯弥漫着焦糖香气的凌晨

（窗台绿萝今天又长高0.2厘米，部长说该给它注册学籍了）
"""
        letter_text.insert(tk.END, letter_content)
        
        # 格式
        letter_text.tag_configure("highlight", foreground="#c45a65", font=("微软雅黑", 11, "bold"))
        letter_text.tag_add("highlight", "5.0", "5.32")  
        
        # 来自真理部便签
        postscript = """
> 附真理部便签：
> "22点摇篮曲样本.wav 已加密附送
> 敢提前关掉的话...
> 下次甜点糖分追加300%  (｀ω´ )✧"
"""
        letter_text.insert(tk.END, "\n\n" + postscript)
        letter_text.tag_configure("postscript", foreground="#8a6d3b", font=("微软雅黑", 10))
        start_index = letter_text.index("end-1l linestart")
        letter_text.tag_add("postscript", start_index, "end")
        
        # 关闭
        btn_frame = ttk.Frame(letter_window)
        btn_frame.pack(fill=tk.X, pady=(0, 15))
        
        close_btn = ttk.Button(btn_frame, text="关闭", 
                              command=letter_window.destroy)
        close_btn.pack(side=tk.RIGHT, padx=20)
        
        
        letter_text.config(state=tk.DISABLED)
        
        # ico装饰
        footer_frame = ttk.Frame(letter_window)
        footer_frame.pack(fill=tk.X, side=tk.BOTTOM, pady=(0, 10))
        ttk.Label(footer_frame, text="🌱 🌱 🌱", font=("Arial", 12)).pack()

    def change_res(self, event):
        """处理分辨率选择变更"""
        sel = self.res_combo.get()
        if sel == "自定义":
            self.custom_width.config(state="normal")
            self.custom_height.config(state="normal")
        else:
            # 预设分辨率
            self.custom_width.config(state="disabled")
            self.custom_height.config(state="disabled")
            if 'x' in sel:
                parts = sel.split('x')
                if len(parts) >= 2:
                    self.screen_width = int(parts[0])
                    self.screen_height = int(parts[1])
                    self.status_text.set(f"分辨率已设为: {self.screen_width}x{self.screen_height}")

    def capture_pos(self):
        """捕获当前鼠标位置（延迟2秒避免误触发）"""
        self.status_text.set("2秒后捕获位置，请移动鼠标...")
        self.root.update()
        time.sleep(2.0)  # 等待时间（个人感觉是最方便的捕获时间）
        
        pt = POINT()
        if windll.user32.GetCursorPos(byref(pt)):
            self.target_x.delete(0, tk.END)
            self.target_x.insert(0, str(pt.x))
            self.target_y.delete(0, tk.END)
            self.target_y.insert(0, str(pt.y))
            self.status_text.set(f"位置已捕获: ({pt.x}, {pt.y})")
        else:
            self.status_text.set("捕获失败")
            logging.error("捕获鼠标位置失败")

    def add_macro(self):
        """添加新作战指令"""
        hotkey = self.hotkey_entry.get().strip().lower()
        action_name = self.action_name.get().strip()
        
        if not hotkey or not action_name:
            messagebox.showerror("输入错误", "需要指令名称和快捷键")
            return
            
        try:
            # 参数验证（真理部输入安全规范）
            x_val = int(self.target_x.get())
            y_val = int(self.target_y.get())
            dist_val = int(self.drag_dist.get())
            time_val = float(self.drag_time.get())
            gap_val = float(self.click_gap.get())
        except ValueError:
            messagebox.showerror("格式错误", "请输入有效数字")
            return
        
        # 热键冲突检查（上次C&C部队的教训）
        for macro in self.actions:
            if macro['hotkey'] == hotkey:
                messagebox.showerror("冲突", f"快捷键 {hotkey} 已被占用")
                return
        
        # 创建新指令对象
        new_macro = {
            "name": action_name,
            "hotkey": hotkey,
            "type": self.action_type.get(),
            "target_x": x_val,
            "target_y": y_val,
            "drag_dist": dist_val,
            "drag_time": time_val,
            "click_gap": gap_val
        }
        
        self.actions.append(new_macro)
        list_text = f"{action_name} ({hotkey}) - {new_macro['type']} @ ({x_val}, {y_val})"
        self.macro_list.insert(tk.END, list_text)
        self.status_text.set(f"添加指令: {action_name}")
        
        # 自动生成下一个指令名称
        self.action_name.delete(0, tk.END)
        self.action_name.insert(0, f"指令{len(self.actions)+1}")
        
        # qwe等宏键自动递增
        keys = 'qwertyuiopasdfghjklzxcvbnm'
        if hotkey in keys:
            next_key = keys[(keys.index(hotkey) + 1) % len(keys)]
            self.hotkey_entry.delete(0, tk.END)
            self.hotkey_entry.insert(0, next_key)

    def remove_selected(self):
        """删除选中的作战指令"""
        sel = self.macro_list.curselection()
        if not sel:
            return
            
        idx = sel[0]
        macro_name = self.actions[idx]['name']
        del self.actions[idx]
        self.macro_list.delete(idx)
        self.status_text.set(f"已删除: {macro_name}")
        logging.info(f"用户删除指令: {macro_name}")

    def test_macro(self):
        """测试当前配置的指令"""
        try:
            x_val = int(self.target_x.get())
            y_val = int(self.target_y.get())
            action_type = self.action_type.get()
            action_name = self.action_name.get() or "测试指令"
            
            macro = {
                "name": action_name,
                "type": action_type,
                "target_x": x_val,
                "target_y": y_val,
                "drag_dist": int(self.drag_dist.get()),
                "drag_time": float(self.drag_time.get()),
                "click_gap": float(self.click_gap.get())
            }
            
            self.status_text.set(f"测试中: {action_name}...")
            self.root.update()
            
            if action_type == "点位":
                # 保存鼠标初始位置
                orig_pt = POINT()
                windll.user32.GetCursorPos(byref(orig_pt))
                self.do_point_action(x_val, y_val, action_name)
                time.sleep(0.5)
                self.release_point(orig_pt.x, orig_pt.y)
                self.status_text.set(f"测试完成: {action_name}")
            elif action_type == "拖动":
                threading.Thread(target=self.do_drag, args=(macro,), daemon=True).start()
            elif action_type == "连点":
                self.do_click(macro)
                self.status_text.set(f"测试完成: {action_name}")
        except Exception as e:
            self.status_text.set(f"测试出错: {str(e)}")
            logging.exception("指令测试异常")

    def absolute_pos(self, x, y):
        """转换到绝对坐标系统（0-65535范围）"""
        return (x * 65535) // self.screen_width, (y * 65535) // self.screen_height

    def mouse_event(self, flags, dx=0, dy=0, data=0):
        """发送鼠标事件（系统底层API调用）"""
        mi = MOUSEINPUT(dx, dy, data, flags, 0, None)
        input_struct = INPUT()
        input_struct.type = INPUT_MOUSE
        input_struct.mi = mi
        windll.user32.SendInput(1, byref(input_struct), sizeof(input_struct))

    def do_drag(self, macro):
        """执行拖动操作（模拟技能释放）"""
        start_x = macro['target_x']
        start_y = macro['target_y']
        dist = macro.get('drag_dist', 200)  # 默认拖动距离为向上200
        dur = macro.get('drag_time', 0.03)  # 默认持续时间
        
        # 验证持续时间值
        if dur <= 0:
            dur = 0.01  
        
        # 获取当前光标位置（拖动结束后恢复）
        pt = POINT()
        windll.user32.GetCursorPos(byref(pt))
        
        # 计算终点位置（向上拖动）
        up_x = start_x
        up_y = start_y - dist
        
        # 移动到起始位置
        self.x, self.y = start_x, start_y
        abs_x, abs_y = self.absolute_pos(start_x, start_y)
        self.mouse_event(MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_MOVE, abs_x, abs_y)
        self.mouse_event(MOUSEEVENTF_LEFTDOWN)
        self.left_pressed = True
        
        # 分两段平滑滑动（重要重要重要，删去后有些位置技能放不出来）
        self.move_smooth(start_x, start_y, up_x, up_y, dur * 0.3)
        self.move_smooth(up_x, up_y, pt.x, pt.y, dur * 0.7)
        
        # 释放光标
        self.mouse_event(MOUSEEVENTF_LEFTUP)
        self.left_pressed = False
        
        self.status_text.set(f"完成拖动: {macro['name']}")

    def move_smooth(self, from_x, from_y, to_x, to_y, duration):
        """平滑移动鼠标（避免跳跃感）"""
        # 验证持续时间值
        if duration <= 0:
            duration = 0.01  
        
        # 步数计算（低配置设备最少10步）
        steps = max(10, int(duration * 30))
        step_delay = duration / steps
        
        # 步长
        dx = (to_x - from_x) / steps
        dy = (to_y - from_y) / steps
        
        for i in range(1, steps + 1):
            # 更新位置
            self.x = from_x + dx * i
            self.y = from_y + dy * i
            abs_x, abs_y = self.absolute_pos(self.x, self.y)
            
            # 移动
            self.mouse_event(MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_MOVE, abs_x, abs_y)
            
            # 控制移动速度（低于0.005可能会丢操作）
            time.sleep(max(0.005, step_delay))

    def do_point_action(self, x, y, name):
        """执行点位操作（点击特定位置）"""
        self.x, self.y = x, y
        abs_x, abs_y = self.absolute_pos(x, y)
        self.mouse_event(MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_MOVE, abs_x, abs_y)
        self.mouse_event(MOUSEEVENTF_LEFTDOWN)
        self.left_pressed = True
        self.status_text.set(f"按下: {name} @ ({x}, {y})")
    
    def release_point(self, x, y):
        """释放鼠标并返回原位"""
        self.mouse_event(MOUSEEVENTF_LEFTUP)
        self.left_pressed = False
        time.sleep(0.01)  # 防止操作粘连
        self.x, self.y = x, y
        abs_x, abs_y = self.absolute_pos(x, y)
        self.mouse_event(MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_MOVE, abs_x, abs_y)

    def do_click(self, macro):
        """执行连点操作（快速点击）"""
        pt = POINT()
        windll.user32.GetCursorPos(byref(pt))
        self.x, self.y = pt.x, pt.y
        abs_x, abs_y = self.absolute_pos(self.x, self.y)
        
        # 快速点击
        self.mouse_event(MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_LEFTDOWN, abs_x, abs_y)
        self.left_pressed = True
        time.sleep(0.05)  # 最小时间间隔
        self.mouse_event(MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_LEFTUP, abs_x, abs_y)
        self.left_pressed = False

    def toggle_listen(self):
        """切换监听状态（开始/停止作战）"""
        if self.is_listening:
            self.stop_listen()
        else:
            self.start_listen()

    def start_listen(self):
        """启动热键监听模式（进入作战状态）"""
        if not self.actions:
            messagebox.showwarning("配置缺失", "请先添加作战指令")
            return
            
        # 安全停止键检查（前辈的要求）
        exit_key = self.exit_key_entry.get().strip().lower()
        if not exit_key:
            messagebox.showerror("安全错误", "必须设置停止键")
            return
        
        self.exit_key = exit_key    
        self.is_listening = True
        self.listen_btn.config(text="停止作战")
        self.status_text.set(f"作战中... 停止键: [{self.exit_key.upper()}]")
        
        # 屏蔽所有注册宏键（防止游戏内按键冲突）
        self.macro_keys = {m['hotkey'] for m in self.actions}
        for key in self.macro_keys:
            try:
                keyboard.block_key(key)
                self.blocked_keys.add(key)
            except Exception as e:
                logging.error(f"屏蔽热键失败: {key} - {str(e)}")
        
        # 启动监听线程（真理部多线程规范）
        self.key_listener = threading.Thread(target=self.listen, daemon=True)
        self.key_listener.start()

    def stop_listen(self):
        """停止监听模式（退出作战状态）"""
        self.is_listening = False
        self.listen_btn.config(text="开始作战")
        self.status_text.set("作战已停止")
        
        # 解除所有宏键屏蔽
        for key in self.blocked_keys:
            try:
                keyboard.unblock_key(key)
            except Exception as e:
                logging.warning(f"解除屏蔽失败: {key} - {str(e)}")
        self.blocked_keys.clear()

    def listen(self):
        """热键监听主循环（独立线程运行）"""
        key_states = {m['hotkey']: False for m in self.actions}  
        
        while self.is_listening and self.running:
            for macro in self.actions:
                hotkey = macro['hotkey']
                
                # 检测按键按下
                if keyboard.is_pressed(hotkey):
                    if not key_states[hotkey]:
                        key_states[hotkey] = True
                        threading.Thread(
                            target=self.run_macro, 
                            args=(macro,),
                            daemon=True
                        ).start()
                else:
                    key_states[hotkey] = False
            
            if keyboard.is_pressed(self.exit_key):
                self.stop_listen()
                return
            
            time.sleep(0.03)  # 占用优化

    def run_macro(self, macro):
        """执行单个作战指令（带线程锁）"""
        with self.thread_lock:
            hotkey = macro['hotkey']
            action_type = macro.get('type', '点位')
            
            if action_type == "拖动":
                # 按住并且持续拖动光标
                while self.is_listening and self.running and keyboard.is_pressed(hotkey):
                    self.do_drag(macro)
                    
                    gap = 0.05  # 默认时间间隔
                    start_time = time.time()
                    
                    # 状态检查
                    while time.time() - start_time < gap:
                        if not self.is_listening: return
                        if not keyboard.is_pressed(hotkey): return
                        time.sleep(0.01)
                        
                    if keyboard.is_pressed(self.exit_key):
                        self.stop_listen()
                        return
            elif action_type == "连点":
                gap = macro.get('click_gap', 0.1)  # 连点间隔
                while self.is_listening and self.running and keyboard.is_pressed(hotkey):
                    self.do_click(macro)
                    
                    start = time.time()
                    while time.time() - start < gap:
                        if not self.is_listening: return
                        if not keyboard.is_pressed(hotkey): return
                        time.sleep(0.01)
            else:
                # 点位操作：按下期间保持点击状态循环
                orig_pt = POINT()
                windll.user32.GetCursorPos(byref(orig_pt))
                
                self.do_point_action(macro['target_x'], macro['target_y'], macro['name'])
                
                # 状态检查
                while self.is_listening and self.running and keyboard.is_pressed(hotkey):
                    time.sleep(0.02)
                
                # 释放并返回初始位置
                self.release_point(orig_pt.x, orig_pt.y)
                self.status_text.set(f"完成: {macro['name']}")

    def save_cfg(self):
        """保存配置到文件（真理部持久化协议）"""
        config = {
            "version": "1.3",  
            "resolution": {
                "width": self.screen_width,
                "height": self.screen_height
            },
            "actions": self.actions,
            "exit_key": self.exit_key
        }
        
        try:
            with open(self.config_file, 'w', encoding='utf-8') as file:
                json.dump(config, file, indent=2, ensure_ascii=False)
            self.status_text.set("配置已保存")
            logging.info("用户保存配置")
        except Exception as e:
            self.status_text.set("保存失败")
            logging.error(f"保存配置异常: {str(e)}")

    def load_cfg(self):
        """从文件加载配置（自动恢复设置）"""
        if not os.path.exists(self.config_file):
            return
            
        try:
            with open(self.config_file, 'r', encoding='utf-8') as file:
                config = json.load(file)
        except Exception as e:
            self.status_text.set("加载配置失败")
            logging.error(f"加载配置异常: {str(e)}")
            return
        
        # 真理部兼容性要求
        if config.get("version") != "1.3":
            logging.warning(f"配置版本不匹配: {config.get('version')}")
        
        # 分辨率设置
        if "resolution" in config:
            w = config["resolution"].get("width", 2500)
            h = config["resolution"].get("height", 1600)
            self.screen_width = w
            self.screen_height = h
            self.res_combo.set(f"{w}x{h}")
        
        # 加载作战指令
        if "actions" in config:
            self.actions = config["actions"]
            self.macro_list.delete(0, tk.END)
            for macro in self.actions:
                self.macro_list.insert(tk.END, 
                    f"{macro['name']} ({macro['hotkey']}) - {macro['type']} @ ({macro['target_x']}, {macro['target_y']})"
                )
        
        # 游戏结束键
        if "exit_key" in config:
            self.exit_key = config["exit_key"]
            self.exit_key_entry.delete(0, tk.END)
            self.exit_key_entry.insert(0, self.exit_key)
        
        self.status_text.set("配置已加载")
        logging.info("用户加载配置")

    def on_close(self):
        """关闭程序处理（安全退出协议）"""
        self.running = False
        self.is_listening = False
        time.sleep(0.1)  
        
        # 尝试保存配置（真理部安全规范）
        try:
            self.save_cfg()
        except Exception as e:
            logging.error(f"关闭时保存失败: {str(e)}")
        
        # 清理资源
        self.root.destroy()
        sys.exit()

# 系统启动入口 ================================================
"""
// 真理部技术备忘录：
//  本程序已通过千禧年安全检测
//  当前版本包含对高DPI设备的特别优化
//  遇到技术问题请联系：小钩晴@真理社 
//  
// 提示：合理使用宏工具 被联邦理事会发现了我也在劫难逃哦~ (｡•̀ᴗ-)✧
"""

def main():
    try:
        root = tk.Tk()
        app = BlueArchiveMacro(root)
        root.mainloop()
    except Exception as e:
        logging.exception("程序崩溃")
        messagebox.showerror("致命错误", f"程序崩溃: {str(e)}")

if __name__ == "__main__":
    main()