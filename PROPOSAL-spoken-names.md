# Đề xuất: tên phát âm `nói->thật` thay cho aliases

Trạng thái (2026-10-08): **đã code phần §1–§4 và §6**. **Aliases của skill và
location vẫn giữ nguyên** — §5 (bỏ aliases) và §7 (từ vựng cho LLM) để sau.
Tài liệu vận hành: mục "Spoken names in plans" trong [CLAUDE.md](CLAUDE.md).
Phạm vi: `robot_agent`, `kcare_robot`, `robotapp/frontend`.

## 0. Đã chốt

| # | Câu hỏi | Quyết định |
|---|---|---|
| 1 | Từ vựng cho LLM planner | để sau — aliases vẫn giữ |
| 2 | Autocomplete trên Agent panel | **không**, giữ đơn giản |
| 3 | `->` cho những tham số nào | **mọi tham số** (tên skill, `inputs`, `options`, `loc=`, …) |
| 4 | Chuỗi tự do có `->` (`announce::A->B`) bị tách | **chấp nhận** |
| 5 | Ký hiệu | **giữ `->`** — so sánh ở §6 |

## 1. Ý tưởng

Thay vì đăng ký trước các tên khác (aliases) cho skill và location rồi để
backend đoán, plan ghi cả hai tên ngay tại chỗ dùng:

```
이동->move::식탁 앞->table_top
```

- **Bên trái `->`**: chỉ để **phát âm / hiển thị** (robot nói, dashboard đọc, log).
- **Bên phải `->`**: **giá trị thật** mà backend chạy, đúng như hôm nay.
- Không có `->` thì hai bên là một — hành vi y như hiện nay.

| Chỗ | Ví dụ | Backend chạy | Robot nói |
|---|---|---|---|
| tên skill | `이동->move::…` | `move` | `이동` |
| `inputs` | `move::식탁 앞->table_top` | `inputs='table_top'` | `식탁 앞` |
| tham số khác | `pick_top::inputs='컵->cup', loc='식탁->table@kitchen'` | `inputs='cup'`, `loc='table@kitchen'` | `컵`, `식탁` |
| tham số số | `lift::inputs='반 높이->0.5'` · `fine_move::inputs='컵->cup', fixed_angle='정면->0'` | `0.5`, `0` (kiểu số như khi viết `fixed_angle=0`) | `반 높이`, `정면` |
| từng mục `options` | `ask::inputs='어디로 갈까요?', options="식탁->table@kitchen, 옷방->dressroom"` | `answer='table@kitchen'` | đọc / nghe / xác nhận `식탁` |

**Không** áp dụng cho: key ENV (vẫn là tên thật duy nhất), catalogue sản phẩm
(`products.json` aliases — câu hỏi tự do của `qa`, không có chỗ để ghi `->`),
aliases của thiết bị SwitchBot (`connections.json`), và `label` của ENV (etri).

## 2. Hiện trạng (đọc từ code)

Có hai hệ aliases độc lập, cả hai đều **resolve khi chạy**:

- **Skill aliases** — `SkillDef.aliases` trong `skills.json`;
  `SkillRegistry.resolve` (tên → alias → so sánh normalize) dùng trong
  `execute`, `validate_plan`, check tự gọi, check xoá, `plan_rename`;
  `check_aliases` kiểm khi lưu; `api/skills.py` nhận `aliases`;
  `describe_plan_skills` in `(also: …)`. Dữ liệu thật: `move→이동`,
  `move_top→높이 이동`, `pnp_pot→냄비 전달`, `arm_down→바닥 찾기`.
- **ENV aliases** — `env_names.py`: `resolve_env_name` (key → alias →
  segment `@` → bỏ dấu), `validate_env`, `describe_env` cho `LOCATIONS_HERE`;
  kcare `env_key` / `get_env_specs` đi qua nó; `announce_placing` đọc lại alias.
  Dữ liệu thật: 13 mục ở `kcare_bucheon` (`table@kitchen→식탁, dining table`,
  `dressroom→옷방`, `shelf2@kitchen→왼쪽 선반` …), 1 mục ở `clobot_bucheon`.
- **Options của `ask`** đã có đúng ý tưởng này, chỉ khác ký hiệu:
  `"검은 가방=black bag"` → nghe / so khớp / xác nhận `검은 가방`, trả
  `answer='black bag'`, `answer_text='검은 가방'`.
