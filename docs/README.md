# Splat Lab v9 — tile sẵn sàng thì hiển thị ngay

Viewer dùng Spark **2.3.1**, Three.js **0.180.0**. Giữ các cảnh Cozy Spaceship,
Hobbiton, Coit Tower, Poland, Butterfly và các chế độ RAD/PLY nguyên frame.
**Layer là resolution độc lập**; mỗi lần chọn một layer.

## Cập nhật và chạy trên Windows CMD

1. Giải nén toàn bộ `Splat-Lab-Tile-Live-v9.zip` vào thư mục tạm rồi chép code vào
   `D:\3DGS-Spark-Tiles`. Giữ nguyên `dist/data`; ZIP chỉ có code, không có dataset.
2. Nếu v7/v8 đã chạy được và còn `tiles.json` cùng các PLY trong `voxels_new`,
   **không cần cấu hình/gộp lại**. Chạy server:

```bat
cd /d "D:\3DGS-Spark-Tiles"
py serve.py --bind 127.0.0.1 --port 8765 --directory dist
```

3. Nếu đây là lần đầu thêm dữ liệu, chạy trước:

```bat
py configure_tiles.py --input "D:\Downloads\redandblack_tiles" --copy --no-pack-frames
```

Script tự nhận thư mục bọc lồng nhau khi giải nén. Nó chép PLY gốc cùng
`layer_N/frame_N/voxel_new.json`, tạo `dist/data/redandblack_tiles/tiles.json`.
`--no-pack-frames` không tạo thêm PLY nguyên frame. Chờ `Created: ...` rồi chạy server.
Giữ `configure_tiles.py`, `frame_ply.py`, `serve.py` cùng cấp với thư mục `dist`.

4. Mở **http://127.0.0.1:8765/**, Ctrl+F5. Chọn **Redandblack · PLY tiles**.
   Mặc định là **Hiện tile ngay · không chờ frame**.

Không cần Cargo/npm. Cần Internet để tải engine và các cảnh mẫu từ CDN.
Không mở index.html bằng file://. Nếu nhân vật nằm ngang, đặt Xoay X = -90.

## Cơ chế hiển thị ngay của v9

- Trình duyệt tải từng PLY tile gốc, kể cả khi manifest có fastFrame của v8.
- Công việc được xếp theo thời gian rồi tên ô; tối đa 6 tác vụ tải/xử lý tile
  đang hoạt động mặc định, tối đa 2 tác vụ khởi tạo Spark. Có thể chỉnh trong công cụ.
- Khi một tile đã tải, giải mã và được chuẩn bị xong, nó lập tức thay tile cũ cùng
  tên ô. Không đợi các tile khác của frame. Một tile chậm chỉ chiếm một suất xử lý;
  tile từ thời điểm sau có thể xuất hiện trước khi nó hoàn tất.
- Tên file tile là định danh ô, ví dụ x_1y_1z_0.ply. Dữ liệu cần chung hệ tọa độ và
  cách đánh số ô nhất quán giữa các frame. Web không tự thêm offset/recenter tile.
- Mỗi ô giữ tối đa một phiên bản. Số thứ tự gồm cả vòng lặp, nên tile cũ đến muộn
  không thể ghi đè tile mới; frame 1450 ở vòng mới vẫn được coi là mới hơn 1479 vòng trước.
- Ô không xuất hiện trong danh sách tile của frame mới được coi là rỗng và gỡ hình
  cũ. Kết quả tải cũ đến sau đó cũng bị bỏ. Vì vậy manifest phải liệt kê đầy đủ dữ liệu.
- Lỗi HTTP/decode **không được coi là ô rỗng**: giữ tile trước đó và báo lỗi, các ô
  khác tiếp tục chạy. Nếu không tải được bất kỳ tile nào trong cả lượt, dừng và báo lỗi.
- Tạm dừng hủy tác vụ và giữ hình đang thấy. Kết quả giải mã đến sau khi dừng bị bỏ.
  Bấm Phát sẽ tiếp tục từ công việc bị hủy; có thể phải tải/giải mã lại những file đó.
