# Memora — Logic Member & Librarian

Dokumen ini menjelaskan flowchart:
- `memora-member-logic.png` — alur member
- `memora-librarian-logic.png` — alur librarian

**Stack:** HTML + CSS + JavaScript native (frontend) · Vercel Serverless Functions (JavaScript/Node.js) · MySQL (hosting eksternal).

---

## 1. Arsitektur

```
Browser (HTML/CSS/JS)  ──fetch('/api/...')──▶  Vercel Serverless Functions (/api/*.js)  ──mysql2──▶  MySQL
        ▲                                               │
        └──────────── JSON response + cookie JWT ◀──────┘
```

| Lapisan | Teknologi | Tugas |
|---|---|---|
| Frontend | HTML, CSS, JS (ES module, tanpa framework) | Menampilkan halaman, validasi form, memanggil API, render tabel |
| API | Vercel Serverless Functions (Node.js) | Cek login & role, cek aturan bisnis, query MySQL |
| Database | MySQL (Aiven / TiDB Cloud / Railway, pilih salah satu) | Menyimpan users, books, items, loans, fines, acquisitions |

> Vercel **tidak menyediakan MySQL**. Database harus di-hosting di layanan lain, lalu alamatnya disimpan di Environment Variable Vercel.

---

## 2. Struktur Folder

```
memora/
├── index.html                 ← OPAC (cari buku + tombol Reserve)
├── login.html
├── register.html
├── member/index.html          ← dashboard member
├── admin/index.html           ← dashboard librarian
├── css/
│   ├── base.css               ← reset, :root variables, tipografi
│   ├── layout.css             ← topbar, sidebar, content grid
│   ├── components.css         ← button, badge, table, form, card, dialog, toast
│   └── pages/ opac.css · member.css · admin.css
├── js/
│   ├── core/  api.js · auth.js · ui.js · utils.js · router.js
│   ├── pages/ login.js · register.js · opac.js
│   ├── member/ main.js · reservations.js · loans.js · fines.js
│   └── admin/  main.js · dashboard.js · members.js · catalog.js · acquisition.js
│               requests.js · desk.js · active.js · fines.js · reports.js
├── api/                       ← Vercel Serverless Functions
│   ├── _lib/ db.js · auth.js · rules.js · http.js
│   ├── auth.js · members.js · books.js · items.js · loans.js
│   └── fines.js · acquisitions.js · reports.js · dashboard.js
├── vercel.json
└── package.json               ← dependencies: mysql2, bcryptjs, jsonwebtoken
```

> **Kenapa satu file per resource?** Paket Vercel gratis (Hobby) membatasi jumlah Serverless Function per deployment (saat ini 12, cek lagi di dokumentasi Vercel). Karena itu endpoint dikelompokkan per resource (9 file). URL seperti `/api/loans/15/approve` diarahkan ke `api/loans.js` lewat `rewrites` di `vercel.json`:

```json
{
  "rewrites": [
    { "source": "/api/:resource/:p1/:p2", "destination": "/api/:resource?p1=:p1&p2=:p2" },
    { "source": "/api/:resource/:p1",     "destination": "/api/:resource?p1=:p1" }
  ]
}
```

Di dalam `api/loans.js`, handler membaca `req.method`, `req.query.p1` (id atau nama aksi) dan `req.query.p2` (aksi).

---

## 3. Aturan Bisnis

| Kode | Aturan | Dicek di |
|---|---|---|
| R1 | Member baru berstatus `pending`; hanya bisa login & pinjam setelah librarian menyetujui (`active`) | login, request, desk loan |
| R2 | Lama pinjam **7 hari** sejak disetujui | approve, desk loan |
| R3 | Perpanjang **+7 hari, maksimal 1 kali** (`renew_count` 0 → 1), dan hanya jika belum terlambat | renew |
| R4 | Maksimal **3 pinjaman** per member (status `pending` + `approved`) | request, desk loan |
| R5 | Denda **Rp 1.000/hari** keterlambatan, dibuat otomatis saat buku dikembalikan | return |
| R6 | Member yang punya denda `unpaid` **tidak bisa pinjam atau perpanjang** | request, desk loan, renew |
| R7 | Hanya eksemplar dengan `items.status = 'available'` yang bisa dipinjam | request, approve, desk loan |
| R8 | Member tidak boleh mengajukan buku yang sama 2 kali selama masih `pending`/`approved` | request |
| R9 | Saat satu request disetujui, request `pending` lain untuk eksemplar yang sama otomatis `rejected` | approve |
| R10 | Buku dengan `opac = 'hide'` tidak tampil di OPAC | GET /api/books |