- **Phần "nói" hiện được suy ra**, không ai ghi ra:
  - narrator (`Announcer`): `{verb}` = tra `VERBS[lang][skill]` (`move→이동`),
    `{object}` = tham số đầu (`_verb_obj` trong `run_direct`) — key tiếng Anh
    `table@kitchen` bị đọc nguyên văn;
  - skill tự nói: `announce_placing` (alias → `label` → `loc2text` = đảo `@` +
    `EN2KR`), `announce_picking` (`correct_noun` qua `EN2KR`).

Vấn đề của aliases: cấu hình trước cho từng site; một tên chỉ trỏ một chỗ
(kiểm trùng ở 3 nơi: backend, `EnvNamesEditor`, `SkillAliasesEditor`); robot
không biết người dùng đã gọi chỗ đó bằng tên gì nếu tên không có trong danh
sách; resolver 4 bước khó đoán (segment `@`, bỏ dấu, "lấy cái đầu + warning").

## 3. Cú pháp

```
[!|~]<nói>-><skill>::<nói>-><inputs>
[!|~]<nói>-><skill>::inputs='<nói>-><thật>', k='<nói>-><thật>', options="<nói>-><thật>, <nói>-><thật>"
```

Một hàm dùng chung, ví dụ `robot_agent/spoken.py`:

```python
split_spoken('식탁 앞->table_top')  # ('식탁 앞', 'table_top')
split_spoken('table_top')           # ('table_top', 'table_top')
split_spoken('->table_top')         # ('table_top', 'table_top')   bên nói rỗng = như không có
split_spoken('식탁 앞->')            # lỗi: "식탁 앞->" has no real value
split_spoken('a->b->c')             # lỗi: more than one "->"
```

- Cắt khoảng trắng hai bên, NFC. Bên thật giữ nguyên chữ hoa / thường.
- `!` / `~` đứng **trước** phần nói: `!이동->move::…`. `&&`: mỗi vế tách riêng.
- **Tham số `k=v` phải có nháy**: `loc='식탁->table@kitchen'`. Không nháy
  (`loc=식탁->table@kitchen`) thì `eval("dict(...)")` lỗi và — như quy tắc hiện
  nay — cả chuỗi rơi về `inputs`, sai âm thầm. Parser nên **báo lỗi** khi chuỗi
  có `->` mà eval thất bại, thay vì rơi về `inputs`.
- Tách **sau** khi parse (giống `$param$` / `{ref}`), nên `->` không làm vỡ dấu
  phẩy / nháy.
- **Kiểu của bên thật**:
  - `inputs` dạng trần (`move::식탁->table_top`): luôn là chuỗi, như hôm nay
    (`lift::0.5` hiện cũng cho chuỗi `'0.5'`);
  - giá trị `k='nói->thật'`: bên thật đọc bằng `ast.literal_eval`, lỗi thì
    giữ chuỗi — `fixed_angle='정면->0'` cho `0` (int) giống `fixed_angle=0`,
    `loc='식탁->table@kitchen'` cho chuỗi.
- **List / tuple**: tách từng phần tử (`options=['식탁->table', '옷방->dressroom']`).
- **`inputs` có `>>`** (plan cấu trúc: `place::cup>>table@kitchen`): tách theo
  `>>` trước, rồi từng đoạn theo `->`: `컵->cup>>식탁->table@kitchen` → thật
  `cup>>table@kitchen`, nói `컵`, `식탁`. `->>` bị từ chối (mơ hồ).
- **`options` dạng chuỗi** (`"a->x, b->y"`) có nhiều `->`, nên **không** tách ở
  bước chung; `ask` tự tách theo `,` rồi `->` (vì nó cần giữ cả cặp). Dạng cũ
  `nói=thật` vẫn nhận trong giai đoạn chuyển đổi (log cảnh báo).
- Phần nói không được chứa `:: && # $ { } ->`; trong `options` thêm `,`.
  Bên thật của tên skill phải là skill đã đăng ký (kiểm như hôm nay).
- Chuỗi tự do có `->` (một câu của `announce`, `reply`) **sẽ bị tách** — đã
  chấp nhận. Muốn giữ nguyên `->` trong câu thì viết `→`.