- Tua thanh thời gian: xóa hình trộn cũ, tải riêng các tile của frame được chọn và
  giữ trạng thái tạm dừng. Đổi resolution hoặc chế độ: hủy bộ phát cũ, giữ camera,
  bắt đầu tại frame mới nhất đã cập nhật. Chuyển scene sẽ giải phóng toàn bộ tile.
- Khi tắt Lặp lại, hết lượt hiện tại sẽ dừng sau khi các tác vụ đã gửi kết thúc.

**Đánh đổi:** các ô có thể thuộc những thời điểm khác nhau, gây rách/chồng hình khi
vật chuyển động. Chế độ này chạy theo khả năng tải và xử lý, không duy trì nhịp
30 FPS. Nó giảm chờ đồng bộ, không bảo đảm decoder hay GPU nhanh hơn.
Không lọc theo vùng nhìn, không giảm Gaussian/SH, không tự chọn resolution.

Chỉ giữ các tile đang thấy và một số tác vụ đang xử lý, **không cache mesh của cả
30 frame**. Phát lặp vẫn giải mã lại PLY; HTTP cache có thể giúp tải byte. Giới hạn
byte nguồn đang xử lý dùng chung là 128 MiB; một file vượt ngưỡng được chạy một mình.
Bộ nhớ hiển thị là ước tính, không phải trần RAM/VRAM tổng. Không tự giảm chất lượng
khi máy thiếu bộ nhớ. Càng nhiều ô, renderer càng phải quản lý nhiều mesh.

## Chuyển về chế độ đồng bộ để so sánh

Trong Công cụ → Dynamic → Cách hiển thị PLY tiles, chọn
**Đồng bộ cả frame · chế độ v8**. Web đợi đủ frame rồi đổi toàn bộ cùng lúc, có FPS
mục tiêu và cache frame. Nếu đã có fastFrame trong manifest, web dùng bản PLY nguyên
frame. Nếu chưa có, nó đợi đủ các tile riêng. Muốn tạo fastFrame, chạy lại lệnh cấu
hình **bỏ `--no-pack-frames`**; việc này tốn thêm dung lượng đĩa, giữ nguyên PLY gốc.
Hai chế độ được tách rõ: chọn Hiện tile ngay sẽ không dùng cache toàn chuỗi của v8.

## Số đo cho chế độ tile

| Trường CSV | Ý nghĩa |
| --- | --- |
| `tile_playback_mode` | progressive hoặc frame |
| `tile_updates_per_second` | Số tile được thay trong scene mỗi giây; không phải FPS |
| `tile_updates` | Tổng số tile đã nhận vào scene |
| `tile_stale_discarded` | Kết quả cũ bị bỏ do ô đã có phiên bản mới hơn |
| `tile_empty_clears` | Số lần gỡ tile cũ vì ô đã rỗng |
| `tile_errors` | Lỗi tải/giải mã; xem thông báo lỗi gần nhất trong công cụ |
| `tile_visible_cells` | Số ô đang có mesh |
| `tile_pending_jobs` | Tác vụ chưa hoàn tất, gồm cả tác vụ đang hủy |
| `tile_visible_memory_mib` | Bộ nhớ nguồn CPU/GPU của các tile đang thấy, ước tính |

`content_fps` để trống trong CSV của chế độ progressive vì không có khung hình
đồng bộ để đếm. `fps` vẫn là nhịp vòng render trình duyệt, không phải GPU timer.
Dòng thời gian trong UI cho biết phạm vi frame/vòng lặp của các tile đang thấy.

## Cấu trúc layer / frame / tile

Ví dụ sau khi chạy lệnh cấu hình:

| Đường dẫn trong project                                                   | Ý nghĩa                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------- |
| `dist/data/redandblack_tiles/tiles.json`                                  | Danh sách resolution, frame và URL từng tile            |
| `dist/data/redandblack_tiles/layer_1/frame_1450/voxels_new/x_1y_1z_1.ply` | Một tile không gian của frame 1450, resolution layer_1  |
| `dist/data/redandblack_tiles/layer_1/frame_1450/voxels_new/x_2y_1z_1.ply` | Tile khác của cùng frame, hiển thị cùng lúc             |
| `dist/data/redandblack_tiles/layer_1/frame_1451/voxels_new/x_1y_1z_1.ply` | Tile của frame kế tiếp                                  |
| `dist/data/redandblack_tiles/layer_2/frame_1450/voxels_new/x_1y_1z_1.ply` | Frame 1450 ở resolution layer_2, nếu dataset có layer_2 |

