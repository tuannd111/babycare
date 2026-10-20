// Cấu hình Firebase cho chức năng đăng nhập và ghi chung theo gia đình.
// Đặt về null thì trang chạy như cũ, dữ liệu chỉ lưu trên từng máy.
// Lấy cấu hình ở: Firebase console → Project settings → General → Your apps → Web app → SDK setup and configuration → Config.
// Các giá trị này không phải bí mật; dữ liệu được bảo vệ bằng luật trong firestore.rules.
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyD52P5Xt2EQOJcaHM06ujLxQaIYydxwDV4",
  authDomain: "baby-care-38ede.firebaseapp.com",
  projectId: "baby-care-38ede",
  storageBucket: "baby-care-38ede.firebasestorage.app",
  messagingSenderId: "867626639817",
  appId: "1:867626639817:web:c6b3b04f559bb6c5424818"
};