> Semua aturan **wajib dicek di server** (`api/_lib/rules.js`). Pengecekan di JS browser hanya untuk pengalaman pengguna (pesan cepat), karena bisa diakali.

---

## 4. Status & Perpindahannya

| Entitas | Status | Perpindahan |
|---|---|---|
| `users` (member) | `pending`, `active`, `rejected`, `suspended` | register → `pending` → approve → `active` / reject → `rejected`; `active` ⇄ `suspended` |
| `loans` | `pending`, `approved`, `returned`, `rejected`, `cancelled` | request → `pending` → approve → `approved` → return → `returned`; `pending` → `rejected` / `cancelled`; desk loan langsung `approved` |
| `items` | `available`, `on_loan`, `repair`, `lost` | approve/desk loan → `on_loan`; return → `available`; librarian bisa set `repair`/`lost` |
| `fines` | `unpaid`, `paid` | return terlambat → `unpaid` → bayar di meja → `paid` |
| `acquisitions` | `ordered`, `received`, `cataloged` | input → `ordered` → buku datang → `received` → dikatalog → `cataloged` |

"Overdue" tidak disimpan sebagai status. Nilainya dihitung: `loans.status = 'approved' AND due_date < CURDATE()`.

---

## 5. Struktur Database (MySQL)

### 5.1 `users`
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | INT PK AUTO_INCREMENT | |
| member_code | VARCHAR(20) UNIQUE NULL | dibuat saat approve, mis. `MBR-0001` |
| name | VARCHAR(100) | |
| email | VARCHAR(150) UNIQUE | dipakai untuk login |
| phone | VARCHAR(20) | |
| password_hash | VARCHAR(255) | hasil `bcrypt`, **jangan simpan password asli** |
| role | ENUM('member','librarian') | |
| status | ENUM('pending','active','rejected','suspended') | default `pending` |
| approved_by | INT NULL FK → users.id | librarian yang menyetujui |
| approved_at | DATETIME NULL | |
| created_at | DATETIME | default `CURRENT_TIMESTAMP` |

### 5.2 `books` (data bibliografi)
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | INT PK | |
| title | VARCHAR(255) | |
| author | VARCHAR(255) | pernyataan tanggung jawab (SOR) |
| isbn | VARCHAR(17) NULL | |
| edition, place, publisher | VARCHAR | |
| year | SMALLINT | |
| collation | VARCHAR(255) | jumlah halaman, ukuran |
| call_number | VARCHAR(50) | nomor panggil |
| gmd | VARCHAR(50) | Text, Electronic, … |
| subject, classification | VARCHAR(100) | |
| cover_url | VARCHAR(255) NULL | |
| opac | ENUM('show','hide') | default `show` |
| created_at | DATETIME | |

### 5.3 `items` (eksemplar fisik — 1 buku bisa punya banyak eksemplar)
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | INT PK | |
| book_id | INT FK → books.id | |
| barcode | VARCHAR(50) UNIQUE | dipakai scanner |
| inventory_code | VARCHAR(50) | |
| location | VARCHAR(100) | rak / ruangan |
| status | ENUM('available','on_loan','repair','lost') | |