Không đổi tên layer thành res1/res2/res4/res8. Web liệt kê đúng các layer tìm thấy.
Script chọn mặc định layer có tổng dung lượng tile nhỏ nhất; số layer không được
dùng để suy đoán độ nặng hay kích thước ảnh. Các layer phải có cùng danh sách frame,
nhưng số lượng/tên tile của từng frame có thể khác nhau. Không cần đúng 30 frame.

Nếu bạn đã tự chép data vào `dist/data/redandblack_tiles`, chỉ cần:

```bat
py configure_tiles.py --no-pack-frames
```

Tùy chọn: `--default-layer layer_1`, `--fps 30`, `--rotation -90`,
`--start 1450 --end 1479`. Chỉ dùng tên layer có thật. Sau khi thay đổi dữ liệu,
chạy lại script để cập nhật danh sách và kích thước tile. Tùy chọn copy không xóa
file cũ tại đích. Script tạo bản PLY nguyên frame bằng cách nối nguyên các bản ghi vertex.
Với PLY binary, byte thuộc tính giữ nguyên, bao gồm SH, scale, rotation, opacity.
Không giảm số Gaussian hoặc bỏ SH. PLY gốc không bị sửa/xóa. Các tile trong cùng
frame phải có cùng định dạng/thứ tự thuộc tính; nếu khác, script báo lỗi rõ ràng.
`--no-pack-frames` chỉ lập danh sách và dùng đường tải từng tile, không tạo bản
nguyên frame. Bỏ tùy chọn này nếu cần tạo fastFrame để so sánh chế độ đồng bộ v8.

**Điều kiện của PLY:** tile chứa Gaussian 3D với các thuộc tính chuẩn `x/y/z`,
`opacity`, `f_dc_*`, `scale_*`, `rot_*`. Script kiểm tra header và độ dài dữ liệu
binary, bỏ qua tile `element vertex 0` khi lập danh sách tải. File ASCII và binary
little-endian được nhận. Đây không phải kiểm tra chất lượng reconstruction.
Các tile phải dùng **chung hệ tọa độ của frame**. Nếu quy trình xuất đã đưa từng
tile về gốc riêng, cần cung cấp transform/offset tương ứng trước khi ghép đúng;
tên `x_…y_…z_…` không đủ xác định offset theo đơn vị thế giới.

## Chi tiết chế độ đồng bộ cả frame (v8 được giữ lại)

| Khâu            | Thay đổi                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| HTTP / khởi tạo | Dùng fastFrame: 1 PLY + 1 SplatMesh cho mỗi frame, thay cho một mesh trên mỗi tile                            |
| Bounding box    | Đọc `voxel_new.json` nằm cạnh `voxels_new`, hợp các hộp bao và đưa vào manifest; không dùng để lọc góc nhìn   |
| Chuẩn bị frame  | Tối đa 2 frame chuẩn bị đồng thời, mặc định nhìn trước 6 frame                                                |
| Tải / xử lý     | Hàng đợi HTTP và hàng đợi khởi tạo Spark tách riêng; mặc định 6 request và 2 tác vụ khởi tạo                  |
| Chuyển frame    | Giữ frame hiện tại đến khi frame mới hoàn chỉnh; frame có trong cache đổi đồng bộ trước lần render kế tiếp    |
| Phát lặp        | Giữ mesh đã xử lý ngoài cửa sổ tải trước, chỉ loại khi cần ngân sách; không giải mã lại frame còn trong cache |
| GPU             | Có tùy chọn nạp trước texture nguồn và SH; thao tác này không bảo đảm shader/sort/render đã hoàn tất          |

Script nhận đúng đường dẫn theo ảnh: `layer_8/frame_1454/voxel_new.json` và
`layer_8/frame_1454/voxels_new/*.ply`. JSON dùng `leftBottom` và `rightTop` theo tên
tile. Nếu JSON thiếu một phần hoặc không có, web vẫn chạy và tính hộp bao khi cần.
JSON sai tọa độ sẽ báo lỗi ở bước cấu hình. Hộp bao dùng để đặt camera, **không
loại Gaussian/tile khỏi hình**. Các layer là các resolution độc lập.

