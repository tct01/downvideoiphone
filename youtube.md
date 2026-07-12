# Hướng dẫn AI sử dụng API YTSave đúng cách

## 1. Tổng quan

API được quan sát từ HAR của website `ytsave.to`.

Mục đích: - Gửi URL YouTube cần xử lý. - Nhận thông tin video. - Theo
dõi tiến trình tạo file. - Lấy URL tải xuống khi hoàn tất.

API sử dụng phương thức:

    POST https://ytsave.to/proxy.php

------------------------------------------------------------------------

# 2. Luồng hoạt động chuẩn

AI phải xử lý API theo quy trình:

    YouTube URL
         |
         v
    Gửi yêu cầu khởi tạo
         |
         v
    Nhận trạng thái queued
         |
         v
    Kiểm tra tiến trình
         |
         v
    Chờ status completed
         |
         v
    Lấy fileUrl

Không được giả định file có sẵn ngay sau request đầu tiên.

------------------------------------------------------------------------

# 3. Request khởi tạo

## Endpoint

    POST https://ytsave.to/proxy.php

## Body

Dạng:

    application/x-www-form-urlencoded

Tham số:

  Field   Kiểu     Mô tả
  ------- -------- ---------------------
  url     string   URL YouTube cần tải

Ví dụ:

``` http
POST /proxy.php

url=https%3A%2F%2Fwww.youtube.com%2Fshorts%2FVIDEO_ID
```

------------------------------------------------------------------------

# 4. Response khởi tạo

Ví dụ:

``` json
{
  "api": {
    "service": "YouTube",
    "status": "ok",
    "message": "Processing started.",
    "id": "VIDEO_ID",
    "title": "Video title",
    "previewUrl": "..."
  }
}
```

AI cần lưu:

-   `api.id`: ID video
-   `api.title`: tên video
-   `api.previewUrl`: URL xem trước nếu cần

Sau bước này chưa có file tải xuống.

------------------------------------------------------------------------

# 5. Kiểm tra tiến trình tạo file

Sau request đầu tiên, API tiếp tục trả về trạng thái.

Các trạng thái hợp lệ:

## queued

Ví dụ:

``` json
{
 "status": "queued",
 "percent": "0%",
 "fileUrl": "Waiting..."
}
```

Ý nghĩa:

-   Video đang chờ xử lý.
-   Chưa được tải xuống.

------------------------------------------------------------------------

## processing

Ví dụ:

``` json
{
 "status": "processing",
 "percent": "36%",
 "fileUrl": "In Processing..."
}
```

AI cần:

-   Tiếp tục chờ.
-   Không lấy fileUrl.
-   Không báo hoàn thành.

------------------------------------------------------------------------

## completed

Ví dụ:

``` json
{
 "status": "completed",
 "fileUrl": "https://files.ytcontent.com/..."
}
```

Đây là trạng thái cuối.

AI được phép sử dụng:

    fileUrl

để tải file.

------------------------------------------------------------------------

# 6. Logic xử lý cho AI

Pseudo code:

``` javascript
async function downloadYoutube(url) {

    start = POST(
        "https://ytsave.to/proxy.php",
        {
            url: url
        }
    )

    if(start.api.status !== "ok") {
        throw "Không thể khởi tạo"
    }


    while(true) {

        result = POST(
            "https://ytsave.to/proxy.php",
            {
                url: start.api.previewUrl
            }
        )


        status = result.api.status


        if(status === "completed") {
            return result.api.fileUrl
        }


        if(status === "queued" ||
           status === "processing") {

            wait()
            continue
        }


        throw "Lỗi xử lý"
    }
}
```

------------------------------------------------------------------------

# 7. Quy tắc quan trọng cho AI

## Không làm

❌ Không gọi nhiều request liên tục.

❌ Không sử dụng `fileUrl` khi:

    Waiting...
    In Processing...

❌ Không coi `queued` là hoàn thành.

❌ Không tự tạo URL tải xuống.

------------------------------------------------------------------------

## Nên làm

✅ Lưu `video id`.

✅ Theo dõi phần trăm:

    0%
    36%
    90%
    99%
    Completed

✅ Chỉ trả kết quả cuối khi:

``` json
status = completed
```

✅ Nếu lỗi cần thông báo rõ trạng thái.

------------------------------------------------------------------------

# 8. Response cuối cùng cần trả về

Khi hoàn thành:

``` json
{
 "status": "completed",
 "filename": "video.mp4",
 "size": "10.15 MB",
 "downloadUrl": "https://files.ytcontent.com/..."
}
```

------------------------------------------------------------------------

# 9. Tóm tắt cho AI Agent

Quy tắc:

1.  Gửi POST với `url`.
2.  Nhận video metadata.
3.  Poll trạng thái xử lý.
4.  Chờ `completed`.
5.  Lấy `fileUrl`.
6.  Không dùng URL tạm thời.

API này hoạt động theo mô hình:

**Submit job → Queue → Processing → Completed → Download**