### 5.4 `loans`
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | INT PK | |
| user_id | INT FK → users.id | member peminjam |
| item_id | INT FK → items.id | |
| status | ENUM('pending','approved','returned','rejected','cancelled') | |
| request_date | DATETIME | waktu request online / desk |
| loan_date | DATE NULL | diisi saat approve |
| due_date | DATE NULL | `loan_date + 7` |
| return_date | DATETIME NULL | |
| renew_count | TINYINT | default 0, maks 1 |
| processed_by | INT NULL FK → users.id | librarian |
| note | VARCHAR(255) NULL | alasan tolak, dll. |

### 5.5 `fines`
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | INT PK | |
| loan_id | INT UNIQUE FK → loans.id | 1 pinjaman maks 1 denda |
| user_id | INT FK → users.id | |
| days_late | INT | |
| amount | INT | `days_late × 1000` |
| status | ENUM('unpaid','paid') | |
| paid_at | DATETIME NULL | |
| received_by | INT NULL FK → users.id | librarian penerima |

### 5.6 `acquisitions`
| Kolom | Tipe | Keterangan |
|---|---|---|
| id | INT PK | |
| order_number | VARCHAR(50) | nomor order / invoice |
| source | ENUM('purchase','donation','aid') | |
| acquisition_date | DATE | |
| supplier | VARCHAR(150) | vendor / donatur |
| funding_source | VARCHAR(100) | |
| quantity | INT | |
| unit_price | INT | Rupiah |
| total_price | INT | `quantity × unit_price` |
| status | ENUM('ordered','received','cataloged') | |
| book_id | INT NULL FK → books.id | diisi setelah dikatalog |
| created_by | INT FK → users.id | |

### 5.7 SQL

```sql
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  member_code VARCHAR(20) UNIQUE NULL,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  phone VARCHAR(20),
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('member','librarian') NOT NULL DEFAULT 'member',
  status ENUM('pending','active','rejected','suspended') NOT NULL DEFAULT 'pending',
  approved_by INT NULL,
  approved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE TABLE books (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  author VARCHAR(255),
  isbn VARCHAR(17),
  edition VARCHAR(50), place VARCHAR(100), publisher VARCHAR(150),
  year SMALLINT,
  collation VARCHAR(255),
  call_number VARCHAR(50),
  gmd VARCHAR(50), subject VARCHAR(100), classification VARCHAR(100),
  cover_url VARCHAR(255),
  opac ENUM('show','hide') NOT NULL DEFAULT 'show',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FULLTEXT KEY ft_search (title, author, subject)
);

CREATE TABLE items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  book_id INT NOT NULL,
  barcode VARCHAR(50) NOT NULL UNIQUE,
  inventory_code VARCHAR(50),
  location VARCHAR(100),
  status ENUM('available','on_loan','repair','lost') NOT NULL DEFAULT 'available',
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE loans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  item_id INT NOT NULL,
  status ENUM('pending','approved','returned','rejected','cancelled') NOT NULL DEFAULT 'pending',
  request_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  loan_date DATE NULL,
  due_date DATE NULL,
  return_date DATETIME NULL,
  renew_count TINYINT NOT NULL DEFAULT 0,
  processed_by INT NULL,
  note VARCHAR(255),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (item_id) REFERENCES items(id),
  FOREIGN KEY (processed_by) REFERENCES users(id),
  KEY idx_status_due (status, due_date)
);

CREATE TABLE fines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  loan_id INT NOT NULL UNIQUE,
  user_id INT NOT NULL,
  days_late INT NOT NULL,
  amount INT NOT NULL,
  status ENUM('unpaid','paid') NOT NULL DEFAULT 'unpaid',
  paid_at DATETIME NULL,
  received_by INT NULL,
  FOREIGN KEY (loan_id) REFERENCES loans(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (received_by) REFERENCES users(id)
);

CREATE TABLE acquisitions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_number VARCHAR(50) NOT NULL,
  source ENUM('purchase','donation','aid') NOT NULL,
  acquisition_date DATE,
  supplier VARCHAR(150),
  funding_source VARCHAR(100),
  quantity INT NOT NULL DEFAULT 1,
  unit_price INT NOT NULL DEFAULT 0,
  total_price INT NOT NULL DEFAULT 0,
  status ENUM('ordered','received','cataloged') NOT NULL DEFAULT 'ordered',
  book_id INT NULL,
  created_by INT NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
```