Trong chế độ đồng bộ, phát sau frame đầu tiên rồi chuẩn bị tiếp ở nền. Công cụ hiển thị
`1 mesh/frame` khi đang dùng bản nguyên frame; nếu vẫn thấy nhiều mesh/frame,
hãy chạy lại configure_tiles.py và Ctrl+F5. Nếu fastFrame đã được khai báo nhưng
file tải lỗi, web báo lỗi, không âm thầm chuyển sang đường tải chậm.

**Để phát lặp mượt nhất khi bộ nhớ đủ:**

1. Chọn layer nhẹ trước; mặc định script chọn theo tổng byte thực tế.
2. Giữ cache 512 MiB. Bấm **Chuẩn bị cả chuỗi · tạm dừng**.
3. Khi thấy **Đã sẵn sàng cả chuỗi**, bấm Phát. Các frame được dùng lại từ cache.
4. Nếu thiếu ngân sách, chọn layer nhẹ hơn hoặc tăng cache lên 1024 MiB khi máy
   còn đủ RAM/VRAM. Không tăng tùy tiện trên GPU tích hợp hoặc máy ít bộ nhớ.

Nút chuẩn bị cả chuỗi là tùy chọn, không bắt buộc đợi đủ 30 frame khi mở web.
Đổi layer hoặc scene sẽ giải phóng cache chuỗi cũ; đóng/tải lại trang cũng mất
cache mesh. Disk cache của trình duyệt chỉ giúp tải byte, không lưu các mesh này.

Cache được ước tính từ mảng packed/SH của Spark và bản texture tương ứng, có phần
bù cho mỗi mesh. Đây **không phải giới hạn cứng tổng RAM/VRAM**: bộ đệm renderer,
worker, bản sao khi decode, driver và tối đa 2 frame đang chuẩn bị dùng thêm bộ nhớ.
Các byte PLY chờ xử lý có ngân sách riêng 128 MiB. Một file lớn hơn ngân sách đó
được chạy một mình để không kẹt hàng đợi. Frame hiện tại/kế tiếp được giữ đến lúc
đổi thành công, có thể tạm vượt ngân sách cache; UI sẽ báo khi không thể giữ cả chuỗi.

Chế độ cache cả chuỗi dùng nhiều bộ nhớ hơn bản v7. Nếu lần đầu vẫn chậm, xem thời gian
chuẩn bị/tải/khởi tạo trong CSV. Tổng byte PLY không được nén bởi bước nối frame;
nghẽn băng thông vẫn cần dữ liệu nhỏ hơn hoặc định dạng nén phù hợp. Không có cam
kết 30 FPS: chuẩn bị dữ liệu, upload, sorting và render đều ảnh hưởng kết quả.
Không bỏ qua frame, không nội suy, không tự đổi resolution, không lọc theo vùng nhìn.
Các cảnh RAD vẫn giữ cơ chế LoD vốn có của Spark.

## Các số đo bổ sung cho chế độ đồng bộ

Trong Công cụ → Đo hiệu năng, xuất CSV sau vòng đầu và sau vài vòng phát lặp:

| Cột                            | Cách đọc                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `content_fps`                  | Tốc độ đổi frame của ứng dụng, không phải GPU present                                                   |
| `fps`, `frame_ms`              | Nhịp vòng render của trình duyệt, không phải GPU timer                                                  |
| `frame_wait_ms`                | Thời gian ứng dụng chờ frame đích; cache hit thường rất thấp                                            |
| `cache_hits`                   | Số lần dùng lại frame đã chuẩn bị                                                                       |
| `cache_estimated_mib`          | Bộ nhớ cache ước tính                                                                                   |
| `current_prepare_ms`           | Thời gian chuẩn bị frame đang hiển thị, kể cả chờ tài nguyên bên trong loader                           |
| `current_fetch_sum_ms`         | Tổng thời gian fetch + đọc body các file của frame đó                                                   |
| `current_decode_sum_ms`        | Tổng thời gian constructor → mesh.initialized; gồm xử lý/đợi worker, không phải riêng thuật toán decode |
| `current_bounds_sum_ms`        | Tổng thời gian lấy/hợp bounding box                                                                     |
| `current_upload_submit_sum_ms` | Thời gian chờ lượt và gọi nạp texture; không phải thời gian GPU đo bằng fence                           |
| `current_http_requests`        | 1 với fastFrame; bằng số tile không rỗng với chế độ tile riêng                                          |

