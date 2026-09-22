# NVMe-oF 链路互动教学平台

> **仿 [NVMe IO 链路互动教学平台](https://yluo008-lang.github.io/nvme-io-path/) 制作的 NVMe-oF 版**
> 一个把「应用程序 → blk-mq → Fabrics Capsule → RDMA/TCP → nvmet → 后端盘」完整 NVMe-oF 链路**可视化、可点击、可对照内核版本**的互动教学平台。

在线演示：`https://yluo008-lang.github.io/nvme-of-path/`

---

## ✨ 功能特性

- **2×2 仪表盘布局**（与原版一致）
  - 左上 · **Shell 模拟**：输入 `discover` / `connect` / `read` / `write` / `io_uring` / `transport rdma|tcp` 等命令驱动教学
  - 右上 · **功能说明 & 关键代码逻辑**：层级、函数、源码位置、简化结构体、协议字段、代码逻辑
  - 左下 · **系统框图 & 链路分层**：模块框图（当前模块高亮）+ 可点击链路节点
  - 右下 · **各层核心代码操作**：按层列出核心函数与源码文件，点击即查
- **四个场景**：
  1. 发现与连接（Discovery + Connect）：`discover / connect`
  2. 主机读 over Fabrics（RDMA 路径）：`read`
  3. 主机写 over Fabrics（TCP 路径）：`write`
  4. io_uring over Fabrics：`io_uring`
- **五档内核版本**：Linux 4.19 / 5.4 / 5.15 / 6.1 / 6.8
- **点击函数/结构体 → 弹出 Bootlin 源码**：按内核版本检索完整定义（GitHub Pages 纯静态时经 GitHub raw 回退拉取）

## 🆚 与原版（本地 NVMe）的对照

| 环节 | 本地 NVMe（原版） | NVMe-oF（本版） |
|---|---|---|
| 提交 | SQE → doorbell（BAR0 MMIO） | Capsule → SEND / TCP PDU |
| 数据搬运 | PCIe DMA（PRP/SGL） | RDMA WRITE/READ 零拷贝，或 TCP H2CData/C2HData |
| 完成 | CQE → MSI-X 中断 | Response Capsule / Rsp PDU → CQ/socket |
| 初始化 | PCI probe / CAP/CC/Identify | Discovery Log → Fabrics Connect → Identify |
| 设备 | /dev/nvme0n1 | /dev/nvmeXnY（按 subnqn/ANA 多路径分组） |

## 📁 目录结构

```
nvme-of-path/
├── public/                 # 静态站点（纯 HTML/CSS/JS，无第三方依赖）
│   ├── index.html
│   ├── app.js              # 交互逻辑
│   ├── data.js             # 场景 / 步骤 / 分层数据
│   ├── kb.js               # 结构体库 / 代码逻辑 / 协议字段
│   └── styles.css
├── app/
│   └── server.js           # 可选后端：Bootlin 源码代理（Node 内置模块，零依赖）
├── nginx/
│   └── location.conf       # nginx 子路径部署配置
├── docs/
│   └── nvme-of-path.md     # 完整链路技术文档
└── README.md
```

## 🚀 本地运行

把 `public/` 作为站点根放在 `/nvme-of-path/` 子路径下即可直接打开 `index.html` 预览（资源路径均为相对路径）。

```bash
cd public && python3 -m http.server 8000
# 浏览器打开 http://localhost:8000/
```

### Bootlin 源码代理（可选）

```bash
node app/server.js          # 监听 127.0.0.1:3132
```

nginx 将 `/nvme-of-path/api/` 反代到该端口（见 `nginx/location.conf`）。
无后端时前端自动回退到 GitHub raw 拉取对应版本源码。
