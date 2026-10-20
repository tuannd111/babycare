# Sổ Tay 180 Ngày Đầu

Cẩm nang tương tác cho bố mẹ có con 0–6 tháng: chăm bé, việc mỗi ngày, đồ cần chuẩn bị, tâm lý, hiểu lầm thường gặp, dấu hiệu bất thường và nơi liên hệ.

Trang web: https://tuannd111.github.io/babycare/

## Các file

| File | Nội dung |
| --- | --- |
| `index.html` | Toàn bộ trang: nội dung, giao diện, tương tác |
| `cloud.js` | Đăng nhập và ghi chung theo gia đình (Firebase) |
| `firebase-config.js` | Cấu hình Firebase. Để `null` thì trang chạy không cần đăng nhập |
| `firestore.rules` | Luật bảo mật Firestore, dán vào Firebase console |
| `so-tay-180-ngay.html` | Chuyển hướng từ địa chỉ cũ sang `index.html` |

## Xem thử trên máy

```bash
python3 -m http.server 8000
```

Mở http://localhost:8000/

## Bật đăng nhập và ghi chung theo gia đình

Khi chưa bật, mọi dữ liệu chỉ lưu trên từng trình duyệt. Sau khi bật, mỗi người có tài khoản riêng, cùng vào một "gia đình" và thấy cùng một nhật ký, danh sách chuẩn bị, ngày sinh và danh bạ. Gói miễn phí (Spark) của Firebase là đủ cho một gia đình.

Giao diện Firebase console mới thu gọn thanh bên trái thành biểu tượng, nên có thể không thấy mục "Build". Khi đó dùng ô tìm kiếm (biểu tượng kính lúp) gõ tên sản phẩm, hoặc mở thẳng các link dưới đây (dự án `baby-care-38ede`):

- Authentication: https://console.firebase.google.com/project/baby-care-38ede/authentication
- Firestore: https://console.firebase.google.com/project/baby-care-38ede/firestore
- Cấu hình app web: https://console.firebase.google.com/project/baby-care-38ede/settings/general

1. **Tạo dự án.** Vào https://console.firebase.google.com, bấm **Create a project**, đặt tên (ví dụ `babycare`). Có thể tắt Google Analytics.
2. **Bật đăng nhập.** Vào **Build → Authentication → Get started**. Ở tab **Sign-in method**, bật **Email/Password**. Nếu muốn đăng nhập bằng Google, bật thêm **Google**.
3. **Cho phép tên miền.** Vẫn trong Authentication, mở tab **Settings → Authorized domains**, bấm **Add domain**, thêm `tuannd111.github.io`. (`localhost` đã có sẵn.)
4. **Tạo cơ sở dữ liệu.** Vào **Build → Firestore Database → Create database**. Chọn vị trí `asia-southeast1 (Singapore)`, chọn **Start in production mode**.
5. **Dán luật bảo mật.** Trong Firestore, mở tab **Rules**, xóa nội dung cũ, dán toàn bộ file `firestore.rules`, bấm **Publish**.
6. **Lấy cấu hình.** Vào **Project settings** (bánh răng) → **General** → mục **Your apps**, bấm biểu tượng **Web** (`</>`), đặt tên app, bấm **Register app**. Sao chép đoạn `firebaseConfig = { ... }`.
7. **Dán cấu hình.** Mở `firebase-config.js`, thay `window.FIREBASE_CONFIG = null;` bằng `window.FIREBASE_CONFIG = { ...đoạn vừa sao chép... };`. Các giá trị này không phải bí mật, có thể đưa lên GitHub; dữ liệu được bảo vệ bằng luật ở bước 5.
8. **Đưa lên mạng.** `git commit -am "Bật Firebase" && git push`.

## Cách dùng

1. Người thứ nhất bấm **Đăng nhập** trên thanh menu, tạo tài khoản, nhập tên (ví dụ "Bố") và bấm **Tạo gia đình**. Dữ liệu đang có trên máy đó được đưa vào gia đình.
2. Trong cửa sổ tài khoản có **mã mời 8 ký tự**. Gửi mã cho người nhà.
3. Người nhà mở trang, tạo tài khoản, nhập tên (ví dụ "Mẹ"), nhập mã ở mục **Đã có người nhà tạo rồi?** và bấm **Tham gia**.
4. Từ đó, ai bấm "+ Thêm" cữ bú thì máy kia thấy ngay, kèm tên người ghi.

Mất mạng vẫn ghi được; dữ liệu tự gửi lên khi có mạng lại. **Đăng xuất** sẽ xóa dữ liệu gia đình khỏi máy đó (dữ liệu trên mạng vẫn còn).
