import { BookOpen, FolderOpen } from "lucide-react";

const appDataRoot = "%APPDATA%/BAMT Next/data";
const paths = [
  ["当前宏配置", "%APPDATA%/BAMT Next/data/config/blue_archive_config.json"],
  ["全局宏预设库", "%APPDATA%/BAMT Next/data/presets/preset-library.json"],
  ["导入文件目录", "%APPDATA%/BAMT Next/data/imports/"],
  ["导出文件目录", "%APPDATA%/BAMT Next/data/exports/"],
  ["排轴自动保存", "%APPDATA%/BAMT Next/data/timelines/"],
  ["AHK 临时脚本", "%APPDATA%/BAMT Next/data/ahk/bamt-inline.ahk"],
  ["随机背景素材", "程序内置资源 src/assets/backgrounds/"],
  ["完整技术文档", "README.md"],
];

const dslExample = `loop until_release
  press 2688 1853
  move 2688 1553 20
  move mouse 10
  release mouse
  sleep 50
end
release_actions
  release mouse`;

export function ProjectManual({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <article className="manual-modal" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>x</button>
        <p className="eyebrow">Manual</p>
        <h2><BookOpen size={24} /> BAMT Next 使用说明书</h2>

        <section>
          <h3>工具定位</h3>
          <p>BAMT Next 是《蔚蓝档案》总力战 / 大决战用的 Windows 本地宏控制台和排轴工具。它负责管理 Q/W/E 手牌拖动、战场点位、连点、点击宏、脚本宏、分辨率换算、全局宏预设、AHK 兼容和排轴文本。</p>
        </section>

        <section>
          <h3>发布版数据目录</h3>
          <p>单 exe 发布版不会把宏配置写在 exe 旁边。所有用户数据统一放在：</p>
          <pre>{appDataRoot}</pre>
          <p>这样 exe 放在桌面、下载目录或 OneDrive 时，也不会因为目录权限或同步锁导致配置丢失。</p>
          <div className="manual-paths">
            {paths.map(([label, value]) => (
              <p key={value}><FolderOpen size={16} /><strong>{label}</strong><code>{value}</code></p>
            ))}
          </div>
        </section>

        <section>
          <h3>快速开始</h3>
          <ol>
            <li>启动后先确认游戏分辨率。</li>
            <li>首次使用先校准 Q/W/E 三个基础手牌宏。</li>
            <li>输入后端默认使用“系统光标模式”，它兼容性最高，但会移动真实鼠标。</li>
            <li>修改宏、导入宏或切换分辨率后先保存，再点“开始”。</li>
            <li>固定紧急停止键是 X。异常时优先按 X。</li>
          </ol>
        </section>

        <section>
          <h3>宏类型</h3>
          <p><strong>点位：</strong>按住热键时在目标坐标按下，松开热键后释放并返回原鼠标位置。</p>
          <p><strong>拖动：</strong>按住热键循环执行手牌拖动。本轮开始后一定会完整走完：移动到手牌，按下，竖直上拖，回到触发时鼠标位置释放。松开热键只会阻止下一轮，不会打断本轮释放。</p>
          <p><strong>连点：</strong>按住热键期间连续点击目标坐标，松开后停止。</p>
          <p><strong>点击：</strong>普通模式点击目标点一次。填写选牌键 1/2/3 后，按住热键会循环执行“按 1/2/3，等待单轮内间隔，点击当前鼠标位置，等待循环间隔”。</p>
          <p><strong>脚本：</strong>使用 BAMT DSL 写鼠标动作，不是 Python，也不是完整 AHK。</p>
        </section>

        <section>
          <h3>拖动宏细节</h3>
          <p>拖动宏适合底部手牌 UI。它和战场点位不是同一种映射算法。默认距离 300，默认时长 0.02，循环间隔建议不要低于 0.05，否则系统光标模式会明显抢鼠标。</p>
          <p>拖动宏的释放点是触发本轮热键时的鼠标位置。一次循环结束前不要把它理解成虚拟鼠标；Windows 系统光标模式本质上仍会移动真实鼠标。</p>
        </section>

        <section>
          <h3>输入后端</h3>
          <p><strong>系统光标模式：</strong>默认推荐，适配度最高，通常能进原生游戏；缺点是会占用真实鼠标。</p>
          <p><strong>Win 窗口消息模式：</strong>不会移动真实光标，但部分原生游戏聚焦后会拒收窗口消息。</p>
          <p><strong>Win 触控注入模式：</strong>实验功能，不抢鼠标，但兼容性不稳定。</p>
        </section>

        <section>
          <h3>坐标和分辨率</h3>
          <p>点位、点击、连点属于战场地图点位，使用中轴线缩放规则。拖动宏属于底部 UI 手牌，使用手牌 UI 算法。Q/W/E 三个基础手牌宏还有独立算法，不和普通点位混算。导入别人配置后，建议点“应用并重算”，再手动校准一次。</p>
        </section>

        <section>
          <h3>宏预设导入导出</h3>
          <p>全局宏是一整套点位、拖动、点击、连点和脚本配置。导入时会按当前分辨率换算坐标；合并导入会把外部宏加入当前配置；导出当前只导出当前配置；导出全部会连同预设库一起导出。</p>
        </section>

        <section>
          <h3>排轴编辑器</h3>
          <p>排轴按 P 完全独立。每个 P 都有自己的队伍、练度、视频参考、牌序、牌池状态和动作记录。新建轴前先填写文件名，工具会自动保存到 AppData 的 timelines 目录。</p>
          <p>牌序按 1 到 5 点选：前三张是初始牌，后两张是固定顺序牌，剩余角色自动补成第六张。出牌区只有前三张能释放。</p>
          <p>普通出牌会沉底；锁牌会留在原位；复制牌显示为“被复制角色（复制）”，再次释放后恢复原名并沉底。转场、撤退、送人是结构事件，不算普通出牌。送人只影响它之后的牌池，删除送人记录后会按时间线重新计算。</p>
        </section>

        <section>
          <h3>脚本宏 DSL</h3>
          <p>一行一条命令；#、//、; 开头是注释；坐标是当前分辨率下的屏幕坐标；时间单位是毫秒；mouse 表示触发热键瞬间的鼠标位置。</p>
          <ol>
            <li><code>click 1500 900</code>：点击固定坐标。</li>
            <li><code>press 1200 800</code>：移动到坐标并按下左键。</li>
            <li><code>release mouse</code>：在触发位置释放。</li>
            <li><code>move 2688 1553 20</code>：用约 20ms 移动到坐标。</li>
            <li><code>drag 1000 1400 1000 1100 80</code>：从起点拖到终点。</li>
            <li><code>sleep 50</code>：等待 50ms。</li>
            <li><code>loop until_release ... end</code>：按住热键循环，松开停止。</li>
          </ol>
          <pre>{dslExample}</pre>
        </section>

        <section>
          <h3>AHK 解释器</h3>
          <p>AHK 面板运行 AutoHotkey v2 脚本。发布版内置 AHK 解释器；如果你单独放了解释器，也可以设置 BAMT_AHK 指向 AutoHotkey64.exe。AHK 导入用于把社区脚本转换成 BAMT 宏预设，不会自动把外部脚本逻辑写进工程。</p>
        </section>

        <section>
          <h3>常见问题</h3>
          <p><strong>后端进程已退出：</strong>发布版已内置 Python；如果仍报错，优先检查杀毒软件是否拦截了 exe 释放或启动子进程。</p>
          <p><strong>日服热键无反应：</strong>优先用系统光标模式，并尝试管理员方式启动。窗口消息模式不保证能进所有原生游戏。</p>
          <p><strong>坐标偏移：</strong>确认游戏分辨率、Windows DPI、窗口黑边和映射类型。战场点位和手牌 UI 使用不同算法。</p>
        </section>
      </article>
    </div>
  );
}
