# Design Canvas

Editor desain pribadi di browser: kamu bisa mengedit sendiri seperti di Figma, dan Claude bisa ikut mendesain lewat MCP.

## Cara pakai
1. Buka sesi Claude Code baru di folder ini. Server `design-canvas` sudah disetujui lewat `.claude/settings.local.json`.
2. Buka **http://localhost:3333** di browser. Kanvas hanya bisa dibuka selama sesi Claude itu masih terbuka.
3. Minta Claude mendesain, atau pilih sebuah elemen lalu bilang *"ubah yang kupilih jadi tombol outline"*.

## Tampilan editor
- **Atas, Toolbar**: Select (V), Hand (H), Frame (F), Rectangle (R), Text (T), Ikon (Shift+I), Undo, Redo. Di kanan: Lihat kode (`</>`), Preview responsif, daftar shortcut (`?`).
- **Kiri**, tiga tab: **Layers**, **Komponen**, dan **Versi**.
- **Layers**: struktur elemen tiap artboard. Klik untuk memilih, klik ▸ untuk membuka atau menutup. **Drag layer** untuk mengubah urutan: garis biru = sebelum/sesudah, kotak biru = masuk ke dalam frame.
- **Tengah, Kanvas**: hover memunculkan garis biru, klik untuk memilih. Klik nama artboard untuk memilih artboard-nya.
  - Geser artboard: drag namanya, atau drag di dalam artboard yang sedang terpilih. Resize lewat 8 handle putih.
  - Double-click teks untuk mengedit langsung (Enter/Esc = selesai). Double-click nama artboard untuk mengganti namanya.
- **Kanan, Properti**: ukuran, layout (flex), padding/margin, fill, border, radius, teks, shadow, dan ekspor PNG. Perubahan langsung terlihat dan otomatis tersimpan. Kalau tidak ada yang dipilih, panel ini menampilkan **design tokens**.

### Multi-select & copy-paste
- **Shift+klik** (di kanvas atau Layers) untuk memilih beberapa elemen. Hapus, duplikat, dan geser artboard berlaku ke semuanya, dan **edit properti berlaku ke semua yang terpilih**.
- **Ctrl+A** memilih semua elemen yang sejajar (atau semua artboard).
- **Ctrl+C / X / V** memakai clipboard sistem. HTML yang di-copy bisa di-paste ke VS Code. Sebaliknya, HTML atau teks dari luar bisa di-paste ke kanvas.
- Tempat paste: frame/artboard terpilih → masuk ke dalamnya. Elemen biasa → tepat setelahnya.

