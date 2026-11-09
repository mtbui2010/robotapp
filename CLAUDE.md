# robotapp

Next.js dashboard (UI mode) for any `robot_agent`-based backend; not required to operate the robot.
Full rules and reasons: [docs/rules.md](docs/rules.md). Docs index: [docs/README.md](docs/README.md).

## Rules

1. Call only endpoints in robot_agent's OpenAPI, only through `frontend/lib/api.ts`; generate types (`make gen-types`).
2. Bundle no robot data; get it from the backend (do not grow the `scripts/lint.mjs` allowlist).
3. Never work around backend bugs in the UI; fix them in the backend (`BACKEND-WORKAROUND(<id>)` needs a [backend_coupling](docs/backend_coupling.md) entry).
4. Run `make ci` before every commit.
5. Update `docs/features/<feature>.md` and add a dated [CHANGELOG](docs/CHANGELOG.md) line with every feature change.
6. Never start a run as a side effect of reading; read state with `GET /agent/<name>/get`.
7. Warn operators that two clients driving one robot is unsafe (Cancel stops both).
8. Ask before motion on real robots (`MAP.confirm_goal`).
9. Write commit messages that say what changed and why.
10. Keep this file short: one-line rules and links; details go in `docs/*.md`.

## Test

`make ci` (lint + typecheck + smoke; needs only `frontend/node_modules`). Details: [docs/commands.md](docs/commands.md).

## Docs

- [docs/architecture.md](docs/architecture.md): layout, related repos
- [docs/commands.md](docs/commands.md): commands and deploy
- [docs/features/README.md](docs/features/README.md): feature specs
- [docs/backend_coupling.md](docs/backend_coupling.md): UI-side backend knowledge to remove

## Quy tắc phát triển chung (skill `dev-principles`)
Chi tiết: `~/.claude/skills/dev-principles/SKILL.md`. Mã nguồn không phải Python hoặc chưa có cấu hình lint thì áp dụng bằng review, các script kiểm tra là bản Python.
1. **Tổng quát hóa:** không đặt dữ kiện riêng của một robot, mô hình, miền hay benchmark trong lõi; chúng là cấu hình/dữ liệu khai báo có nhãn nguồn; thiếu dữ liệu thì tính năng không làm gì.
2. **Mô-đun:** mỗi tính năng là một mô-đun đăng ký vào lõi; phân tầng rõ (lõi → tùy chọn/backend → cấu hình); giới hạn kích thước hàm/file, không tăng mức hiện tại; tái cấu trúc phải chứng minh hành vi giống hệt.
3. Không đoán khi thiếu dữ liệu, không sao chép luật chấm điểm hay benchmark vào hệ thống được đánh giá.
