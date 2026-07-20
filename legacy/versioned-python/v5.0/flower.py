from PIL import Image, ImageDraw, ImageFont
import base64
import io

def create_green_ivy_icon():
    # 创建256x256透明背景图像
    size = 256
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # 绘制窗台
    window_color = (210, 180, 140, 255)  # 浅木色
    draw.rectangle([size*0.2, size*0.7, size*0.8, size*0.75], fill=window_color)
    
    # 绘制花盆
    pot_color = (150, 100, 70, 255)  # 陶土色
    draw.ellipse([size*0.35, size*0.65, size*0.65, size*0.75], fill=pot_color)
    
    # 绘制绿萝藤蔓
    vine_color = (80, 120, 60, 255)  # 深绿色
    for i in range(3):
        start_x = size * (0.4 + i * 0.1)
        draw.line([(start_x, size*0.7), (start_x, size*0.9)], fill=vine_color, width=4)
    
    # 绘制绿萝叶片 (心形)
    leaf_color = (100, 180, 80, 255)  # 鲜绿色
    for i, pos in enumerate([(0.4, 0.75), (0.5, 0.8), (0.6, 0.7), (0.45, 0.85), (0.55, 0.75)]):
        x, y = size * pos[0], size * pos[1]
        # 绘制心形叶子
        draw.ellipse([x - 20, y - 15, x, y + 15], fill=leaf_color)
        draw.ellipse([x, y - 15, x + 20, y + 15], fill=leaf_color)
        draw.polygon([(x - 20, y), (x + 20, y), (x, y + 25)], fill=leaf_color)
        
        # 添加叶片纹理
        draw.line([(x - 5, y - 10), (x - 5, y + 20)], fill=(60, 100, 40, 255), width=2)
    
    # 添加水珠效果
    for pos in [(0.42, 0.76), (0.58, 0.72), (0.52, 0.84)]:
        x, y = size * pos[0], size * pos[1]
        draw.ellipse([x - 5, y - 5, x + 5, y + 5], fill=(200, 230, 255, 200))
        draw.ellipse([x - 2, y - 3, x, y - 1], fill=(255, 255, 255, 255))
    
    # 添加真理部标识
    font = ImageFont.truetype("arial", 20)
    draw.text((size*0.7, size*0.05), "真理部", fill=(50, 50, 50, 200), font=font)
    
    return img

def display_icon():
    """在Tkinter窗口中显示图标"""
    root = tk.Tk()
    root.title("绿萝图标预览")
    
    # 生成图标
    icon = create_green_ivy_icon()
    
    # 转换为Tkinter兼容格式
    img_tk = ImageTk.PhotoImage(icon)
    
    # 显示图标
    label = tk.Label(root, image=img_tk)
    label.pack(padx=20, pady=20)
    
    # 保存按钮
    save_btn = tk.Button(root, text="保存为ICO文件", 
                         command=lambda: save_as_ico(icon))
    save_btn.pack(pady=10)
    
    # 保存为PNG按钮
    png_btn = tk.Button(root, text="保存为PNG文件", 
                        command=lambda: save_as_png(icon))
    png_btn.pack(pady=5)
    
    # 状态标签
    status = tk.Label(root, text="小钩晴的绿萝图标 - 真理部技术支援科")
    status.pack(pady=10)
    
    root.mainloop()

def save_as_ico(image):
    """保存为ICO文件"""
    # 转换为ICO格式
    ico_path = "green_ivy_icon.ico"
    image.save(ico_path, format='ICO', sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    messagebox.showinfo("保存成功", f"图标已保存为: {ico_path}\n\n可在程序中使用此文件作为应用程序图标")

def save_as_png(image):
    """保存为PNG文件"""
    png_path = "green_ivy_icon.png"
    image.save(png_path, format='PNG')
    messagebox.showinfo("保存成功", f"图标已保存为: {png_path}")

# 运行图标生成器
if __name__ == "__main__":
    import tkinter as tk
    from PIL import ImageTk
    from tkinter import messagebox
    
    display_icon()