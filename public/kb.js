/* NVMe-oF 互动教学 —— 知识库 */
(function () {
  const A = (window.APP_DATA = window.APP_DATA || {});

  /* ================= 简化关键结构体 ================= */
  A.STRUCTS = {
    file: `struct file {                  /* 打开的文件 / 块设备 */
    struct path f_path;
    struct inode *f_inode;
    const struct file_operations *f_op;
    unsigned int f_flags;           /* O_DIRECT / O_SYNC ... */
    ...
};`,
    kiocb: `struct kiocb {                 /* 一次 IO 的上下文 */
    struct file *ki_filp;
    loff_t ki_pos;
    void (*ki_complete)(struct kiocb *, long, long);
    ...
};`,
    iomap: `struct iomap {                 /* 逻辑偏移 -> 物理映射 */
    u64   addr;
    loff_t offset;
    u64   length;
    u16   type;                     /* IOMAP_MAPPED / HOLE ... */
    ...
};`,
    bio: `struct bio {                   /* 块层 IO 请求 */
    struct block_device *bi_bdev;
    struct bvec_iter bi_iter;       /* bi_sector / bi_size */
    unsigned int bi_opf;            /* REQ_OP_READ/WRITE, FUA */
    struct bio_vec bi_inline_vecs[];
};`,
    request: `struct request {               /* blk-mq 请求(带 tag) */
    struct request_queue *q;
    struct blk_mq_hw_ctx *mq_hctx;
    unsigned int tag;              /* = Fabrics CID */
    struct bio *bio;
    ...
};`,
    blk_mq_tags: `struct blk_mq_tags {           /* tag 池 */
    unsigned int nr_tags;
    struct sbitmap bitmap;
    struct request **rqs;
    ...
};`,
    blk_mq_hw_ctx: `struct blk_mq_hw_ctx {         /* 硬件派发队列 */
    struct blk_mq_tags *tags;
    struct request_queue *queue;
    ...
};`,
    nvme_command: `struct nvme_command {          /* SQE (64B)，Fabrics 复用 */
    __u8  opcode;   __u8  flags;
    __le16 command_id;  __le16 nsid;
    __le32 cdw2[2]; __le64 metadata;
    __le64 prp1;    __le64 prp2;    /* Fabrics 下多为 SGL 描述 */
    union { struct nvme_rw_command rw; ... };
};`,
    nvme_completion: `struct nvme_completion {       /* CQE (16B) */
    __le32 result;
    __le16 sq_head;  __le16 sq_id;
    __le16 command_id;              /* = CID，原样返回配对 */
    __le16 status;                  /* 含 phase / 状态码 */
};`,
    nvmf_ctrl_options: `struct nvmf_ctrl_options {       /* connect 参数 */
    char *trtype;     /* "rdma" / "tcp" / "fc" */
    char *traddr;     /* 目标地址 */
    char *trsvcid;    /* 端口，如 4420 / 8009 */
    char *subsysnqn;  /* 目标子系统 NQN */
    char *hostnqn;    /* 本机 Host NQN */
    u32 kato;         /* keep-alive 超时 (ms) */
    ...
};`,
    nvmf_transport_ops: `struct nvmf_transport_ops {   /* drivers/nvme/host/fabrics.h */
    int (*create_ctrl)(struct device *dev,
                       struct nvmf_ctrl_options *opts);
    ...
};
/* rdma: nvme_rdma_transport; tcp: nvme_tcp_transport */`,
    nvmf_connect_command: `struct nvmf_connect_command {    /* Fabrics Connect */
    __u8 opcode;    /* 0x7f Fabrics */
    __u8 fctype;    /* 0x01 Connect, 0x02 Property Set ... */
    __le16 qid;     /* 队列 ID：0=Admin, >=1 IO */
    __le16 sqsize;  /* 提交队列深度 */
    char hostnqn[256];
    char subsysnqn[256];
    __le32 kato;    /* keep-alive (ms) */
    ...
};`,
    nvmf_disc_rsp_page_hdr: `struct nvmf_disc_rsp_page_hdr {   /* include/linux/nvme.h */
    __le64 genctr;                  /* 世代计数 */
    __le64 numrec;                  /* 条目数 */
    struct nvmf_disc_rsp_page_entry entries[];
    /* 每条: subnqn / trtype / adrfam / traddr / trsvcid */
};`,
    nvme_ctrl: `struct nvme_ctrl {             /* Host 侧控制器 */
    struct device *dev;
    u16  cntlid;                    /* Target 分配的控制器 ID */
    char subnqn[256];
    char hostnqn[256];
    u32 kato;
    ...
};`,
    nvme_ns: `struct nvme_ns {               /* 命名空间 */
    struct nvme_ctrl *ctrl;
    u32 ns_id;
    u8  lba_shift;
    struct gendisk *disk;           /* -> /dev/nvmeXnY */
    ...
};`,
    nvme_id_ns: `struct nvme_id_ns {
    __le64 nsze;                    /* 容量(逻辑块) */
    __le64 ncap;
    __u8   lbaf[16];                /* LBA 格式表 */
    ...
};`,
    nvme_rdma_queue: `struct nvme_rdma_queue {         /* RDMA 发起端队列 */
    struct ib_qp *qp;               /* RC QP */
    struct ib_cq *cq;               /* 完成队列 */
    struct ib_mr *mr;               /* 注册内存 (rkey) */
    u16 qid; u16 queue_size;
    ...
};`,
    nvme_tcp_queue: `struct nvme_tcp_queue {          /* TCP 发起端队列 */
    struct socket *sock;            /* 每 IO 队列一个 socket */
    u16 qid;
    struct nvme_tcp_request *reqs;  /* CID -> request 映射 */
    ...
};`,
    nvme_tcp_hdr: `struct nvme_tcp_hdr {              /* include/linux/nvme-tcp.h */
    __u8 type;   /* 00 ICReq, 01 Cmd, 02 H2CData, 03 C2HData, 04 Rsp */
    __u8 flags;  __u8 hlen; __u8 pdo;
    __le32 plen; /* PDU 总长 */
};
/* 同文件还有: nvme_tcp_cmd_pdu / nvme_tcp_data_pdu / nvme_tcp_rsp_pdu */`,
    nvmet_subsys: `struct nvmet_subsys {            /* Target 子系统 */
    char subsysnqn[256];
    struct list_head ctrls;
    struct list_head namespaces;
    ...
};`,
    nvmet_port: `struct nvmet_port {              /* Target 监听端口 */
    char trtype[8];   /* rdma / tcp */
    char traddr[64];  char trsvcid[32];
    struct list_head subsystems;
    ...
};`,
    nvmet_ctrl: `struct nvmet_ctrl {              /* Target 侧连接 */
    u16 cntlid;
    char hostnqn[256];
    char subsysnqn[256];
    u16 qid;
    ...
};`,
    nvmet_req: `struct nvmet_req {               /* Target 侧请求 */
    struct nvmet_ctrl *ctrl;
    struct nvmet_ns *ns;
    struct nvme_command *cmd;       /* 取自 Capsule/PDU */
    void (*execute)(struct nvmet_req *);
    ...
};`,
    nvmet_ns: `struct nvmet_ns {                /* Target 后端命名空间 */
    u32 nsid;
    struct block_device *bdev;      /* bdev 后端 */
    char *file_path;                /* file 后端 */
    ...
};`,
    io_uring_sqe: `struct io_uring_sqe {
    __u8  opcode;               /* IORING_OP_READ / WRITE */
    __s32 fd;
    __u64 off;   __u64 addr;
    __u32 len;
    __u64 user_data;
    ...
};`,
    io_kiocb: `struct io_kiocb {
    struct file *file;
    u8 opcode;
    union { struct io_rw rw; ... };
    ...
};`
  };

  /* ================= 模块框图箭头标签 ================= */
  A.ARROW_LABELS = {
    syscall: "系统调用", fs: "kiocb", block: "bio",
    sched: "request", host: "request → SQE", fabrics: "SQE → Capsule",
    tr_ini: "Capsule/PDU", net: "SEND/PDU", tr_tgt: "网络到达",
    hw: "后端 IO", complete: "CQE / 回包",
    disc: "Discovery", conn: "Connect", queue: "Create IO Q", ns: "NSID / gendisk"
  };

  /* ================= 关键代码逻辑 ================= */
  A.LOGIC = {
    "加载 Host 传输模块": `modprobe nvme-rdma;  modprobe nvme-tcp;
nvmf_register_transport(&nvme_rdma_transport);
/* .create_ctrl = nvme_rdma_create_ctrl */
/* tcp: nvmf_register_transport(&nvme_tcp_transport); */`,
    "Target 侧就绪 (nvmet)": `modprobe nvmet nvmet-tcp   # 或 nvmet-rdma
nvmet create-subsys nqn.test
nvmet create-ns 1 --bdev /dev/sda
nvmet create-port 1 -t tcp -a 192.168.1.10 -s 8009`,
    "发起 Discovery": `nvme discover -t tcp -a 192.168.1.10 -s 8009
/* 先建 Discovery 控制器 (well-known NQN) */
ctrl = nvmf_create_ctrl(dev, opts);
/* 随后发 Get Log Page (LID=02h) 取条目，见下一步 */`,
    "Discovery Admin 连接": `/* RDMA: 建 RC QP + 注册 Admin 内存 */
nvme_rdma_configure_admin_queue(ctrl);
/* TCP: 建 socket + ICReq/ICResp 握手 */
nvme_tcp_create_queue(ctrl, 0);`,
    "获取 Discovery Log": `nvme_get_log(ctrl, nsid, NVME_LOG_DISC, ...);
  /* opcode = nvme_admin_get_log_page (02h), lid = 02h discovery */
/* entries[i]: subnqn / trtype / traddr / trsvcid */`,
    "解析连接参数": `nvmf_parse_options(opts);
/* trtype=tcp, traddr=192.168.1.10, trsvcid=8009 */
/* subsysnqn=nqn.test, hostnqn=nqn.host1 */`,
    "建 Admin 队列 (业务子系统)": `ctrl = nvmf_create_ctrl(dev, opts);
  -> transport->create_ctrl();   /* rdma/tcp 建 QP 或 socket */`,
    "Fabrics Connect 命令": `cmd.fabrics.opcode = 0x7f;      /* Fabrics */
cmd.fabrics.fctype  = 0x01;      /* Connect */
cmd.connect.qid     = 0;         /* Admin */
cmd.connect.sqsize  = queue_depth;
cmd.connect.kato    = 5000;      /* keep-alive ms */`,
    "Target 分配控制器": `nvmet_execute_io_connect(req)
{
    /* 校验 hostnqn / subsysnqn */
    ctrl->cntlid = ida_alloc(...);   /* 分配控制器 ID */
    list_add(&ctrl->queue, &subsys->ctrls);
}`,
    "协商队列数 / KeepAlive": `nvme_set_queue_count(ctrl, &nr_queues);  /* Set Features 定队列数 */
/* kato: 定时发 Fabrics KeepAlive，超时 Target 删控制器 */`,
    "建 IO 队列连接": `for (qid = 1; qid <= nr_queues; qid++)
    nvmf_connect_io_queue(ctrl, qid);
/* 每个 qid 一次 Connect；RDMA=一对 QP，TCP=一个 socket */`,
    "队列绑定 CPU / tagset": `nvme_alloc_io_tag_set(ctrl, &ctrl->tag_set, &ops, nr_queues, 0);
blk_mq_map_queues(&ctrl->tagset);   /* 每核队列 (rdma/tcp 共用) */`,
    "Identify + 扫描命名空间": `/* Capsule 承载 admin 命令 */
nvme_identify_ctrl(ctrl, &id);        /* cntlid / subnqn */
nvme_identify_ns(ctrl, nsid, &id_ns); /* nsze / lbaf */
nvme_alloc_ns(ctrl, nsid, ...);`,
    "块设备就绪": `device_add_disk(disk, ns);
/* 出现 /dev/nvme1n1；多路径按 subnqn + ANA 分组 */`,

    "应用发起 IO": `char *buf = malloc(4096);
read(fd, buf, 4096);    /* 或 write(fd, buf, 4096); */`,
    "进入系统调用 / VFS": `ksys_read() -> vfs_read()
  -> file->f_op->read_iter(file, kiocb, iter);`,
    "文件系统 → bio": `/* O_DIRECT */ iomap_dio_rw() -> submit_bio(bio);
/* 缓冲 */ filemap_read()/writepages() -> submit_bio(bio);`,
    "提交 bio 到块层": `submit_bio(bio);   /* -> submit_bio_noacct() */`,
    "blk-mq 分配 request + tag": `req = blk_mq_alloc_request(q, op, ...);
req->tag = sbitmap_queue_get(&tags->bitmap);  /* = Fabrics CID */
blk_mq_sched_insert_request(req);`,
    "调度 / 派发到驱动": `blk_mq_dispatch_rq_list(hctx, &list, false);
  -> q->mq_ops->queue_rq(hctx, &bd);
/* Fabrics: nvme_rdma_queue_rq / nvme_tcp_queue_rq */`,
    "Host 编码 NVMe 命令": `cmd->common.opcode = nvme_cmd_read;   /* 02h, 写 01h */
cmd->common.nsid   = ns->head->ns_id;
cmd->rw.slba  = cpu_to_le64(blk_rq_pos(req) >> (ns->lba_shift - 9));
cmd->rw.length = cpu_to_le16((blk_rq_bytes(req) >> ns->lba_shift) - 1);`,
    "组装 Fabrics Capsule": `/* Command Capsule = SQE(64B) + SGL */
nvme_rdma_map_data(queue, rq);   /* RDMA: 注册 MR，填 rkey/addr */
nvme_tcp_map_data(queue, rq);    /* TCP: 映射内存，准备分 PDU 发送 */
/* cid = blk_mq tag; 响应原样带回配对 */`,

    "RDMA 发起端入队发送": `nvme_rdma_queue_rq(hctx, bd)
{
    ib_reg_mr(...);              /* 注册内存拿 rkey (大数据) */
    ib_post_send(qp, &wr, NULL); /* SEND: command capsule */
}
/* 读: Target 稍后 RDMA WRITE 回主机；写: Target RDMA READ 拉主机 */`,
    "RDMA 网络 (RC QP)": `SEND:        Host -> Target (Command Capsule)
RDMA WRITE:  Target -> Host (读数据直写主机内存)
RDMA READ:   Target -> Host (把写数据从主机拉走)
SEND:        Target -> Host (Response Capsule)`,
    "Target 收包并执行 (nvmet-rdma)": `nvmet_rdma_queue_response(req)
  -> nvmet_req_execute(req);
     /* 读: backend_read() -> RDMA WRITE 回 Host */
     /* 写: RDMA READ 拉数 -> backend_write() */`,
    "Target 后端存储执行": `nvmet_bdev_execute_rw(req)
{
    submit_bio(bio);   /* 落到 Target 本地盘/SSD */
}`,
    "Target 回 Response Capsule": `/* Response Capsule = CQE(16B) + 状态 */
cqe.command_id = cmd.command_id;   /* CID 配对 */
cqe.status = NVME_SC_SUCCESS;
ib_post_send(qp, &rsp_wr, NULL);    /* SEND 发回 */`,
    "Host 收完成 (RDMA CQ)": `/* IB CQ 到完成 → 按 CID 找原 request */
static void nvme_rdma_complete_rq(struct request *rq)
{
    ...
    nvme_complete_rq(rq);          /* -> blk_mq 收尾 */
}`,
    "bio_endio 唤醒进程": `blk_update_request(req, error, nr_bytes);
bio_endio(req->bio);   /* 解锁 folio / 唤醒进程 */`,

    "TCP 组装命令 PDU": `nvme_tcp_setup_cmd_pdu(req);
pdu->type = NVME_TCP_CMD;            /* 01h */
pdu->hlen = sizeof(cmd_pdu); pdu->plen = hlen + datalen;
pdu->cccid = req->tag;`,
    "TCP 发送 (socket)": `nvme_tcp_try_send(queue);
  sock_sendmsg(sock, ...);   /* Cmd PDU 先行 */
  /* 写大数据: 续发 H2CData PDU；读: 等 C2HData */`,
    "TCP 网络 (PDU 流)": `ICReq / ICResp : 建连握手 (每队列一次)
Cmd (01h)    : Host -> Target 命令胶囊
H2CData (02h): Host -> Target 写数据
C2HData (03h): Target -> Host 读数据
Rsp (04h)    : Target -> Host 响应胶囊`,
    "Target 解析 PDU 并执行": `nvmet_tcp_handle_h2c_data_pdu()  /* 收写数据 */
nvmet_req_execute()              /* 读盘/落盘 */
nvmet_tcp_queue_response()       /* 回 Rsp；读另发 C2HData */`,
    "Target 回 Rsp PDU": `pdu->type = NVME_TCP_RSP;   /* 04h */
pdu->rcccid = cmd.cccid;         /* 配对 */
sock_sendmsg(sock, ...);`,
    "Host 收完成 (TCP socket)": `/* 从 socket 读 Rsp PDU，按 cccid 找原 request */
void nvme_complete_rq(struct request *req)
{
    blk_mq_complete_request(req);  /* rdma/tcp 共用收尾 */
}`,

    "填充 SQ ring": `struct io_uring_sqe *sqe = io_uring_get_sqe(&ring);
io_uring_prep_read(sqe, fd, buf, 4096, offset);
io_uring_submit(&ring);        /* -> io_uring_enter() */`,
    "内核收割 SQE": `io_uring_enter() -> io_submit_sqes();
    for (each sqe) io_issue_sqe() -> io_read()/io_write();`,
    "进入读/写路径": `io_read() -> 复用 FS + 块层：
    iomap -> submit_bio() -> blk-mq -> Fabrics`,
    "完成写入共享 CQ ring": `/* 传输收完 Response，按 user_data 回填共享 CQ 环 */
io_uring_cqe = ...;   /* 应用零 syscall 批量收割 */`
  };

  /* ================= 协议字段表 ================= */
  A.FIELDS = {
    nvmf_connect_command: [
      { n: "opcode", b: "1B @0", d: "0x7F = Fabrics 命令" },
      { n: "fctype", b: "1B @1", d: "01h=Connect, 02h=Property Set, 00h=Property Get" },
      { n: "qid", b: "2B @2", d: "队列 ID：0=Admin，≥1 为 IO 队列" },
      { n: "sqsize", b: "2B", d: "提交队列深度（期望值）" },
      { n: "hostnqn", d: "Host NQN，用于 Target 准入/多路径识别" },
      { n: "subsysnqn", d: "目标子系统 NQN，决定挂到哪个 subsys" },
      { n: "kato", d: "Keep-Alive 超时 (ms)，0=不保活" },
      { n: "cntlid (响应)", d: "Target 分配的控制器 ID" }
    ],
    nvmf_disc_rsp_page_hdr: [
      { n: "genctr", d: "世代计数：日志变化一次加一" },
      { n: "numrec", d: "日志条目数" },
      { n: "subnqn", d: "可连接的子系统 NQN" },
      { n: "trtype", d: "传输类型：rdma / tcp / fc" },
      { n: "adrfam", d: "地址族：ipv4 / ipv6 / ib" },
      { n: "traddr / trsvcid", d: "目标地址与服务端口（如 4420/8009）" }
    ],
    nvme_tcp_hdr: [
      { n: "ICReq/ICResp", b: "建连", d: "TCP 建连握手：协商 PDU 版本、队列深度、digest" },
      { n: "Cmd (01h)", b: "H->C", d: "命令胶囊：SQE + cccid，写小包可内联数据" },
      { n: "H2CData (02h)", b: "H->C", d: "写数据：cccid + data_offset + data_length" },
      { n: "C2HData (03h)", b: "C->H", d: "读数据：cccid + 数据载荷" },
      { n: "Rsp (04h)", b: "C->H", d: "响应胶囊：CQE + rcccid，用于配对原命令" },
      { n: "cccid", d: "命令配对 ID = blk-mq tag，响应原样返回" }
    ],
    nvme_command: [
      { n: "opcode", b: "1B @0", d: "Read=0x02 / Write=0x01 / Flush=0x00，Fabrics 复用" },
      { n: "command_id", b: "2B @2", d: "CID = blk-mq tag，配对 Response" },
      { n: "nsid", b: "4B @4", d: "命名空间 ID" },
      { n: "cdw10/11", b: "8B @40", d: "SLBA 起始逻辑块" },
      { n: "cdw12", b: "4B @48", d: "NLB(块数-1) + FUA 等标志" }
    ],
    nvme_completion: [
      { n: "command_id", b: "2B @12", d: "CID，原样返回配对" },
      { n: "status", b: "2B @14", d: "状态码：Success=0，错误含 DNR/重试信息" }
    ],
    nvme_rdma_queue: [
      { n: "qp", d: "RC 可靠连接 QP，每 IO 队列一对" },
      { n: "cq", d: "IB 完成队列，轮询 SEND/WRITE/READ 完成" },
      { n: "mr / rkey", d: "注册内存密钥，Target 凭它直读写主机内存" },
      { n: "qid / queue_size", d: "队列 ID / 深度" }
    ]
  };

  /* ================= 字节布局条 ================= */
  A.LAYOUT = {
    nvme_completion: [
      { f: "result", w: 4 }, { f: "rsvd", w: 4 }, { f: "sq_head", w: 2 },
      { f: "sq_id", w: 2 }, { f: "cid", w: 2 }, { f: "status", w: 2 }
    ]
  };

  /* ================= 寄存器 / 管理命令字段（按步骤标题） ================= */
  A.PROTO = {
    "Fabrics Connect 命令": [
      { n: "opcode", b: "0x7F", d: "Fabrics 命令大类" },
      { n: "fctype", b: "01h", d: "Connect：建 Admin(qid=0)/IO(qid≥1) 连接" },
      { n: "qid", d: "队列 ID，Admin=0，IO 从 1 开始" },
      { n: "sqsize", d: "期望的提交队列深度" },
      { n: "kato", d: "Keep-Alive 超时 (ms)" }
    ],
    "获取 Discovery Log": [
      { n: "LID", b: "02h", d: "Get Log Page：Discovery 日志页" },
      { n: "numrec", d: "返回条目数，每条含 subnqn/trtype/traddr" }
    ],
    "TCP 组装命令 PDU": [
      { n: "Type", b: "01h", d: "Cmd：命令胶囊 PDU" },
      { n: "HLEN/PLEN", d: "头长 / PDU 总长" },
      { n: "cccid", d: "配对 ID = blk-mq tag" }
    ],
    "TCP 网络 (PDU 流)": [
      { n: "ICReq/ICResp", d: "建连握手：版本、队列深度、digest 协商" },
      { n: "Cmd/H2C/C2H/Rsp", d: "01h 命令 / 02h 写数 / 03h 读数 / 04h 响应" }
    ],
    "RDMA 网络 (RC QP)": [
      { n: "SEND", d: "传 Capsule（命令/响应胶囊）" },
      { n: "RDMA WRITE", d: "Target→Host：读数据直写主机（零拷贝）" },
      { n: "RDMA READ", d: "Target 从 Host 拉写数据（零拷贝）" }
    ],
    "建 IO 队列连接": [
      { n: "qid ≥ 1", d: "每条 IO 队列一次 Connect" },
      { n: "RDMA", d: "每队列一对 RC QP + 内存注册" },
      { n: "TCP", d: "每队列一个 socket + ICReq" }
    ]
  };
})();