## 4. Tách ở đâu, phần "nói" đi đâu

### 4.1 Tên skill — tách lúc đọc plan

`plan_skill.plan_lines`, `UnifiedAgent._parse_plan` (gộp làm một, hiện có hai
bản giống nhau) và `cli._parse_args` trả thêm phần nói của skill.
`SkillRegistry.execute(name)` cũng nhận `a->b` (cho chắc, ví dụ khi
`reconstruct_plan` ghép từ JSON). `validate_plan` / check tự gọi / check xoá /
`rename_calls` làm việc trên bên thật; `rename_calls` giữ phần nói
(`이동->move` → `이동->move2`).

### 4.2 Tham số — tách trong `SkillRegistry.execute`

`execute` là chỗ duy nhất mà direct mode, closed loop, bước con của plan
skill, `POST /skill/<name>`, CLI đều đi qua:

- skill `internal` / `external`: mọi tham số (trừ `options` dạng chuỗi, §3)
  được thay bằng bên thật trước khi gọi;
- **skill `plan`: không tách gì cả.** Giá trị `식탁->table@kitchen` chảy nguyên
  vào `$loc$`, bước con `move::$loc$` nhận đủ cặp và tách ở lần `execute` của
  nó — tên nói không mất khi đi qua plan skill, và các check của plan skill
  (`$name$` thiếu, default) không đổi.

Python API (`from kcare_robot.skills.mobile import move; move(inputs='식탁->table_top')`)
không qua `execute` → wrapper `skill_entry` cũng tách bằng cùng hàm.

### 4.3 Phần nói đến skill bằng context, **không** bằng params

`robot_agent.skills.spoken(key)` — thread-local, đặt / khôi phục trong
`execute` y như `_set_emitter` / `_clear_emitter`:

```python
from robot_agent.skills import spoken
spoken('skill')       # '이동' hoặc None
spoken('inputs')      # '식탁 앞' hoặc None
spoken('loc')         # tham số bất kỳ
spoken('inputs', 1)   # đoạn thứ 2 khi inputs có '>>'
spoken('inputs', default=loc2text(env_name))   # tiện cho skill
```

Không nhét vào `params` vì: (1) kcare chuyển `**kwargs` thẳng xuống agent ROS
(`move` → `moveb(node, **kwargs)`); (2) `run_plan_skill` truyền `params` của
bước ngoài vào **mọi** bước con (`ctx = params`) — tên nói của `pick_top` sẽ
dính vào `move`, `lift` bên trong; (3) direct mode `ctx.update(ret)` đẩy kết quả
sang các bước sau. Thread-local tự đúng cho bước song song (mỗi bước một
thread, mỗi thread gọi `execute` riêng) và cho plan lồng nhau (save/restore).

### 4.4 Ai dùng phần nói

| Nơi | Hôm nay | Đề xuất |
|---|---|---|
| Narrator `step_start/success/fail` (direct + closed loop) | `VERBS[lang][skill]`, object = param đầu | verb = phần nói của skill nếu có, object = phần nói của param đầu nếu có, không thì như cũ |
| `announce_placing` (place) | alias → `label` → `loc2text` | `spoken('inputs')` → `label` → `loc2text` |
| `announce_picking` (pick) | `correct_noun` (`EN2KR`) | `spoken('inputs')` → `correct_noun` |
| `ask` options | `nói=thật` | `nói->thật`: đọc, gợi ý Whisper, so khớp, xác nhận bằng bên nói; `answer` = bên thật |
| Dashboard: Execution panel / step label | `str(task_group)` thô | `이동 (move) · 식탁 앞 → table_top` |

Kèm theo: template ko `'{object} {verb}를 진행합니다'` sẽ ra "이동를"; khi verb
do người viết tự do thì chọn 을/를 theo patchim.

### 4.5 Kết quả bước trước: `{answer}`

```
ask::inputs='어디로 갈까요?', options="식탁 앞->table_top, 옷방->dressroom"
이동->move::{answer}
```

`ask` trả `answer='table_top'`, `answer_text='식탁 앞'`. Khi `{name}` là
**toàn bộ** giá trị một tham số và kết quả có `<name>_text` khác `<name>`,
chèn cả cặp `식탁 앞->table_top`, để `move` nói đúng "식탁 앞" người dùng vừa
chọn. Nằm trong một chuỗi dài hơn thì chèn bên thật như hiện nay.