> Akun librarian pertama dibuat manual lewat SQL (`role = 'librarian'`, `status = 'active'`, `password_hash` dari bcrypt), karena form register hanya untuk member.

---

## 6. Endpoint API

| Method | URL | Role | Fungsi | Aturan |
|---|---|---|---|---|
| POST | `/api/auth/register` | publik | daftar member (`status = pending`) | email unik |
| POST | `/api/auth/login` | publik | cek email+password, set cookie JWT | R1 |
| POST | `/api/auth/logout` | login | hapus cookie | |
| GET | `/api/auth/me` | login | data user yang sedang login | |
| GET | `/api/books?q=&gmd=&subject=` | publik | cari buku + eksemplar | R10 |
| GET | `/api/books/:id` | publik | detail buku + daftar eksemplar | R10 |
| POST / PUT / DELETE | `/api/books[/:id]` | librarian | tambah / ubah / hapus buku | |
| POST / PUT | `/api/items[/:id]` | librarian | tambah / ubah eksemplar | barcode unik |
| GET | `/api/members?status=` | librarian | daftar member | |
| PATCH | `/api/members/:id/approve` | librarian | aktifkan + buat `member_code` | |
| PATCH | `/api/members/:id/reject` · `/suspend` · `/activate` | librarian | ubah status member | |
| POST | `/api/loans/request` | member | request pinjam `{ item_id }` | R1, R4, R6, R7, R8 |
| GET | `/api/loans?status=` | member / librarian | member: miliknya; librarian: semua | |
| PATCH | `/api/loans/:id/cancel` | member | batalkan request `pending` miliknya | |
| PATCH | `/api/loans/:id/renew` | member / librarian | perpanjang +7 hari | R3, R6 |
| PATCH | `/api/loans/:id/approve` | librarian | setujui request | R2, R7, R9 |
| PATCH | `/api/loans/:id/reject` | librarian | tolak `{ note }` | |
| POST | `/api/loans/direct` | librarian | pinjam di meja `{ member_code, barcode }` | R1, R2, R4, R6, R7 |
| PATCH | `/api/loans/:id/return` | librarian | kembalikan buku + buat denda | R5 |
| GET | `/api/fines/me` | member | denda milik sendiri | |
| GET | `/api/fines?status=` | librarian | semua denda | |
| PATCH | `/api/fines/:id/pay` | librarian | tandai lunas | |
| GET / POST / PATCH | `/api/acquisitions[/:id[/status]]` | librarian | data pengadaan | `total = qty × price` dihitung ulang di server |
| GET | `/api/dashboard/stats` | librarian | angka ringkasan dashboard | |
| GET | `/api/reports/:type?start=&end=` | librarian | `collection` · `loans` · `members` · `fines` | start ≤ end |

**Format respons:** sukses `{ "data": … }`; gagal `{ "error": "pesan" }` dengan kode HTTP `400` (input salah), `401` (belum login), `403` (role salah), `404`, `409` (data bentrok, mis. email/barcode sudah ada), `422` (melanggar aturan bisnis).

---

## 7. JavaScript — Function & Class

### 7.1 Bersama (`js/core/`)