Các cột `*_sum_ms` có thể chồng lấp do xử lý đồng thời, **không cộng lại để suy ra
thời gian thực của frame**. `preparation_ms` giữ tương thích với CSV cũ: lần chuẩn
bị hoàn tất gần nhất, có thể thuộc frame tải trước. Các số `current_*` thuộc frame
đang xem, kể cả khi frame đó đã được lấy lại từ cache.

Để dùng server dữ liệu riêng, tạo manifest tại thư mục dataset:

```bat
py configure_tiles.py --input "D:\data\redandblack_tiles" --output "D:\data\redandblack_tiles"
```

Phục vụ toàn bộ thư mục, gồm `fast_frames`, qua HTTP/HTTPS rồi nhập URL `tiles.json`
ở Công cụ → Dynamic → Mở thêm chuỗi. Server khác origin cần CORS. Muốn mở mặc định,
sửa `manifestUrl` của scene `redandblack-tiles` trong `dist/scenes.js`.

## Cấu trúc RAD

Ví dụ các đường dẫn tương đối với thư mục project:

| File                                                 | Vai trò                 |
| ---------------------------------------------------- | ----------------------- |
| `dist/data/redandblack-pages/res8/001450-lod.rad`    | Header frame 1450, res8 |
| `dist/data/redandblack-pages/res8/001450-lod-0.radc` | Chunk 0 của frame đó    |
| `dist/data/redandblack-pages/res8/001450-lod-1.radc` | Chunk tiếp theo, nếu có |
| `dist/data/redandblack-pages/res8/001451-lod.rad`    | Frame kế tiếp           |
| `dist/data/redandblack-pages/res1/001450-lod.rad`    | Cùng frame ở res1       |

Giữ tiếp các frame đến 001479 và các resolution res1/res2/res4/res8.
Số chunk mỗi frame có thể khác nhau. Không đổi đuôi RADC thành RAD.

`configure_dataset.py` nhận cả tên `001450-lod.rad`, `001450.rad` và các tên khác,
sắp xếp tự nhiên, chỉ liệt kê resolution thật sự có dữ liệu. Các resolution của
cùng định dạng phải có cùng danh sách tên frame để đổi chất lượng đúng thời điểm.
Nó đọc header RAD để kiểm tra cây LoD, sự tồn tại/kích thước/chữ ký của từng chunk.
Đây không phải kiểm thử giải mã hoặc kiểm tra chất lượng hình ảnh.

Chạy `py configure_dataset.py` cho dữ liệu RAD/PLY nguyên frame.
Script tạo **`dist/data/redandblack-scenes.json`**; web tự đọc file này khi mở.
Không sửa hay chuyển đổi dữ liệu gốc. Sau khi bổ sung frame/resolution, chạy lại
script. Script in ra số frame thực tế; hãy kiểm tra đủ 30 frame mỗi resolution.
Nếu chỉ chuyển xong một phần dữ liệu, script không tự tạo các frame còn thiếu.

Nếu chưa chạy script, `scenes.js` mặc định tìm:

- RAD: `res1|res2|res4|res8/001450-lod.rad` đến `001479-lod.rad`.
- PLY: `res1|res2|res4|res8/001450.ply` đến `001479.ply`.

RAD mặc định dùng **buffer 3 frame**, res8, FPS mục tiêu 30, tự phát và lặp.
Lúc mở trang: thử **PLY tiles → RAD → PLY nguyên frame → Butterfly**, tùy dữ liệu
có sẵn. Nếu không có dataset, thông báo xuất hiện trong công cụ.
Khi chọn RAD thủ công mà có lỗi, web báo lỗi thay vì âm thầm chuyển sang cảnh khác.

## Giao diện