## 5. Bỏ những gì

Backend (`robot_agent`):
- `SkillDef.aliases`, bước alias trong `SkillRegistry.resolve` (giữ tên chính
  xác + normalize hoa / thường), `check_aliases`, `aliases` ở `api/skills.py`
  và ở `POST /skills/reload`, `(also: …)` trong `describe_plan_skills`, nhánh
  alias trong `validate_plan` / `plan_rename`.
- `env_names.py`: bước alias, alias trong `_names` và bước bỏ dấu, phần alias
  của `validate_env` / `describe_env`. **Giữ** normalize, key chính xác,
  segment `@` (`table` → `table@kitchen`) và `strict_loc` — đó không phải alias.

kcare: `announce_placing` bỏ nhánh `aliases_of`; `get_env_specs` / `env_key`
giữ chữ ký.

Frontend:
- Xoá `SkillAliasesEditor.tsx`, khối **Location aliases** (`EnvNamesEditor.tsx`;
  `AliasInput` của nó đang được `SkillAliasesEditor` import), ẩn `aliases` trong
  `ConfigFields`, `· alias` + tìm theo alias ở `SkillPanel`, `aliases` trong
  `types.ts`.
- `PlanSkillEditor`: kiểm tra trực tiếp hiểu `->` (lấy bên thật để tra skill).
- Không đụng aliases của SwitchBot trong `DevicePanel`.

Chuyển đổi:
1. Thêm `->` (không phá gì): `split_spoken`, `spoken()`, tách ở parser +
   `execute`, narrator / `announce_*` / `ask` dùng phần nói. Aliases vẫn chạy
   song song. Plan không có `->` chạy y như cũ.
2. Chuyển guides, shortcut buttons, plan skills đang lưu sang `->` (script một
   lần, in diff để duyệt). 4 skill aliases → ví dụ `이동->move::…` trong guide.
3. Bỏ aliases. Lưu ENV còn `aliases` → bỏ qua trường đó kèm cảnh báo, không
   từ chối (khỏi làm hỏng site cũ).

## 6. Ký hiệu: vì sao giữ `->`

Ký hiệu phải: không trùng cú pháp plan (`::` `&&` `!` `~` `#` `$` `{}`), không
trùng `k=v` / `eval`, không trùng tên location (`@`, khoảng trắng, chữ Hàn / Việt),
gõ được bằng bàn phím thường, và đọc lên là hiểu.

| Ký hiệu | Ví dụ | Vấn đề |
|---|---|---|
| **`->`** | `이동->move::식탁 앞->table_top` | `>` là chuyển hướng trong shell — nhưng xem dưới |
| `=` | `식탁 앞=table_top` | trùng `k=v`: `parse_inputs` thấy `=` là chạy `eval`; `ask` đang dùng tạm được chỉ vì nằm trong `options` |
| `=>` | `식탁 앞=>table_top` | vẫn chứa `=` (rơi vào nhánh `eval`) và vẫn có `>` |
| `:` | `식탁 앞:table_top` | trùng `::`; `이동:move::…` khó đọc |
| `\|` | `식탁 앞\|table_top` | pipe trong shell, y như `>`; trong Markdown bảng phải escape |
| `/` | `식탁 앞/table_top` | tên ROS, đường dẫn, "1/2" trong câu nói |
| `( )` | `식탁 앞(table_top)` | trùng `dict(...)`; câu nói tự nhiên hay có ngoặc |
| `[ ]` | `table_top[식탁 앞]` | trùng list `options=['물', '주스']` |
| `→` (Unicode) | `식탁 앞→table_top` | không trùng gì, nhưng khó gõ (bàn phím, IME Hàn) |

Điểm yếu duy nhất của `->` là shell, và nó **không thêm việc**: phần nói gần
như luôn có khoảng trắng (`식탁 앞`, `왼쪽 선반`), nên lệnh CLI vốn đã phải đặt
trong nháy:

```bash
kcare_robot '이동->move::식탁 앞->table@kitchen'
kcare_robot move inputs='식탁 앞->table@kitchen'
```

