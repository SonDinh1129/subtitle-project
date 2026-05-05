# SubAI — Sơ đồ Use Case (PlantUML)

Render tại [plantuml.com/plantuml](https://www.plantuml.com/plantuml/uml) hoặc VS Code extension **PlantUML**.

---

## Sơ đồ tổng quan

```plantuml
@startuml SubAI_UseCases

skinparam actorStyle awesome
skinparam packageStyle rectangle
skinparam usecaseBorderColor #2C5F9E
skinparam usecaseBackgroundColor #EAF2FB
skinparam packageBorderColor #888888
skinparam packageBackgroundColor #FAFAFA
skinparam arrowColor #444444
skinparam actorBorderColor #333333
skinparam shadowing false

left to right direction

actor "Guest" as Guest
actor "Free User" as Free
actor "Premium User" as Premium
actor "PayOS" as PayOS
actor "Colab VM2" as VM2
actor "Colab VM1" as VM1

Free --|> Guest
Premium --|> Free

rectangle "SubAI" {

  package "Xác thực" {
    usecase "Đăng ký Email\n(UC-04)" as UC04
    usecase "Đăng ký OAuth\n(UC-05/06)" as UC05
    usecase "Đăng nhập Email\n(UC-07)" as UC07
    usecase "Quên mật khẩu\n(UC-10)" as UC10
    usecase "Kiểm tra xác thực\n(UC-11)" as UC11
  }

  package "Upload & Xử lý" {
    usecase "Upload Normal Mode\n(UC-12/13/15)" as UC12
    usecase "Bị chặn Realtime / Limit\n(UC-14/16)" as UC14
    usecase "Upload Realtime Mode\n(UC-32/33)" as UC32
  }

  package "Editor" {
    usecase "Xem video + subtitle\n(UC-17)" as UC17
    usecase "Chỉnh sửa subtitle\n(UC-18/19/20)" as UC18
  }

  package "Xuất kết quả" {
    usecase "Download SRT\n(UC-26/27)" as UC26
    usecase "Export video burned\n(UC-28)" as UC28
  }

  package "Tài khoản" {
    usecase "Xem thông tin tài khoản\n(UC-29)" as UC29
    usecase "Đăng xuất\n(UC-30)" as UC30
    usecase "Nâng cấp Premium\n(UC-31)" as UC31
  }

  package "Thanh toán" {
    usecase "Webhook xác nhận\n(UC-36)" as UC36
  }

}

' ── Actor → Use Case ──────────────────────────────────
Guest --> UC04
Guest --> UC05
Guest --> UC07
Guest --> UC10

Free --> UC12
Free --> UC14
Free --> UC17
Free --> UC18
Free --> UC26
Free --> UC28
Free --> UC29
Free --> UC30
Free --> UC31

Premium --> UC32

PayOS --> UC36

' ── <<include>> — luôn xảy ra, bắt buộc ──────────────
UC12 ..> UC11 : <<include>>
UC32 ..> UC11 : <<include>>
UC17 ..> UC11 : <<include>>

UC18 ..> UC17 : <<include>>
UC26 ..> UC17 : <<include>>
UC28 ..> UC17 : <<include>>

UC31 ..> UC36 : <<include>>

' ── <<extend>> — có điều kiện, tuỳ chọn ──────────────
UC14 ..> UC12 : <<extend>>
UC32 ..> UC12 : <<extend>>

' ── Phụ thuộc hệ thống ngoài ─────────────────────────
UC12 ..> VM2 : <<uses>>
UC32 ..> VM1 : <<uses>> (EN)
UC32 ..> VM2 : <<uses>> (VI)

@enduml
```

---

## Bảng Actor → Use Case

| Actor | Use Cases |
|-------|-----------|
| Guest | UC-04, UC-05/06, UC-07, UC-10 |
| Free User | UC-12/13/15, UC-14/16, UC-17, UC-18/19/20, UC-26/27, UC-28, UC-29, UC-30, UC-31 |
| Premium User | UC-32/33 (+ tất cả của Free User) |
| PayOS | UC-36 |
| Colab VM2 | UC-12/13/15 (Normal), UC-32/33 (VI Realtime) |
| Colab VM1 | UC-32/33 (EN Realtime) |