- Canvas chiếm toàn bộ cửa sổ. Bảng công cụ mặc định đóng.
- Bấm **Công cụ**, hoặc phím **H** để mở/đóng. Escape đóng bảng.
- Tên cảnh, tác giả, lựa chọn scene, resolution, timeline, FPS và các thông số
  đều nằm trong bảng. Khi đóng chỉ còn cảnh và một nút mở công cụ.
- Trong Dynamic: Phát/Tạm dừng, tua frame, lặp, buffer, FPS mục tiêu, xoay X,
  Vừa khung. Space phát/tạm dừng khi canvas đang được focus.
- Đổi resolution giữ cùng tên frame, trạng thái phát và vị trí camera.
- Toàn màn hình vẫn có nút mở/đóng công cụ.
- Các điều khiển LoD/foveation, camera, tự xoay, background, thêm đối tượng và
  xuất số đo CSV của bản trước được giữ lại.
- Lỗi mới sẽ mở bảng để hiển thị thông báo. Nút đóng/mở và hướng dẫn vẫn hoạt động
  nếu engine/CDN/WebGL không khởi tạo được.

Nếu nhân vật nằm ngang: mở Dynamic, đổi **Xoay X = -90**, bấm **Vừa khung**.
Để lưu hướng đó cho mọi người xem, sửa `rotationX` của scene trong `scenes.js`.

## Dynamic RAD hoạt động như thế nào?

Mỗi frame RAD được tạo bằng **`new SplatMesh({ url, paged: true })`**. Giữ URL gốc
để Spark tìm đúng các file RADC và tải chunk theo góc nhìn. RAD gộp dùng HTTP Range.
Không tải header thành một ArrayBuffer rồi đưa vào bộ đọc PLY.

Bộ phát duy trì một cửa sổ frame nhỏ. Mesh RAD được chuẩn bị với opacity = 0 nhưng
vẫn tham gia bộ chọn LoD của Spark. `mesh.initialized` chỉ là bước đầu; bộ phát chờ
metadata hợp lệ và `mesh.paged.numSplats > 0` rồi mới chuyển opacity giữa các frame.
Frame trước được giữ trong lúc frame tiếp theo đang chuẩn bị. Buffer được giới
hạn 2–10 frame; có thể có thêm một frame đang chuẩn bị.

Các frame trong buffer vẫn được cập nhật LoD theo góc nhìn để tránh phải khởi tạo
lại từ đầu khi đến lượt phát. Chỉ **một frame có opacity > 0**. Đánh đổi: các frame
trong buffer dùng chung ngân sách LoD và thêm công việc traversal/packing/sorting.
Nếu máy chậm, thử buffer 2–3 và giảm ngân sách splat hoặc độ phân giải render.
Các page GPU cũ được Spark giải phóng theo cơ chế cleanup, không nhất thiết ngay
trong lần chuyển frame. Header fetch do Spark quản lý có thể kết thúc sau thao tác
hủy; kết quả cũ bị bỏ, chunk fetch được hủy khi dispose.

**Giới hạn cần hiểu:**

- RAD là LoD/nén theo không gian của từng frame, không phải codec video theo thời gian.
- Frame có splat được chọn chưa có nghĩa là đã đủ tất cả chi tiết. Hình có thể sắc
  dần khi chunk được tải, và thay đổi camera có thể gây tải thêm dữ liệu.
- Điều kiện sẵn sàng trên không phải GPU fence hay xác nhận frame đã present.
- Đổi resolution bắt đầu buffer mới; có thể có khoảng chờ. Camera và thời điểm
  trong chuỗi được giữ lại.
- 30 file không tự bảo đảm 30 FPS. Không bỏ frame hay nội suy để bám đồng hồ.
- FPS render đo vòng lặp trình duyệt. FPS nội dung đo lần ứng dụng đổi mesh.
  Số splat được chọn gồm cả các frame trong buffer RAD đang tham gia LoD.
- Thời gian chuẩn bị frame gồm tải, giải mã và chờ LoD; không phải riêng decode.
- PLY vẫn dùng `lod:false` và buffer mesh đã giải mã như trước.
- Chưa có decoder CAGS/Draco/CPGS/NPZ hoặc ABR/DASH.