Ghi một dòng vào help của CLI là đủ. Không nhận thêm `→` cho đỡ phải giải
thích hai cách viết (trong câu tự do, `→` là cách giữ mũi tên khỏi bị tách — §3).

## 7. Câu 1, giải thích rõ: LLM planner lấy tên ở đâu?

### Hai nguồn plan

- **Người viết** (gõ trên Agent panel, plan skill, shortcut button, guide ví dụ):
  tự ghi `nói->thật`. Không có vấn đề gì.
- **LLM planner** (Agent panel ở chế độ có LLM): LLM tự viết plan. Nó chỉ biết
  những gì có trong guide, và nó **không thấy câu tiếng Hàn của người dùng**:
  `UnifiedAgent` dịch prompt sang tiếng Anh trước (`prompt_en = translate(...)`
  khi `lang != 'en'`).

### Hôm nay aliases làm hai việc cho LLM

```
người dùng:  "식탁으로 가 줘"
dịch:        "go to the dining table"
LLM viết:    move::dining table          (hoặc move::table@kitchen nếu guide có danh sách key)
backend:     resolve_env_name('dining table') → alias của 'table@kitchen' → chạy
```

1. **Lưới an toàn**: LLM viết tên gần đúng (`dining table`, `식탁`, `table`) vẫn
   chạy, vì backend tra alias / segment `@`.
2. **Từ điển**: guide nào có `LOCATIONS_HERE` thì LLM thấy
   `- shelf2@kitchen (also: 왼쪽 선반, left shelf)` — nhờ vậy "the left shelf"
   mới ra được `shelf2@kitchen`. Câu này LLM không thể tự đoán: không có gì
   trong chữ `shelf2` nói nó ở bên trái.
   (Hiện chỉ `guide_struct_kr` có marker; guide đang active là `guide` — chỉ có
   ví dụ `move::shelf`, `move::desk`, dựa hoàn toàn vào lưới an toàn.)

### Bỏ aliases thì mất cả hai

- LLM viết `move::dining table` → **lỗi "unknown location"** (segment `@` vẫn
  cứu được `table` → `table@kitchen`, nhưng không cứu `dining table`, `left shelf`).
- LLM không biết `shelf2@kitchen` là "left shelf" nữa.
- Phần nói: LLM chỉ thấy tiếng Anh, nên muốn robot nói "식탁" thì LLM phải tự
  dịch ngược, hoặc phải có chỗ ghi sẵn tên tiếng Hàn.

### Ba cách

**(a) Không thêm gì.** `LOCATIONS_HERE` chỉ in key. LLM phải chọn đúng key từ
danh sách; robot nói bằng `loc2text` / `EN2KR` như hôm nay khi không có alias.
Đơn giản nhất, nhưng key kiểu `shelf1`, `shelf2@kitchen`, `wait` LLM đoán sai,
và robot sẽ đọc "kitchen shelf2".

**(b) Viết tay trong guide.** Guide có dòng `- 왼쪽 선반 / left shelf -> shelf2@kitchen`.
Không đổi code, nhưng guide nằm ở `common/guides.json` (chung mọi site) còn
location thì theo site — đổi site là danh sách sai.

**(c) — đề xuất — Mỗi ENV entry có một trường `say`** (tên nói mặc định,
theo ngôn ngữ):

```json
"shelf2@kitchen": { "say": {"ko": "왼쪽 선반", "en": "left shelf"}, "loc": {...} }
```

Khác alias ở chỗ: `say` **không bao giờ dùng để tra tên** — không có resolver,
không kiểm trùng (hai chỗ cùng tên nói "선반" cũng được). Nó chỉ dùng để:
1. `LOCATIONS_HERE` in `- left shelf / 왼쪽 선반 -> shelf2@kitchen`, guide dặn
   "viết `<tên nói theo ngôn ngữ của người dùng>-><key>`", LLM chép ra
   `move::왼쪽 선반->shelf2@kitchen`;
2. làm phần nói mặc định khi plan ghi `move::shelf2@kitchen` không có `->`
   (Map tab, plan cũ, LLM quên) — thay cho `label` / `loc2text`.

Cho skill thì không cần trường tương tự: `PLAN_SKILLS_HERE` đã in tên + mô tả,
và động từ đã có bảng `VERBS`.

Câu cần bạn chọn: **(a)**, **(b)** hay **(c)**?
