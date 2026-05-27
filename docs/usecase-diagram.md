# SubAI — Sơ đồ Use Case (PlantUML)

Render tại [plantuml.com/plantuml](https://www.plantuml.com/plantuml/uml) hoặc VS Code extension **PlantUML**.

Chia thành 3 diagram theo nhóm chức năng:
- **Diagram 1** — Xác thực (Guest)
- **Diagram 2** — Upload & Xử lý (Free User, Premium User, Colab VMs)
- **Diagram 3** — Tài khoản & Thanh toán (Free User, Premium User, MoMo)

---

## Diagram 1 — Xác thực

```plantuml
@startuml SubAI_Auth

skinparam actorStyle awesome
skinparam packageStyle rectangle
skinparam usecaseBorderColor #2C5F9E
skinparam usecaseBackgroundColor #EAF2FB
skinparam packageBorderColor #7A9CC4
skinparam packageBackgroundColor #F5F9FF
skinparam packageFontStyle bold
skinparam arrowColor #555555
skinparam actorBorderColor #333333
skinparam shadowing false
skinparam nodesep 45
skinparam ranksep 55

left to right direction

actor "Guest"    as Guest
actor "Free User" as Free

Free --|> Guest

rectangle "SubAI" {
  package "Xác thực" {
    usecase "Đăng ký Email (UC-04)"     as UC04
    usecase "Đăng ký OAuth (UC-05/06)"  as UC05
    usecase "Đăng nhập Email (UC-07)"   as UC07
    usecase "Quên mật khẩu (UC-10)"     as UC10
    usecase "Kiểm tra xác thực (UC-11)" as UC11
  }
}

Guest --> UC04
Guest --> UC05
Guest --> UC07
Guest --> UC10

' UC-11 là internal helper, không do actor kích hoạt trực tiếp
note bottom of UC11
  Được <<include>> bởi
  các UC yêu cầu đăng nhập
end note

@enduml
```

---

## Diagram 2 — Upload & Xử lý / Editor / Xuất kết quả

```plantuml
@startuml SubAI_Core

skinparam actorStyle awesome
skinparam packageStyle rectangle
skinparam usecaseBorderColor #2C5F9E
skinparam usecaseBackgroundColor #EAF2FB
skinparam packageBorderColor #7A9CC4
skinparam packageBackgroundColor #F5F9FF
skinparam packageFontStyle bold
skinparam arrowColor #555555
skinparam actorBorderColor #333333
skinparam shadowing false
skinparam nodesep 45
skinparam ranksep 55

left to right direction

actor "Free User"     as Free
actor "Premium User"  as Premium
actor "Colab VM1\n(EN Realtime)" as VM1
actor "Colab VM2\n(VI / Normal)" as VM2

Premium --|> Free

rectangle "SubAI" {

  package "Upload & Xử lý" {
    usecase "Upload Normal "  as UC12
    usecase "Upload Realtime "   as UC32
    usecase "Bị chặn / Limit "  as UC14
    usecase "Kiểm tra xác thực "   as UC11
  }

  package "Editor" {
    usecase "Xem video + subtitle "     as UC17
    usecase "Chỉnh sửa subtitle " as UC18
  }

  package "Xuất kết quả" {
    usecase "Download SRT "              as UC26
    usecase "Export video burned "       as UC28
    usecase "Đánh giá chất lượng dịch " as UC41
  }

}

' Actors → Use Cases
Free    --> UC12
Free    --> UC14
Free    --> UC17
Free    --> UC18
Free    --> UC26
Free    --> UC28
Free    --> UC41
Premium --> UC32

' Hệ thống ngoài
UC12 ..> VM2 : <<uses>>
UC32 ..> VM1 : <<uses>>
UC32 ..> VM2 : <<uses>>

' <<include>>
UC12 ..> UC11 : <<include>>
UC32 ..> UC11 : <<include>>
UC17 ..> UC11 : <<include>>

UC18 ..> UC17 : <<include>>
UC26 ..> UC17 : <<include>>
UC28 ..> UC17 : <<include>>
UC41 ..> UC17 : <<include>>

' <<extend>>
UC14 ..> UC12 : <<extend>>
UC32 ..> UC12 : <<extend>>

@enduml
```

---

## Diagram 3 — Tài khoản & Thanh toán

```plantuml
@startuml SubAI_Account

skinparam actorStyle awesome
skinparam packageStyle rectangle
skinparam usecaseBorderColor #2C5F9E
skinparam usecaseBackgroundColor #EAF2FB
skinparam packageBorderColor #7A9CC4
skinparam packageBackgroundColor #F5F9FF
skinparam packageFontStyle bold
skinparam arrowColor #555555
skinparam actorBorderColor #333333
skinparam shadowing false
skinparam nodesep 45
skinparam ranksep 55

left to right direction

actor "Free User"    as Free
actor "Premium User" as Premium
actor "MoMo"         as MoMo

Premium --|> Free

rectangle "SubAI" {

  package "Tài khoản" {
    usecase "Xem thông tin tài khoản" as UC29
    usecase "Đăng xuất"               as UC30
    usecase "Nâng cấp Premium"        as UC31
  }

  package "Thanh toán" {
    usecase "IPN xác nhận" as UC36
  }

}

Free --> UC29
Free --> UC30
Free --> UC31

MoMo --> UC36

UC31 ..> UC36 : <<include>>

@enduml
```

---

## Bảng Actor → Use Case

| Actor | Use Cases |
|-------|-----------|
| Guest | UC-04, UC-05/06, UC-07, UC-10 |
| Free User | UC-12/13/15, UC-14/16, UC-17, UC-18/19/20, UC-26/27, UC-28, UC-41, UC-29, UC-30, UC-31 |
| Premium User | UC-32/33 (+ tất cả của Free User) |
| MoMo | UC-36 |
| Colab VM1 | UC-32/33 (EN Realtime) |
| Colab VM2 | UC-12/13/15 (Normal), UC-32/33 (VI Realtime) |