| File | Nama | Jenis | Tugas |
|---|---|---|---|
| api.js | `apiFetch(path, { method, body })` | function | `fetch` + header JSON + `credentials: 'same-origin'`; lempar `ApiError`; jika 401 → ke `login.html` |
| api.js | `ApiError` | class | `status`, `message` dari server |
| auth.js | `Auth.login(email, password)` | static method | POST login, lalu redirect sesuai role |
| auth.js | `Auth.register(data)` | static method | POST register |
| auth.js | `Auth.me()` | static method | GET `/api/auth/me` |
| auth.js | `Auth.guard(role)` | static method | panggil `me()`; jika belum login / role beda → redirect |
| auth.js | `Auth.logout()` | static method | POST logout → `login.html` |
| ui.js | `showToast(message, type)` | function | notifikasi kecil (`success` / `error` / `info`) |
| ui.js | `confirmDialog(message, { withReason })` | function → Promise | buka `<dialog>`, kembalikan `{ ok, reason }` |
| ui.js | `renderTable(tbody, rows, columns)` | function | isi `<tbody>`; `columns` = daftar `{ key, label, render }` |
| ui.js | `badge(status)` | function | `<span class="badge badge--{status}">` |
| ui.js | `setLoading(button, isLoading)` | function | disable tombol + spinner |
| ui.js | `emptyState(message)` | function | tampilan "data kosong" |
| utils.js | `formatDate(date)` | function | `04 Nov 2026` |
| utils.js | `formatRupiah(n)` | function | `Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' })` |
| utils.js | `daysBetween(a, b)` · `addDays(date, n)` | function | hitung tanggal |
| utils.js | `debounce(fn, ms)` | function | untuk input pencarian |
| utils.js | `escapeHTML(str)` | function | cegah XSS saat render teks |
| utils.js | `toCSV(rows)` · `downloadBlob(text, filename)` | function | ekspor CSV |
| router.js | `Router` | class | baca `location.hash` → tampilkan `section[data-view]` → panggil `module.load()` |

### 7.2 Member

| File | Class / function | Method | Tugas |
|---|---|---|---|
| pages/register.js | `RegisterForm` | `validate()`, `submit()` | wajib isi, format email, password ≥ 8, konfirmasi sama |
| pages/login.js | `LoginForm` | `submit()` | panggil `Auth.login`, tampilkan pesan per status (`pending`, `rejected`, `suspended`) |
| pages/opac.js | `CatalogSearch` | `search(q, filters)`, `render(books)` | pencarian + daftar eksemplar per buku |
| pages/opac.js | `requestLoan(itemId)` | function | belum login → `login.html?redirect=…`; sudah login → POST `/api/loans/request` |
| member/reservations.js | `MyReservations` | `load()`, `render()`, `cancel(id)` | daftar request `pending`, tombol batal |
| member/loans.js | `MyLoans` | `load()`, `render()`, `renew(id)`, `isOverdue(loan)`, `estimateFine(loan)` | pinjaman aktif, sisa hari, perkiraan denda bila terlambat |
| member/fines.js | `MyFines` | `load()`, `render()`, `totalUnpaid()` | daftar denda + banner jika ada yang belum lunas |
| member/main.js | — | — | `Auth.guard('member')` lalu `new Router({ reservations, loans, fines })` |

### 7.3 Librarian

| File | Class | Method | Tugas |
|---|---|---|---|
| admin/dashboard.js | `Dashboard` | `load()` | kartu ringkasan: total buku, pinjaman aktif, overdue, member pending, denda unpaid |
| admin/members.js | `MemberVerification` | `load(status)`, `approve(id)`, `reject(id, reason)`, `suspend(id)`, `activate(id)` | verifikasi member baru |
| admin/catalog.js | `CatalogManager` | `load(q)`, `openForm(book?)`, `validateBook(data)`, `save()`, `remove(id)`, `addItem(bookId, data)` | CRUD buku + eksemplar; `validateISBN()` cek 10/13 digit |
| admin/acquisition.js | `AcquisitionManager` | `load()`, `calcTotal()`, `save()`, `setStatus(id, status)`, `openCatalogForm(acq)` | `calcTotal` dipanggil di event `input`; status `received` → buka form katalog terisi |
| admin/requests.js | `LoanRequests` | `load()`, `approve(id)`, `reject(id, reason)` | antrean request online |
| admin/desk.js | `DeskLoan` | `bindScanner()`, `submit(memberCode, barcode)` | scanner = keyboard: Enter → submit, fokus balik ke input |
| admin/active.js | `ActiveLoans` | `load()`, `returnLoan(id)`, `renew(id)` | baris overdue diberi class `table__row--overdue` |
| admin/fines.js | `FineManager` | `load(status)`, `markPaid(id)` | pelunasan denda |
| admin/reports.js | `ReportView` | `load(type, start, end)`, `validateRange()`, `exportCSV()` | laporan + unduh CSV di browser |
| admin/main.js | — | — | `Auth.guard('librarian')` lalu `new Router({ dashboard, members, catalog, … })` |

