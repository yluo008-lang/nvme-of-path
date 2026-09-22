/* NVMe-oF 链路互动教学 —— 数据层
 * 结构：scenarios -> { order:[layers], steps:[...] }
 * 每个 step: { layer, title, desc, file, func, structs[], code, vnote }
 */
window.APP_DATA = (function () {
  const KERNELS = ["4.19", "5.4", "5.15", "6.1", "6.8"];

  const LAYERS = {
    // 初始化 / 连接场景
    mod:    { name: "模块加载",       color: "#a5b4fc", icon: "📦" },
    disc:   { name: "服务发现",       color: "#6ee7b7", icon: "🔎" },
    conn:   { name: "Fabrics 连接",   color: "#fcd34d", icon: "🤝" },
    queue:  { name: "建 IO 队列",     color: "#7dd3fc", icon: "🚚" },
    ns:     { name: "命名空间 / 注册", color: "#c4b5fd", icon: "🗂️" },
    // IO 路径
    user:      { name: "应用层",          color: "#7dd3fc", icon: "👤" },
    syscall:   { name: "系统调用 / VFS",   color: "#a5b4fc", icon: "🧩" },
    fs:        { name: "文件系统",         color: "#c4b5fd", icon: "📁" },
    block:     { name: "通用块层 blk-mq",  color: "#f0abfc", icon: "🧱" },
    sched:     { name: "IO 调度器",        color: "#fca5f1", icon: "🚦" },
    host:      { name: "NVMe Host 核心",   color: "#5eead4", icon: "⚙️" },
    fabrics:   { name: "Fabrics 封装",     color: "#67e8f9", icon: "🌐" },
    tr_ini:    { name: "发起端传输",       color: "#6ee7b7", icon: "🚀" },
    net:       { name: "网络",             color: "#93c5fd", icon: "🛜" },
    tr_tgt:    { name: "目标端 nvmet",     color: "#fda4af", icon: "🎯" },
    hw:        { name: "后端存储",         color: "#fcd34d", icon: "💽" },
    complete:  { name: "完成路径",         color: "#fdba74", icon: "✅" }
  };

  // ===================== 初始化：Discovery + Connect =====================
  const init = {
    key: "init",
    name: "发现与连接 (Discovery+Connect)",
    cmd: "nvme discover + connect",
    blurb: "从 modprobe 一路走到 /dev/nvmeXnY 出现：Discovery 找 Target，再用 Fabrics Connect 建 Admin/IO 队列。",
    order: ["mod", "disc", "conn", "queue", "ns"],
    steps: [
      { layer: "mod", title: "加载 Host 传输模块",
        desc: "modprobe nvme-rdma / nvme-tcp：注册 Fabrics 传输，向 nvmf_transport 注册 rdma/tcp 的 create_ctrl 回调。",
        file: "drivers/nvme/host/rdma.c", func: "nvme_rdma_init_module", structs: ["nvmf_transport"],
        code: "nvmf_register_transport(&nvme_rdma_transport);\n/* .create_ctrl = nvme_rdma_create_ctrl */\n/* tcp: nvmf_register_transport(&nvme_tcp_transport); */" },
      { layer: "mod", title: "Target 侧就绪 (nvmet)",
        desc: "Target 上 modprobe nvmet / nvmet-rdma / nvmet-tcp，创建子系统、命名空间并建 port（traddr/trsvcid），开始监听。",
        file: "drivers/nvme/target/core.c", func: "nvmet_init", structs: ["nvmet_subsys", "nvmet_port"],
        code: "nvmet create-subsys nqn.test --namespaces 1\nnvmet create-port 1 --trtype rdma --traddr 192.168.1.10" },
      { layer: "disc", title: "发起 Discovery",
        desc: "nvme discover -t rdma/tcp -a <traddr>：Host 先连上众所周知的 Discovery 控制器（NQN 为 discovery NQN），准备取日志页。",
        file: "drivers/nvme/host/fabrics.c", func: "nvmf_get_discovery_log_page", structs: ["nvmf_discovery_log"],
        code: "nvme discover -t tcp -a 192.168.1.10 -s 8009\n/* 连接 Discovery 控制器，再发 Get Log Page (LID=02h) */" },
      { layer: "disc", title: "Discovery Admin 连接",
        desc: "与 Discovery 控制器建 Admin 队列：RDMA 建 RC QP + 注册 Admin SQ/CQ 内存；TCP 发 ICReq/ICResp 握手、协商 PDU 与队列深度。",
        file: "drivers/nvme/host/fabrics.c", func: "nvmf_connect_admin_queue", structs: ["nvmf_ctrl_options"] },
      { layer: "disc", title: "获取 Discovery Log",
        desc: "发 Get Log Page（LID 02h）取回 numrec：每条含 subnqn、trtype、adrfam、traddr、trsvcid，Host 据此知道有哪些子系统可连。",
        file: "drivers/nvme/host/fabrics.c", func: "nvmf_get_discovery_log_page", structs: ["nvmf_discovery_log"],
        code: "cmd.common.opcode = nvme_admin_get_log_page;  /* 02h */\ncmd.get_log_page.lid = NVME_LOG_DISC;         /* 02h discovery */\n/* entry->subnqn, entry->trtype, entry->traddr ... */" },
      { layer: "conn", title: "解析连接参数",
        desc: "nvmf_parse_options() 解析 trtype/adrfam/traddr/trsvcid/hostnqn/subnqn：决定走 rdma 还是 tcp，以及连哪个 port。",
        file: "drivers/nvme/host/fabrics.c", func: "nvmf_parse_options", structs: ["nvmf_ctrl_options"],
        code: "nvme connect -t tcp -a 192.168.1.10 -s 8009 -n nqn.test\n/* opts->trtype, opts->traddr, opts->subsysnqn, opts->hostnqn */" },
      { layer: "conn", title: "建 Admin 队列 (业务子系统)",
        desc: "nvmf_create_ctrl() → 传输的 create_ctrl：RDMA 建 QP、注册内存；TCP 建 socket、发 ICReq。随后再发 Fabrics Connect 建管理通道。",
        file: "drivers/nvme/host/fabrics.c", func: "nvmf_create_ctrl", structs: ["nvme_ctrl"] },
      { layer: "conn", title: "Fabrics Connect 命令",
        desc: "opcode 7Fh (Fabrics) + fctype 01h (Connect)：带 hostnqn/subnqn、sqsize、kato(keep-alive)，qid=0 表示 Admin 队列。Target 回 Connect 响应 (cntlid)。",
        file: "drivers/nvme/host/fabrics.c", func: "nvmf_connect_admin_queue", structs: ["nvmf_connect_command"],
        code: "cmd.fabrics.opcode = 0x7f;         /* Fabrics */\ncmd.fabrics.fctype = 0x01;         /* Connect */\ncmd.connect.qid = 0;               /* admin */\ncmd.connect.sqsize = ...; cmd.connect.kato = 5000; /* ms */" },
      { layer: "conn", title: "Target 分配控制器",
        desc: "nvmet_execute_io_connect()：Target 校验 hostnqn/subnqn、分配 cntlid，把该连接挂到对应子系统；Admin 队列就绪，可发 Identify/Property 命令。",
        file: "drivers/nvme/target/fabrics.c", func: "nvmet_execute_io_connect", structs: ["nvmet_ctrl"] },
      { layer: "queue", title: "协商队列数 / KeepAlive",
        desc: "发 Set Features（队列数）、Property Set/Get 配控制器；kato 保活：Host 定时发 Keep Alive，超时 Target 删控制器防挂死。",
        file: "drivers/nvme/host/fabrics.c", func: "nvmf_set_queue_number", structs: ["nvmf_ctrl_options"],
        code: "nvme_set_queue_count(ctrl, &nr_queues);\n/* kato: nvme_keep_alive_work() 定时发送 Fabrics KeepAlive */" },
      { layer: "queue", title: "建 IO 队列连接",
        desc: "逐队列 nvmf_connect_io_queue()：每条 IO 队列再发一次 Connect (qid≥1)。RDMA 每队列一对 RC QP + 内存注册；TCP 每队列一个 socket + ICReq。",
        file: "drivers/nvme/host/fabrics.c", func: "nvmf_connect_io_queue",
        code: "for (qid = 1; qid <= nr_queues; qid++)\n    nvmf_connect_io_queue(ctrl, qid);  /* fctype=Connect, qid>=1 */" },
      { layer: "queue", title: "队列绑定 CPU / tagset",
        desc: "nvme_rdma_alloc_tagset() / nvme_tcp_alloc_tagset() 建 blk-mq tagset，再 blk_mq_map_queues() 绑 CPU：每核队列、无锁并发。",
        file: "drivers/nvme/host/rdma.c", func: "nvme_rdma_alloc_tagset", structs: ["blk_mq_tags"] },
      { layer: "ns", title: "Identify + 扫描命名空间",
        desc: "经 Capsule 发 Identify Controller/NS（CNS=1/0）：取 cntlid/subnqn/nsze/LBA 格式，再 nvme_alloc_ns() 建命名空间。",
        file: "drivers/nvme/host/core.c", func: "nvme_identify_ns", structs: ["nvme_id_ns", "nvme_ns"],
        code: "/* capsule 承载 admin 命令 */\nnvme_identify_ctrl(ctrl, &id);   /* cntlid / subnqn */\nnvme_identify_ns(ctrl, nsid, &id_ns); /* nsze / lbaf */" },
      { layer: "ns", title: "块设备就绪",
        desc: "device_add_disk() 后出现 /dev/nvmeXnY（如 /dev/nvme1n1），可挂载或直接读写；多路径按 subnqn/ANA 状态分组。",
        file: "drivers/nvme/host/core.c", func: "device_add_disk" }
    ]
  };

  // ===================== IO 路径公共层序 =====================
  const IO_ORDER = ["user", "syscall", "fs", "block", "sched", "host", "fabrics", "tr_ini", "net", "tr_tgt", "hw", "complete"];

  // ---- 上行公共（应用→块层），读写复用 ----
  const S_up = [
    { layer: "user", title: "应用发起 IO",
      desc: "用户进程调用 read()/write()/pread()/pwrite()，把 fd、用户缓冲与长度交给内核。",
      file: "(用户态)", func: "read(fd, buf, 4096) / write(fd, buf, 4096)", structs: [] },
    { layer: "syscall", title: "进入系统调用 / VFS",
      desc: "ksys_read/write() → vfs_read/write() → file->f_op->read_iter/write_iter()（块设备走 blkdev）。",
      file: "fs/read_write.c", func: "ksys_read → vfs_read → f_op->read_iter", structs: ["file", "kiocb"] },
    { layer: "fs", title: "文件系统 → bio",
      desc: "缓冲路径经 page cache + iomap 映射 LBA；O_DIRECT 绕过缓存直接组 bio。块设备直读走 blkdev_direct_IO。",
      file: "fs/iomap/direct-io.c", func: "iomap_dio_rw → submit_bio", structs: ["bio", "iomap"] },
    { layer: "block", title: "提交 bio 到块层",
      desc: "submit_bio() → submit_bio_noacct()，进入通用块层。",
      file: "block/blk-core.c", func: "submit_bio_noacct", structs: ["bio"] },
    { layer: "block", title: "blk-mq 分配 request + tag",
      desc: "blk_mq_submit_bio() 分配 request（含 tag），入每 CPU 软件队列；plug 攒批合并后待派发。",
      file: "block/blk-mq.c", func: "blk_mq_submit_bio", structs: ["request", "blk_mq_tags"] },
    { layer: "sched", title: "调度 / 派发到驱动",
      desc: "调度器裁决后 blk_mq_dispatch_rq_list() 调驱动 queue_rq：Fabrics 下即传输的 queue_rq（rdma/tcp）。",
      file: "block/blk-mq.c", func: "blk_mq_dispatch_rq_list", structs: ["blk_mq_hw_ctx"] },
    { layer: "host", title: "Host 编码 NVMe 命令",
      desc: "nvme_setup_cmd() → nvme_setup_rw()：填 opcode（Read 02h/Write 01h）、NSID、SLBA、NLB；与本地 NVMe 一致，之后交给 Fabrics 封装。",
      file: "drivers/nvme/host/core.c", func: "nvme_setup_cmd", structs: ["nvme_command", "nvme_ns"],
      code: "cmd->common.opcode = nvme_cmd_read;   /* 0x02, 写为 0x01 */\ncmd->common.nsid = ns->head->ns_id;\ncmd->rw.slba = cpu_to_le64(...);\ncmd->rw.length = cpu_to_le16(...);" }
  ];

  // ---- Fabrics 封装（读写复用）----
  const S_fab = [
    { layer: "fabrics", title: "组装 Fabrics Capsule",
      desc: "把 SQE 装进命令胶囊 (Command Capsule)：SQE + 内联数据/分散表；CID 用于配对响应。RDMA 另备 SGL/密钥，TCP 另定 PDU 头。",
      file: "drivers/nvme/host/fabrics.c", func: "nvmf_capsule_cmd", structs: ["nvme_command", "nvmf_connect_command"],
      code: "/* Command Capsule = SQE(64B) + 数据/SGL */\n/* cid = blk_mq tag; 响应原样带回配对 */" }
  ];

  // ---- RDMA 下行（读场景用）----
  const S_rdma = [
    { layer: "tr_ini", title: "RDMA 发起端入队发送",
      desc: "nvme_rdma_queue_rq()：取一对 Send/Recv WR，把 Capsule 经 IB_SEND 发出；大数据先注册 MR（ib_reg_mr），把 rkey/addr 填进 SGL 供 Target 直写/直读。",
      file: "drivers/nvme/host/rdma.c", func: "nvme_rdma_queue_rq", structs: ["nvme_rdma_queue"],
      code: "ib_post_send(qp, &wr, NULL);   /* SEND: command capsule */\n/* 读: 提供 rkey+addr, Target 用 RDMA WRITE 把数据直写主机 */" },
    { layer: "net", title: "RDMA 网络 (RC QP)",
      desc: "RC 可靠连接：Command Capsule 走 SEND；读数据 Target 用 RDMA WRITE 回主机、写数据 Target 用 RDMA READ 拉主机；完成走 RDMA SEND（Response Capsule）。",
      file: "(IB/RoCE 网络)", func: "SEND / RDMA_WRITE / RDMA_READ", structs: [] },
    { layer: "tr_tgt", title: "Target 收包并执行 (nvmet-rdma)",
      desc: "nvmet-rdma 收 SEND 取出 SQE → nvmet_req_execute()：读则从后端盘取数、RDMA WRITE 回 Host；写则 RDMA READ 拉数再落盘。",
      file: "drivers/nvme/target/rdma.c", func: "nvmet_rdma_queue_response", structs: ["nvmet_req", "nvmet_ns"],
      code: "/* 读: backend_read() -> ib_post_send(RDMA WRITE) */\n/* 写: ib_post_send(RDMA READ) -> backend_write() */" },
    { layer: "hw", title: "Target 后端存储执行",
      desc: "nvmet_bdev_execute_rw() 走块后端（bdev/file）：submit_bio 到 Target 本地盘/SSD；ZNS/文件后端同理，最终数据落介质。",
      file: "drivers/nvme/target/io.c", func: "nvmet_bdev_execute_rw", structs: ["nvmet_ns"] },
    { layer: "tr_tgt", title: "Target 回 Response Capsule",
      desc: "执行完组装响应胶囊（含 CQE + CID + 状态），经 SEND 发回 Host；CID 与命令胶囊一致，Host 靠它找原 request。",
      file: "drivers/nvme/target/rdma.c", func: "nvmet_rdma_queue_response", structs: ["nvme_completion"] },
    { layer: "complete", title: "Host 收完成 (RDMA CQ)",
      desc: "nvme_rdma_process_cq() 从 IB CQ 取完成 → 找到 response capsule → blk_mq_complete_request() → blk_mq_end_request()。",
      file: "drivers/nvme/host/rdma.c", func: "nvme_rdma_process_cq",
      code: "ib_poll_cq(cq, ...);   /* 取 SEND/WRITE 完成 */\nblk_mq_complete_request(req);" },
    { layer: "complete", title: "bio_endio 唤醒进程",
      desc: "bio_endio() 完成 bio、解锁页，最终唤醒等待进程，read/write 返回用户态。",
      file: "block/bio.c", func: "bio_endio" }
  ];

  // ---- TCP 下行（写场景用）----
  const S_tcp = [
    { layer: "tr_ini", title: "TCP 组装命令 PDU",
      desc: "nvme_tcp_setup_cmd_pdu()：Capsule 外加 TCP 传输头——PDU Type=Cmd(01h)、HLEN/PLEN、CID；写数据小包可内联，大包后续用 H2CData PDU 补发。",
      file: "drivers/nvme/host/tcp.c", func: "nvme_tcp_setup_cmd_pdu", structs: ["nvme_tcp_pdu"],
      code: "pdu->type = NVME_TCP_CMD;   /* 01h Command Capsule */\npdu->hlen = sizeof(*pdu); pdu->plen = hlen + datalen;\npdu->cccid = req->tag;         /* 配对用 */" },
    { layer: "tr_ini", title: "TCP 发送 (socket)",
      desc: "nvme_tcp_try_send() 经 kernel socket 发出：Cmd PDU 先行；写大数据再发 H2CData PDU。读则等 Target 的 C2HData PDU 送数回来。",
      file: "drivers/nvme/host/tcp.c", func: "nvme_tcp_try_send", structs: ["nvme_tcp_queue"] },
    { layer: "net", title: "TCP 网络 (PDU 流)",
      desc: "TCP 字节流承载 PDU：ICReq/ICResp（建连握手）→ Cmd Capsule → H2CData（Host→Ctrl 数据）/ C2HData（Ctrl→Host 数据）→ Rsp Capsule。无 RDMA 卸载，全靠 CPU 拷包。",
      file: "(TCP/IP 网络)", func: "Cmd / H2CData / C2HData / Rsp PDU", structs: ["nvme_tcp_pdu"] },
    { layer: "tr_tgt", title: "Target 解析 PDU 并执行",
      desc: "nvmet-tcp 按 PDU 头收包：Cmd→取出 SQE 执行；写缺数据则发 R2T/等 H2CData；读则回 C2HData+Rsp。后端同样走 nvmet_bdev_execute_rw()。",
      file: "drivers/nvme/target/tcp.c", func: "nvmet_tcp_handle_h2c_data_pdu", structs: ["nvmet_req"] },
    { layer: "hw", title: "Target 后端存储执行",
      desc: "nvmet_bdev_execute_rw() 走块后端落盘；写需保证数据齐（H2CData 收全）才回成功，FUA/Flush 直通后端。",
      file: "drivers/nvme/target/io.c", func: "nvmet_bdev_execute_rw", structs: ["nvmet_ns"] },
    { layer: "tr_tgt", title: "Target 回 Rsp PDU",
      desc: "组装 Response Capsule PDU（Type=04h，含 CQE），经 socket 发回；读另先发 C2HData PDU 带数据。",
      file: "drivers/nvme/target/tcp.c", func: "nvmet_tcp_queue_response", structs: ["nvme_completion"] },
    { layer: "complete", title: "Host 收完成 (TCP socket)",
      desc: "nvme_tcp_process_cqe() 从 socket 读 Rsp PDU → 配对 request → blk_mq_complete_request() → blk_mq_end_request()（软中断收尾）。",
      file: "drivers/nvme/host/tcp.c", func: "nvme_tcp_process_cqe" },
    { layer: "complete", title: "bio_endio 唤醒进程",
      desc: "bio_endio() 完成 bio、解锁页，唤醒进程返回用户态。",
      file: "block/bio.c", func: "bio_endio" }
  ];

  // ===== 读场景（RDMA）=====
  const read = {
    key: "read", name: "主机读 (NVMe/RDMA)", cmd: "read (RDMA)",
    blurb: "read() → blk-mq → Fabrics Capsule → RDMA SEND/WRITE → nvmet 读盘 → Response Capsule 返回。输入 transport tcp 可对照 TCP 差异。",
    order: IO_ORDER,
    steps: S_up.concat(S_fab).concat(S_rdma)
  };

  // ===== 写场景（TCP）=====
  const write = {
    key: "write", name: "主机写 (NVMe/TCP)", cmd: "write (TCP)",
    blurb: "write() → blk-mq → Cmd PDU → H2CData → nvmet 落盘 → Rsp PDU。写大数据看 H2CData，FUA/Flush 直通后端。",
    order: IO_ORDER,
    steps: S_up.concat(S_fab).concat(S_tcp)
  };

  // ===== io_uring over Fabrics =====
  const iouring = {
    key: "iouring", name: "io_uring over Fabrics", cmd: "io_uring",
    blurb: "共享 SQ/CQ 环批量提交，经同一 Fabrics+传输路径下发；高并发下更易打满 RDMA QP / TCP socket。",
    order: IO_ORDER,
    steps: [
      { layer: "user", title: "填充 SQ ring",
        desc: "应用把 SQE 写入共享提交环，一次 io_uring_enter() 批量提交多个读写。",
        file: "io_uring/io_uring.c", func: "io_uring_enter", structs: ["io_uring_sqe"] },
      { layer: "syscall", title: "内核收割 SQE",
        desc: "io_submit_sqes() 批量取出 SQE，转 io_kiocb 分派到 read/write。",
        file: "io_uring/rw.c", func: "io_submit_sqes → io_read/io_write", structs: ["io_kiocb"] },
      { layer: "fs", title: "进入读/写路径",
        desc: "与同步路径共用文件系统与块层：iomap → submit_bio → blk-mq，之后走 Fabrics。",
        file: "io_uring/rw.c", func: "io_rw → submit_bio" }
    ].concat(S_up.slice(3)).concat(S_fab).concat(S_rdma).concat([
      { layer: "complete", title: "完成写入共享 CQ ring",
        desc: "传输收完 Response 后按 io_kiocb 回填 CQE 到共享完成环，应用零 syscall 批量收割。",
        file: "io_uring/io_uring.c", func: "io_uring_cqe" }
    ])
  };

  const scenarios = { init: init, read: read, write: write, iouring: iouring };
  const scenarioList = [init, read, write, iouring];

  return { KERNELS: KERNELS, LAYERS: LAYERS, scenarios: scenarios, scenarioList: scenarioList };
})();
