import { BookOpen, FolderOpen } from "lucide-react";

const paths = [
  ["当前宏配置", "data/config/blue_archive_config.json"],
  ["全局宏预设库", "data/presets/preset-library.json"],
  ["导入文件建议目录", "data/imports/"],
  ["导出文件建议目录", "data/exports/"],
  ["排轴自动保存目录", "data/timelines/"],
  ["AHK 临时脚本", "data/ahk/bamt-inline.ahk"],
  ["随机背景素材", "src/assets/backgrounds/"],
  ["内置 AHK 解释器", "tools/AutoHotkey/"],
  ["完整 README", "README.md"],
];

export function ProjectManual({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <article className="manual-modal" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>x</button>
        <p className="eyebrow">Manual</p>
        <h2><BookOpen size={24} /> BAMT Next 使用说明书</h2>

        <section>
          <h3>这个工具是做什么的</h3>
          <p>BAMT Next 用来管理《蔚蓝档案》总力战 / 大决战里的宏、点位、分辨率换算、排轴文本和 AHK 辅助脚本。首页负责实际运行宏；点位转换器负责换算坐标；排轴编辑器负责写轴、预览和导出；AHK 面板负责临时运行 AutoHotkey v2 脚本。</p>
        </section>

        <section>
          <h3>推荐使用流程</h3>
          <ol>
            <li>启动后先确认游戏分辨率。分辨率不对，所有坐标都会跟着偏。</li>
            <li>首次使用先校准 Q/W/E 三个手牌拖动宏，再校准自己的常用点位。</li>
            <li>输入后端默认选“系统光标模式”。它最容易进原生游戏，但会移动真实鼠标。</li>
            <li>改宏、导入宏、换分辨率后先保存，再点“开始”。</li>
            <li>固定紧急停止键是 X。遇到异常先按 X。</li>
          </ol>
        </section>

        <section>
          <h3>常用目录</h3>
          <div className="manual-paths">
            {paths.map(([label, value]) => (
              <p key={value}><FolderOpen size={16} /><strong>{label}</strong><code>{value}</code></p>
            ))}
          </div>
        </section>

        <section>
          <h3>宏类型</h3>
          <p><strong>拖动宏：</strong>按住热键后循环执行：记录当前鼠标位置，移动到手牌坐标，按下，竖直上拖设定距离，移动回原鼠标位置释放。默认距离 300，默认时长 0.02，默认循环间隔 0.005。</p>
          <p><strong>点击宏：</strong>普通点击会点一次固定坐标；如果设置了选牌键 1/2/3，则按住热键会循环执行“按 1/2/3，等待单轮内间隔，点击当前鼠标位置，等待循环间隔”。</p>
          <p><strong>点位宏：</strong>按住热键时在固定坐标按下，松开热键后释放并回到原鼠标位置。</p>
          <p><strong>连点宏：</strong>按住热键期间，按设定间隔连续点击目标坐标。</p>
          <p><strong>脚本宏：</strong>用 BAMT 的固定 DSL 写鼠标动作序列，不是 Python，也不是完整 AHK。</p>
        </section>

        <section>
          <h3>输入后端</h3>
          <p><strong>系统光标模式：</strong>默认推荐。适配度最高，通常能进原生游戏；缺点是会移动并占用真实鼠标。</p>
          <p><strong>Win 窗口消息模式：</strong>不移动真实光标，体验最好；但部分原生游戏聚焦后会拒收窗口消息。</p>
          <p><strong>Win 触控注入模式：</strong>模拟触控输入，不抢鼠标；目前仍在测试中，兼容性不稳定。</p>
        </section>

        <section>
          <h3>坐标映射规则</h3>
          <p>点位、点击、连点属于战场地图点位，使用中轴线缩放规则。拖动宏属于底部游戏 UI，使用底边锚定的手牌算法。Q/W/E 三个基础手牌宏还有独立算法，不和普通点位混算。导入别人配置后，建议点“应用并重算”，再手动校准一次。</p>
        </section>

        <section>
          <h3>宏预设导入导出</h3>
          <p>全局宏是指一整套点位、拖动、点击、连点和脚本配置。导入时会按当前分辨率换算坐标；合并导入会把外部宏加入当前配置；导出当前只导出当前配置；导出全部会连同预设库一起导出。建议外部文件放在 data/imports/，导出的文件放在 data/exports/。</p>
        </section>

        <section>
          <h3>排轴编辑器</h3>
          <p>排轴按 P 完全独立。P1、P2、P3 可以有不同队伍、练度、牌序、视频参考和动作记录。新建轴前先填写文件名；工具会自动保存到 data/timelines/。新轴默认角色是角色1到角色6，不会写死具体学生名。</p>
          <p>牌序按 1 到 5 点选：前三张是初始牌，后两张是固定顺序牌，剩余角色自动补成第六张。出牌区只有前三张能释放。普通出牌会沉底；锁牌会留在原位；复制牌会显示为“被复制角色（复制）”，再次释放后恢复原名并沉底。</p>
          <p>转场、撤退、送人是结构事件，不算普通出牌。送人只影响它之后的牌池；删除送人记录后，后续牌池会按时间线重新计算，角色会恢复。</p>
          <p>右侧文本预览可以独立弹出置顶窗口，也可以导出 TXT、MD 或 JSON。</p>
        </section>

        <section>
          <h3>脚本宏 DSL 速查</h3>
          <p>一行一条命令；空行忽略；#、//、; 开头是注释；坐标是当前分辨率下的屏幕坐标；时间单位是毫秒；mouse 表示触发热键瞬间的鼠标位置。</p>
          <ol>
            <li><code>click 1500 900</code>：点击固定坐标。</li>
            <li><code>press 1200 800</code>：移动到坐标并按下左键。</li>
            <li><code>release mouse</code>：在触发位置释放。</li>
            <li><code>move 2688 1553 20</code>：用约 20ms 移动到坐标。</li>
            <li><code>drag 1000 1400 1000 1100 80</code>：从起点拖到终点。</li>
            <li><code>sleep 5</code>：等待 5ms。</li>
            <li><code>loop until_release ... end</code>：按住热键循环，松开停止。</li>
          </ol>
          <pre>{`loop until_release\n  press 2688 1853\n  move 2688 1553 20\n  move mouse 10\n  release mouse\n  sleep 5\nend\nrelease_actions\n  release mouse`}</pre>
        </section>

        <section>
          <h3>AHK 解释器</h3>
          <p>AHK 面板运行 AutoHotkey v2 脚本。默认查找 tools/AutoHotkey/AutoHotkey64.exe；如果你单独放了解释器，也可以设置 BAMT_AHK 指向 AutoHotkey64.exe。AHK 导入用于把社区脚本转换成 BAMT 宏预设，不会自动把外部脚本逻辑写进工程。</p>
        </section>

        <section>
          <h3>常见问题</h3>
          <p><strong>后端进程已退出：</strong>通常是 Python 不可用。安装 Python 3，关闭 Microsoft Store 的 python/python3 执行别名，或设置 BAMT_PYTHON。</p>
          <p><strong>日服热键无反应：</strong>优先用系统光标模式，并尝试管理员方式启动。窗口消息模式不保证能进所有原生游戏。</p>
          <p><strong>坐标偏移：</strong>确认游戏分辨率、Windows DPI、窗口黑边和映射类型。战场点位和手牌 UI 使用不同算法。</p>
          <p><strong>OneDrive 同步报错：</strong>不要同步 node_modules、release、缓存和锁文件。源码目录最好放在非 OneDrive 位置。</p>
        </section>
      </article>
    </div>
  );
}
