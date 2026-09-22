# NVMe-oF 链路技术文档

> 配合互动教学平台（`public/`）的讲解稿：Host → Fabrics → RDMA/TCP → nvmet → 后端盘。

## 1. 总览

```
应用 read()/write()
  → VFS → iomap → submit_bio → blk-mq (request/tag = CID)
  → nvme_setup_cmd (opcode Read 02h / Write 01h, NSID/SLBA/NLB)
  → Fabrics Capsule (SQE 64B + 数据/SGL, CID 配对)
  → RDMA: SEND / RDMA_WRITE / RDMA_READ   或   TCP: Cmd/H2CData/C2HData/Rsp PDU
  → nvmet (nvmet-rdma / nvmet-tcp) → nvmet_bdev_execute_rw → 后端盘
  → Response Capsule / Rsp PDU (CQE + CID)
  → blk_mq_complete_request → bio_endio → 唤醒进程
```

## 2. 发现与连接（Discovery + Connect）

1. Host `modprobe nvme-rdma / nvme-tcp`，向 `nvmf_transport` 注册传输。
2. Target 起 `nvmet` 子系统 + port（trtype/traddr/trsvcid），开始监听。
3. Host `nvme discover` 连 Discovery 控制器，发 Get Log Page（LID 02h）拿 `numrec`：
   每条含 `subnqn / trtype / adrfam / traddr / trsvcid`。
4. `nvmf_parse_options()` 选传输与目标，`nvmf_create_ctrl()` 建 Admin 队列
   （RDMA：RC QP + 内存注册；TCP：socket + ICReq/ICResp 握手）。
5. 发 Fabrics Connect（opcode 7Fh，fctype 01h，qid=0，sqsize，kato），
   Target `nvmet_execute_io_connect()` 校验 NQN、分配 `cntlid`。
6. 逐 IO 队列 `nvmf_connect_io_queue()`（qid≥1），协商队列数、建 tagset、绑 CPU。
7. Capsule 发 Identify（Controller/NS），`nvme_alloc_ns()` + `device_add_disk()`，
   出现 `/dev/nvmeXnY`。

## 3. RDMA 数据路径（读为主）

- `nvme_rdma_queue_rq()`：注册 MR 拿 `rkey`，`ib_post_send` 发 Command Capsule。
- 读：Target 从后端取数后，用 **RDMA WRITE** 直接写主机内存（零拷贝），再 SEND Response。
- 写：Target 用 **RDMA READ** 从主机把数据拉走，再落盘，再 SEND Response。
- Host `nvme_rdma_process_cq()` 轮询 IB CQ，按 CID 找原 request 完成。

## 4. TCP 数据路径（写为主）

- `nvme_tcp_setup_cmd_pdu()`：Capsule 外包 PDU 头（Type/HLEN/PLEN/cccid）。
- PDU 类型：ICReq/ICResp（建连）→ Cmd(01h) → H2CData(02h，写数) /
  C2HData(03h，读数) → Rsp(04h，响应）。
- 写大包：Cmd 先行，数据后续 H2CData 补发；读：Target 回 C2HData + Rsp。
- Host `nvme_tcp_process_cqe()` 从 socket 读 Rsp，按 cccid 配对完成。
- 无卸载，全 CPU 拷包；可用 digest 保证完整性。

## 5. 关键结构体速查

- `nvmf_ctrl_options`：trtype/traddr/trsvcid/subsysnqn/hostnqn/kato。
- `nvmf_connect_command`：opcode 7Fh / fctype 01h / qid / sqsize / kato。
- `nvme_rdma_queue`：qp / cq / mr(rkey)；`nvme_tcp_queue`：sock / cccid 映射。
- `nvmet_req`：Target 侧请求；`nvmet_ns`：bdev/file 后端。
- `request.tag` 即 Fabrics CID，命令与响应靠它配对。

## 6. 内核版本差异（4.19–6.8）

- 4.19：Fabrics/TCP 尚不成熟（TCP transport 5.x 才可用），folio 未引入。
- 5.x：`readpage/readpages` → `read_folio/readahead`，单位 page → folio。
- 5.9+：`generic_make_request` → `submit_bio_noacct`。
- 6.x：`filemap_read` + folio 为主路径；NVMe-oF 多路径/ANA、KeepAlive 完善。
