import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
async function ambilBuku() {
  const res = await fetch(SUPABASE_URL + '/rest/v1/buku?select=*&order=judul', {
    headers: { apikey: SUPABASE_KEY }
  });
  if (!res.ok) {
    console.error('Gagal:', res.status);
    return null;
  }
  return await res.json();
}

// Warna badge sesuai status
function badge(status) {
  const kelas = {
    'Tersedia': 'badge-green',
    'Dipinjam': 'badge-red',
    'Baca di tempat': 'badge-yellow'
  }[status] ?? 'badge-gray';
  return `<span class="${kelas}">${status}</span>`;
}

async function tampilkan() {
  const tbody = document.querySelector('#daftar-buku');
  const jumlah = document.querySelector('#jumlah-buku');
  const buku = await ambilBuku();

  // Gagal ambil data
  if (buku === null) {
    tbody.innerHTML = `<tr><td colspan="7" class="staff-table-empty">Gagal memuat data.</td></tr>`;
    return;
  }

  // Data kosong
  if (buku.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="staff-table-empty">Belum ada buku.</td></tr>`;
    jumlah.textContent = 0;
    return;
  }

  // Isi tabel
  jumlah.textContent = buku.length;
  tbody.innerHTML = buku.map(b => `
    <tr>
      <td class="staff-table-title">${b.judul}</td>
      <td>${b.penulis}</td>
      <td>${b.jenis}</td>
      <td>${b.penerbit}, ${b.tahun}</td>
      <td><code>${b.no_panggil}</code></td>
      <td>${badge(b.status)}</td>
      <td>${b.lokasi}</td>
    </tr>
  `).join('');
}

tampilkan();