RAD cần cây LoD từ build-lod. Định dạng khác hoặc RAD chưa có LoD sẽ báo lỗi.
Nếu sau 45 giây frame chưa có splat, bộ phát dừng với thông báo để kiểm tra
RADC, HTTP Range/CORS và công tắc Tải thêm chunk. Phát thử lại sau khi sửa lỗi.

## Đưa lên GitHub Pages

Khi đã có dữ liệu trong `dist/data`, tại thư mục project chạy:

```bat
py prepare_pages.py
git add docs
git commit -m "Add Spark tiled dynamic playback and resolution selection"
git push
```

Script kiểm tra dữ liệu, tạo danh sách frame, chép **toàn bộ dist** sang docs và tạo
`.nojekyll`. Nó hỗ trợ chỉ PLY tiles, chỉ RAD/PLY nguyên frame, hoặc kết hợp,
bao gồm các chunk RADC. Với tiles.json đã có, giữ layer mặc định, FPS, hướng xoay
và khoảng frame đã chọn; chạy lại configure_tiles.py trước để cập nhật lựa chọn.
Không xóa file cũ trong docs; nếu đổi tên/xóa frame nguồn, danh sách mới sẽ ngừng
tham chiếu các file cũ nhưng chúng vẫn tồn tại trong docs cho đến khi bạn dọn.

Giữ Settings → Pages → Deploy from a branch → main → /docs nếu đang dùng cách này.
Nếu chỉ cập nhật giao diện, dữ liệu và danh sách trong docs đã đúng:

```bat
py prepare_pages.py --frontend-only
```

Lệnh frontend-only giữ nguyên cả dataset và danh sách dữ liệu trong docs.
Kiểm tra giới hạn dung lượng hiện hành của dịch vụ trước khi push bộ dữ liệu lớn.
Có thể lưu dữ liệu ở server HTTP khác; sửa `baseUrl` trong scenes.js hoặc file
redandblack-scenes.json (cấu hình trong JSON được ưu tiên). Server khác origin cần
CORS; RAD gộp cần phản hồi Range **206** đúng với Content-Range. `serve.py` đi kèm
đã hỗ trợ Range. Không dùng `py -m http.server` cho thử RAD gộp vì không bảo đảm Range.

## Thêm scene / mở URL riêng

Chỉnh `dist/scenes.js`. Một scene sequence tối thiểu:

```js
{
  id: 'my-rad',
  type: 'sequence',
  name: 'My RAD sequence',
  autoplay: true,
  sequence: {
    baseUrl: './data/my-scene/',
    format: 'rad',
    filePattern: '{frame}-lod.rad',
    firstFrame: 1450,
    lastFrame: 1479,
    padding: 6,
    resolutions: ['res1', 'res2', 'res4', 'res8'],
    defaultResolution: 'res8',
    fps: 30,
    buffer: 3,
    rotationX: 0,
  },
}
```

Nếu tên là `001450.rad`, đặt `filePattern: '{frame}.rad'`.
Có thể dùng `framesByResolution` chứa danh sách tên file rõ ràng thay khoảng số.
URL tương đối chạy được ở localhost và dưới `/TEN_REPOSITORY/` của GitHub Pages.
Chia sẻ link `?scene=redandblack-rad&res=res4`, `?scene=redandblack&res=res2`
hoặc `?scene=redandblack-tiles&res=layer_1`, `?scene=hobbit`.
Mặc định sửa tại `viewerSettings.defaultSceneId`.

Không cần sửa code để thử một URL: Công cụ → Dynamic → Mở thêm chuỗi →
Mở chuỗi qua URL. Chọn định dạng, mẫu tên, các resolution hiện có và khoảng frame.
Người xem vẫn có thể mở PLY từ máy trong mục nâng cao; đây là xử lý cục bộ, không
upload. RAD chia chunk được mở qua HTTP để Spark tìm các file liên quan.

## Source và kiểm tra

Code HTML/CSS/JS đã format, không minify:

- `index.html`, `style.css`, `ui.js`: canvas và bảng công cụ có thể đóng/mở.
- `app.js`: renderer, camera, scene coordinator và số đo.
- `sequence.js`: URLs, timeline, buffer, chuẩn bị PLY/RAD và dọn dữ liệu.
- `tiles.js`: đọc manifest, tải có giới hạn, giải mã và nhóm tile.
- `progressive.js`: lịch tải không chờ frame, thay từng ô, chống kết quả đến muộn và dọn mesh.
- `scenes.js`: các cảnh mẫu và cấu hình mặc định.
- `configure_dataset.py`: lập danh sách dữ liệu thực và kiểm tra RAD/RADC.
- `configure_tiles.py`: đọc header PLY + voxel_new.json, tạo manifest và chép dữ liệu.
- `frame_ply.py`: nối bản ghi vertex thành PLY nguyên frame, giữ mọi thuộc tính.
- `prepare_pages.py`: chuẩn bị docs cho Pages.

```bat
node --test tests/*.test.mjs
py -m unittest discover -s tests -p "test_*.py"
```

Đã vượt qua 37 kiểm tra Node và 16 kiểm tra Python. Bộ kiểm tra Node bao gồm cả chế độ đồng bộ và progressive; Python kiểm tra dữ liệu/đóng gói. Kiểm tra logic gồm
manifest tile, tọa độ không bị thay đổi, giới hạn tải/giải mã, chỉ đổi frame hoàn chỉnh trong chế độ đồng bộ; trong chế độ progressive kiểm tra
hiện tile sớm, bỏ kết quả cũ, ô rỗng, vòng lặp, tạm dừng và giới hạn bộ nhớ; hủy tải/dọn mesh, file rỗng/lỗi và đóng gói dataset tile cho Pages;
URL dưới thư mục repo, tên RAD/RADC, thứ tự frame, autoplay,
seek, đổi resolution, giới hạn buffer, hủy frame cũ, không coi header là frame sẵn
sàng, lỗi metadata và fallback. Python kiểm tra dữ liệu trước khi copy và HTTP Range.
Fixture Python chỉ kiểm tra header/chunk bounds, không phải một cảnh render được.

Đã chạy bộ giải mã Spark 2.3.1 thật trong trình duyệt với fixture SH1 tự tạo:
32 Gaussian được đọc thành công; kết quả packed + SH1 của bản nguyên frame khớp
bản từng tile; đường fast dùng 1 request/mesh, đường tile dùng 2 request/mesh.
Đây là kiểm tra tính đúng dữ liệu, không phải benchmark trên Redandblack.

Với v9, đã chạy thêm bộ phát progressive bằng Spark thật trên 4 file tile SH1 tự tạo:
giữ một phản hồi của frame 1450, xác nhận cả hai ô của frame 1451 đã được thêm vào
scene trước khi nhả phản hồi đó. Tile 1450 đến muộn bị loại bỏ; mỗi ô giữ một mesh.
Kiểm tra này xác minh giải mã và đối tượng trong scene, không xác minh hình render.

Môi trường tạo mã đã kiểm tra UI đóng/mở bằng trình duyệt, nhưng trình duyệt đó
không tạo được WebGL context. Chưa xác nhận hình render/FPS của bộ PLY tile hoặc
RAD Redandblack thật trên máy của bạn; các file thật chưa được cung cấp trong lần
cập nhật này. Chạy localhost với layer nhẹ nhất trước. Kiểm tra Network: JSON và
PLY (hoặc RAD/RADC) phải tải thành công; không có lỗi ở Console. Các kiểm tra dùng
mock engine chỉ xác minh logic, không thay cho kiểm tra Spark/GPU trên dữ liệu thật.

## Nguồn

- https://sparkjs.dev/docs/lod-getting-started/
- https://sparkjs.dev/docs/splat-mesh/
- https://sparkjs.dev/examples/streaming-lod/
- API đối chiếu theo https://github.com/sparkjsdev/spark/tree/v2.3.1

Spaceship: Britt Casado / World Labs Marble; Hobbiton: Tijerin / World Labs Marble;
Coit Tower: Vincent Woo; Poland: Andrii Shramko; Butterfly: Spark example asset.
Không đóng gói lại các dataset mẫu. Đây là ứng dụng dựa trên Spark, không phải
sản phẩm chính thức của World Labs. Mã giao diện riêng dùng LICENSE kèm source.