### 7.4 Server (`api/_lib/`)

| File | Function | Tugas |
|---|---|---|
| db.js | `getPool()` | `mysql2/promise.createPool(process.env.DATABASE_URL)`; disimpan di variabel global supaya dipakai ulang antar-request |
| db.js | `query(sql, params)` | **selalu prepared statement** (`?` placeholder), tidak menyambung string SQL |
| db.js | `transaction(fn)` | untuk approve / return (update `loans` + `items` + `fines` sekaligus) |
| auth.js | `hashPassword()` · `verifyPassword()` | `bcryptjs` |
| auth.js | `signToken(user)` · `getUser(req)` | `jsonwebtoken`; cookie `HttpOnly; Secure; SameSite=Lax` |
| auth.js | `requireRole(req, res, role)` | 401/403 jika tidak sesuai |
| rules.js | `canBorrow(userId, itemId)` | cek R1, R4, R6, R7, R8 → `{ ok, reason }` |
| rules.js | `canRenew(loan)` | cek R3, R6 |
| rules.js | `calcFine(dueDate, returnDate)` | `max(0, hari) × 1000` |
| http.js | `ok(res, data)` · `fail(res, status, message)` | format respons seragam |

---

## 8. Struktur HTML

### 8.1 Halaman

| File | Isi utama | Script |
|---|---|---|
| `index.html` | form cari, filter GMD/subject, grid buku, tombol Reserve per eksemplar | `js/pages/opac.js` |
| `register.html` | form: name, email, phone, password, confirm | `js/pages/register.js` |
| `login.html` | form: email, password | `js/pages/login.js` |
| `member/index.html` | tab: `#reservations`, `#loans`, `#fines` | `js/member/main.js` |
| `admin/index.html` | sidebar: `#dashboard`, `#members`, `#catalog`, `#acquisitions`, `#requests`, `#desk`, `#active`, `#fines`, `#reports` | `js/admin/main.js` |

### 8.2 Kerangka dashboard (member & admin sama polanya)

```html
<body class="app app--admin">
  <header class="topbar">
    <a class="topbar__brand" href="/">Memora</a>
    <span class="topbar__user" id="user-name"></span>
    <button class="btn btn--ghost" id="btn-logout">Logout</button>
  </header>

  <nav class="sidebar">
    <a class="sidebar__link" href="#members" data-nav="members">Members</a>
    <!-- … menu lain … -->
  </nav>

  <main class="content">
    <section class="view" data-view="members" hidden>
      <h1 class="view__title">Member Verification</h1>
      <div class="toolbar">
        <select id="member-status-filter">…</select>
      </div>
      <table class="table">
        <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Registered</th><th></th></tr></thead>
        <tbody id="members-tbody"></tbody>
      </table>
    </section>
    <!-- section lain: data-view="catalog", "requests", … -->
  </main>

  <dialog class="dialog" id="confirm-dialog">
    <form method="dialog">
      <p class="dialog__message"></p>
      <textarea class="dialog__reason" hidden></textarea>
      <button value="cancel" class="btn btn--ghost">Cancel</button>
      <button value="ok" class="btn btn--primary">OK</button>
    </form>
  </dialog>

  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <script type="module" src="/js/admin/main.js"></script>
</body>
```

### 8.3 Konvensi atribut

| Atribut | Contoh | Dipakai oleh |
|---|---|---|
| `data-view` | `<section data-view="loans">` | `Router` menampilkan/menyembunyikan section |
| `data-nav` | `<a data-nav="loans">` | menandai menu aktif |
| `data-action` + `data-id` | `<button data-action="renew" data-id="15">` | satu event listener per tabel (event delegation) |
| `id="…-tbody"` | `members-tbody`, `loans-tbody` | target `renderTable()` |
| `required`, `type="email"`, `minlength="8"`, `pattern` | di form | validasi bawaan browser sebelum JS |