### Gambar & ikon
- **Drag file gambar** dari Explorer ke kanvas, atau **paste** gambar (mis. hasil screenshot). File disalin ke `designs/assets/`. Gambar yang di-drop di luar artboard menjadi artboard baru.
- **Ikon**: tombol bintang di toolbar (Shift+I), cari dengan kata kunci bahasa Inggris, lalu klik untuk menyisipkan. Ikon dari [Lucide](https://lucide.dev), disisipkan sebagai SVG, jadi ukuran, warna, dan ketebalan garis bisa diubah di bagian **Ikon**.

### Design tokens
- Semua token ada di `designs/tokens.css` dan otomatis di-link ke setiap artboard.
- Edit di panel kanan saat tidak ada yang dipilih: ubah nilai, **+** untuk menambah, **×** untuk menghapus. Semua desain yang memakai token itu langsung ikut berubah.
- Di panel properti, tombol **◇** di ujung field memasang token. Field yang memakai token tampil dengan nama token berwarna ungu. Ketik nilai lain untuk melepasnya.
- Grup token dari awalan namanya: `color-`, `font-`, `text-` (ukuran teks), `space-`, `radius-`, `shadow-`.

### Komponen
- Pilih elemen (mis. tombol atau kartu), lalu tekan **Ctrl+Alt+K** atau tombol di tab Komponen. Elemen itu menjadi **master** (ikon ◆ ungu).
- Di tab **Komponen**, klik sebuah komponen untuk menyisipkan **salinan** (instance, ikon ◇) ke frame/elemen terpilih.
- Ubah master, dan semua salinan di semua artboard ikut berubah. Salinan tidak bisa diedit langsung: pakai **Edit master**, atau **Detach** kalau satu salinan perlu dibuat berbeda.
- Menduplikat atau mem-paste master menghasilkan salinan, bukan master kedua.
- Sinkronisasi dijalankan oleh editor, jadi perubahan master yang dibuat Claude saat editor tertutup akan diterapkan begitu editor dibuka.

### Google Fonts
- Di bagian **Teks**, tombol **▾** pada field Font membuka daftar 42 font populer, masing-masing ditampilkan dalam font aslinya. Link font otomatis ditambahkan ke artboard.
- Token font (`font-sans`, dll.) juga punya tombol ▾. Font token otomatis dimuat lewat `tokens.css`.
- Butuh internet untuk memuat font.

### Riwayat versi
- Tab **Versi**: beri nama, lalu **Simpan versi sekarang**. Versi menyimpan semua artboard dan token, dan tetap ada walaupun browser ditutup.
- **Pulihkan** mengembalikan semua artboard ke versi itu. Kondisi sebelumnya otomatis disimpan dulu sebagai versi baru, jadi pemulihan selalu bisa dibatalkan.
- Claude bisa membuat versi sendiri (`save_version`) sebelum perubahan besar.

### Preview responsif
Pilih artboard (atau elemen di dalamnya), lalu klik tombol Preview di toolbar. Desain tampil berdampingan di lebar Mobile/Tablet/Laptop/Desktop (bisa dipilih) dan ikut ter-update saat kamu mengedit. Esc untuk menutup.

### Ekspor ke kode
Pilih artboard atau elemen, lalu klik `</>` di toolbar (atau **Lihat kode** di bagian Ekspor):
- **HTML**: dokumen rapi yang bisa dibuka sendiri (token sudah disertakan).
- **React**: komponen JSX (`className`, `style={{...}}`).
- **CSS**: token + style artboard, untuk dipakai bersama kode React.

### Ekspor PNG
Pilih artboard atau elemen, lalu di bagian **Ekspor** pilih 1x/2x/3x dan klik **Ekspor PNG**. Kalau beberapa yang terpilih, masing-masing diekspor. Elemen diekspor dengan latar transparan.

### Garis bantu merah (smart guides & pengukur jarak)
- **Smart guides**: saat menggeser, resize, atau menggambar artboard, garis merah muncul begitu tepi atau tengahnya sejajar dengan artboard lain, dan artboard otomatis menempel. Tahan **Ctrl** untuk mematikan snap sementara.
- **Pengukur jarak**: pilih elemen, tahan **Alt**, lalu arahkan mouse ke elemen lain untuk melihat jaraknya dalam px. Tanpa menunjuk elemen lain, yang ditampilkan adalah jarak ke keempat tepi induknya.
- Elemen di dalam artboard tidak di-snap, karena posisinya diatur oleh layout (padding, gap, margin). Pakai pengukur Alt untuk mengecek jaraknya.

### Menggambar
Pilih Frame, Rect, atau Text, lalu drag (atau klik) di kanvas. Karena posisi di HTML diatur oleh layout:
- Elemen baru masuk ke **wadah tempat kamu mulai menggambar**. Wadahnya ditandai garis biru saat hover.
- Urutannya mengikuti posisi mouse, dan ukurannya mengikuti hasil drag. Kalau cuma diklik, ukurannya 100×100.
- **Frame** = div dengan auto-layout vertikal. **Rect** = kotak abu-abu. **Text** = paragraf yang langsung bisa diketik.
- Frame yang digambar **di luar artboard** menjadi artboard baru. Selama tool Frame aktif, panel kanan menampilkan preset ukuran layar.
- Setelah menggambar, tool otomatis kembali ke Select. Tekan Esc untuk batal.

Field angka: ketik angka (otomatis px) atau nilai CSS seperti `auto` / `50%`. Bisa juga tekan ↑/↓ (tahan Shift = ×10), atau **drag label-nya ke kiri/kanan** seperti di Figma.

**Undo** mencakup semua aksi, termasuk perubahan dari Claude. Riwayat undo hilang kalau halaman di-refresh.

## Shortcut
Tekan **?** di editor untuk melihat daftar ini.

| Aksi | Cara |
|---|---|
| Tool Select / Hand | V / H |
| Tool Frame / Rect / Text | F / R / T |
| Pan | Scroll / tahan Space + drag / drag tombol tengah mouse |
| Zoom | Ctrl + scroll / pinch trackpad / Ctrl + `=` `-` |
| Tampilkan semua | Shift + 1 atau tombol **Fit** |
| Zoom ke seleksi | Shift + 2 |
| Zoom 100% | Shift + 0 atau klik angka persen |
| Undo / Redo | Ctrl + Z / Ctrl + Shift + Z (atau Ctrl + Y) |
| Pilih banyak | Shift + klik |
| Pilih semua sejajar | Ctrl + A |
| Copy / Cut / Paste | Ctrl + C / X / V |
| Ikon | Shift + I |
| Jadikan komponen | Ctrl + Alt + K |
| Ukur jarak | Tahan Alt + arahkan mouse |
| Matikan snap sementara | Tahan Ctrl saat drag |
| Duplikat | Ctrl + D |
| Hapus | Delete / Backspace |
| Edit teks | Double-click / Enter pada layer teks |
| Pilih anak | Enter |
| Pilih induk | Esc / Shift + Enter |

## Tool MCP untuk Claude
- `list_artboards`: daftar artboard
- `create_artboard`: buat artboard (nama, lebar, tinggi, HTML awal)
- `write_html`: ganti isi artboard (opsional: ubah ukuran)
- `get_dom`: baca HTML, bisa per selector beserta posisi/ukuran hasil render
- `get_selection`: elemen yang sedang kamu pilih di kanvas (bisa lebih dari satu)
- `screenshot`: gambar PNG artboard, atau satu elemen lewat `selector`
- `get_tokens` / `set_tokens`: baca dan ubah design tokens
- `get_icons`: cari ikon Lucide, hasilnya SVG siap tempel
- `save_version` / `list_versions` / `restore_version`: riwayat versi

## File
- `designs/*.html`: setiap artboard. Editan dari panel properti tersimpan sebagai inline style (`style="..."`).
- `designs/artboards.json`: nama, ukuran, dan posisi artboard.
- `designs/tokens.css`: design tokens.
- `designs/assets/`: gambar yang kamu tambahkan.
- `designs/.versions/`: versi tersimpan.

## Kalau server terputus
Server menyala selama ada sesi Claude Code yang terbuka di folder ini. Kalau sesi ditutup, editor menampilkan banner merah. Editan yang dibuat selama itu disimpan di browser dan otomatis dikirim begitu server menyala lagi, asalkan tab editornya tidak ditutup.
- `designs/.trash/`: artboard yang dihapus dari editor. File-nya tidak langsung dibuang, jadi masih bisa diselamatkan.
