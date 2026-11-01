# Cài server Whisper (speaches) dự phòng

Robot dùng Whisper để chuyển giọng nói thành chữ (`reply` / `ask` / `qa`, mic robot lẫn mic dashboard). Server
Whisper là container **speaches** (API kiểu OpenAI: `/v1/audio/transcriptions`). Connection loại **Voices**
(`whisper`) có nhiều server theo thứ tự dự phòng: server đầu lỗi / hết GPU thì lời gọi chuyển sang server sau
(xem `CLAUDE.md` → *AI servers: vlms / visions / voices, with fallback*).

| Máy | Địa chỉ | Vai trò |
|---|---|---|
| Dev PC (RTX 3090) | `http://192.168.0.6:8000` | server chính |
| A6000 (`ketiserver`, `trung@10.252.205.103`) | `https://whisper.aistations.org` (tunnel), `http://10.252.205.103:8000` (LAN) | server dự phòng, đã cài 2026-10-21 (hướng dẫn dưới đây) |

## Cấu hình đang chạy trên dev PC (để làm giống)

```bash
docker run -d --name speaches --restart unless-stopped --gpus all \
  -p 8000:8000 -v ~/.cache/huggingface:/home/ubuntu/.cache/huggingface \
  ghcr.io/speaches-ai/speaches:latest-cuda
```

Model đã tải: `deepdml/faster-whisper-large-v3-turbo-ct2` (~2.4 GB VRAM, 0.2–0.3 s một câu) và
`Systran/faster-whisper-small` (nhẹ hơn, dùng khi GPU đầy). Trên dev PC model tự gỡ sau 300 s không dùng
(mặc định của speaches); nút 🔥 Warm up trên dashboard nạp lại.

## 1. Chạy container trên A6000

Lúc kiểm tra (2026-10-21): cổng 8000 trống, GPU 0 trống nhất (6.3 / 48 GB).

```bash
ssh trung@10.252.205.103
docker run -d --name speaches --restart unless-stopped --gpus '"device=0"' \
  -p 8000:8000 -v ~/.cache/huggingface:/home/ubuntu/.cache/huggingface \
  -e WHISPER__TTL=-1 ghcr.io/speaches-ai/speaches:latest-cuda
curl localhost:8000/health          # → OK
```

- `WHISPER__TTL=-1`: model không bao giờ bị gỡ khỏi GPU — server dự phòng luôn sẵn, không mất vài giây nạp
  lúc cần. (`0` = gỡ ngay sau mỗi lần dùng, mặc định `300` s.)
- `--gpus '"device=0"'`: chỉ dùng GPU 0, không lấn Ollama / visionserve trên các GPU khác.
- Cấu hình khác của speaches là biến môi trường, `__` cho mục lồng nhau (`WHISPER__COMPUTE_TYPE=int8`, …).

## 2. Tải model

```bash
curl -X POST localhost:8000/v1/models/deepdml/faster-whisper-large-v3-turbo-ct2
curl -X POST localhost:8000/v1/models/Systran/faster-whisper-small
curl localhost:8000/v1/models       # → cả hai model
```

Thử một câu (file wav / webm bất kỳ có tiếng Hàn):

```bash
curl -F file=@test.wav -F model=deepdml/faster-whisper-large-v3-turbo-ct2 -F language=ko \
  localhost:8000/v1/audio/transcriptions
```

## 3. Tunnel (chỉ khi robot ở ngoài mạng này)

Robot trong mạng gọi thẳng được A6000 (Ollama `:11434` và visionserve `:11435` dự phòng ở 10.252.205.103 đều
đang hoạt động), nên **dùng `http://10.252.205.103:8000` trực tiếp là đơn giản và nhanh nhất**. Tunnel thêm
khoảng 0.3–1 s mỗi lần gọi.

Nếu cần: `cloudflared` trên A6000 chạy dạng service với token (cùng tunnel với `ollama.aistations.org`), nên
tên miền được thêm trên trang Cloudflare, không phải file trên máy:

1. Cloudflare Zero Trust → **Networks → Tunnels** → tunnel của `ketiserver` → **Public Hostname → Add**.
2. Subdomain `whisper`, domain `aistations.org`, Service **HTTP** `localhost:8000`.
3. Kiểm tra: `curl https://whisper.aistations.org/health` → `OK`.

Type phải là **HTTP**, không phải HTTPS: speaches chỉ phục vụ HTTP thường. Chọn HTTPS thì Cloudflare trả **502** và
log `cloudflared` (`sudo journalctl -u cloudflared`) ghi `tls: first record does not look like a TLS handshake …
originService=https://localhost:8000` (gặp 2026-10-21).

Đo 2026-10-21 (một câu ~2 s, model đã nạp): qua tunnel 1.1–2.1 s, qua LAN `10.252.205.103:8000` 0.3–1.8 s.
Lần gọi đầu sau khi container khởi động mất ~24 s (nạp model) — Warm up làm việc này trước.

> ⚠ Qua tunnel, server mở cho bất kỳ ai trên Internet. Nên đặt khoá:
> 1. Trên A6000 chạy lại container với `-e API_KEY=<khoá>` (bước 1, thêm dòng này).
> 2. Dashboard → Voices → whisper → sửa: ở server tunnel bật ô **key**, nhập khoá → Save. Khoá lưu vào `.env`
>    của site (`WHISPER_API_KEY`), không vào `connections.json`; server đó lưu `api_key_env: WHISPER_API_KEY` và
>    robot gửi `Authorization: Bearer <khoá>` mỗi lần gọi (kể cả `/health`). Làm cho từng site.
> 3. Backend cần bản robot_agent từ 2026-10-21 trở đi (khởi động lại backend).
>
> Thiếu khoá: server đó báo `no API key: set WHISPER_API_KEY` và lời gọi chuyển sang server sau.

## 4. Thêm vào danh sách dự phòng

Dashboard → Connections → **Voices → whisper → sửa → + server**, cho từng site (kcare_bucheon, clobot_bucheon):

| # | url | model |
|---|---|---|
| 1 | `http://192.168.0.6:8000` | `deepdml/faster-whisper-large-v3-turbo-ct2` |
| 2 | `http://192.168.0.6:8000` | `Systran/faster-whisper-small` |
| 3 | `http://10.252.205.103:8000` (hoặc `https://whisper.aistations.org`) | `deepdml/faster-whisper-large-v3-turbo-ct2` |

Đã thêm (2026-10-21) cho cả kcare_bucheon và clobot_bucheon, server #3 = `https://whisper.aistations.org`.

Bấm **🔥 Warm up**: ô **Voices** phải xanh, `ready 3/3`. Khi server 1 lỗi, ô chuyển vàng (`fallback`) và lời gọi
đi sang server sau; mỗi lần chuyển có một dòng log (`whisper: #1 … unreachable → #2 …`).

## Xử lý sự cố

| Triệu chứng | Cách xử lý |
|---|---|
| Log container báo không ghi được cache | `sudo chown -R 1000:1000 ~/.cache/huggingface` (user trong container là uid 1000) |
| `/health` OK nhưng nhận dạng lỗi CUDA out of memory | GPU 0 đã đầy: đổi `device=…` sang GPU khác (`nvidia-smi`), hoặc dùng model `small` |
| Warm up báo Voices `#3 … unreachable` | `curl http://10.252.205.103:8000/health` từ robot; kiểm tra `docker ps` trên A6000 |
| Warm up xanh nhưng nhận dạng lỗi 500 "CUDA failed with error out of memory" | GPU đầy (dev PC 3090 2026-10-21: visionserve 9.8 + Ollama 11.5 + Whisper 2.7 GB = 24 GB). Bản trước 2026-10-21 Warm up gửi im lặng với VAD bật nên model không chạy và báo nhầm "ok"; giờ VAD tắt khi warm. Lời gọi thật vẫn chuyển sang server sau. Giải phóng GPU: `ollama stop <model>` hoặc giảm `keep_alive` |
| Cập nhật speaches | `docker pull ghcr.io/speaches-ai/speaches:latest-cuda`, `docker rm -f speaches`, chạy lại bước 1 (model trong cache không phải tải lại) |