---

## 9. Struktur CSS

### 9.1 Variabel (`base.css`)

```css
:root {
  --color-primary: #B5703B;   /* sama dengan warna flowchart */
  --color-bg: #F5F1EC;
  --color-surface: #FFFFFF;
  --color-text: #2B2B2B;
  --color-muted: #7A7A7A;
  --color-success: #2E7D32;
  --color-warning: #ED6C02;
  --color-danger: #C62828;
  --radius: 8px;
  --space: 16px;
  --sidebar-width: 240px;
  --font: system-ui, -apple-system, "Segoe UI", sans-serif;
}
```

### 9.2 Class utama

| File | Class | Keterangan |
|---|---|---|
| layout.css | `.app` | `display: grid; grid-template: "top top" auto "side main" 1fr / var(--sidebar-width) 1fr` |
| layout.css | `.topbar`, `.sidebar`, `.sidebar__link--active`, `.content`, `.view` | kerangka dashboard; di layar < 768px sidebar jadi menu atas (`@media`) |
| components.css | `.btn`, `.btn--primary`, `.btn--ghost`, `.btn--danger`, `.btn.is-loading` | tombol |
| components.css | `.badge` + `.badge--pending` `--active` `--approved` `--overdue` `--returned` `--rejected` `--cancelled` `--unpaid` `--paid` `--available` `--on_loan` | warna status |
| components.css | `.table`, `.table__row--overdue` | tabel data; baris terlambat berlatar merah muda |
| components.css | `.form`, `.form__group`, `.form__error`, `input:invalid` | form + pesan error |
| components.css | `.card`, `.card__value`, `.card__label` | kartu statistik dashboard & laporan |
| components.css | `.dialog`, `.dialog::backdrop` | dialog konfirmasi (`<dialog>` bawaan HTML) |
| components.css | `.toast`, `.toast--success` `--error` `--info`, `.toast.is-visible` | notifikasi |
| components.css | `.banner--warning` | peringatan denda belum lunas (member) |
| pages/opac.css | `.book-grid`, `.book-card`, `.book-card__cover` | `grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))` |

Penamaan memakai pola **BEM** (`block__element--modifier`) supaya mudah dibaca dan tidak bentrok.

---

## 10. Keamanan Minimum

| Risiko | Penanganan |
|---|---|
| Password bocor | simpan hash `bcrypt`, bukan teks asli |
| SQL injection | `query(sql, params)` dengan placeholder `?` |
| XSS | render teks dengan `textContent` atau `escapeHTML()`, bukan `innerHTML` mentah |
| Member mengakses fitur librarian | `requireRole()` di **setiap** endpoint server, bukan hanya menyembunyikan menu |
| Token dicuri lewat JS | JWT di cookie `HttpOnly; Secure; SameSite=Lax`, tidak di `localStorage` |
| Dua librarian approve barang yang sama | `transaction()` + cek ulang `items.status` di dalam transaksi (R7, R9) |

---

## 11. Deploy ke Vercel

1. Buat database MySQL di layanan eksternal, lalu jalankan SQL di bagian 5.7.
2. Isi **Environment Variables** di Vercel: `DATABASE_URL` (format `mysql://user:pass@host:port/dbname`) dan `JWT_SECRET` (string acak panjang). Sebagian layanan MySQL mewajibkan SSL; aktifkan opsi `ssl` di `createPool`.
3. `package.json`: `"type": "module"` dan dependencies `mysql2`, `bcryptjs`, `jsonwebtoken`.
4. Push ke GitHub, lalu import repo di Vercel. File HTML/CSS/JS otomatis disajikan sebagai file statis, dan folder `api/` otomatis menjadi Serverless Functions.
5. Untuk menjalankan di komputer sendiri: `npx vercel dev` (frontend dan API berjalan bersama).
