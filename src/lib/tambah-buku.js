import { SUPABASE_KEY, SUPABASE_URL } from "../config.js";



document.querySelector('#daftar').innerHTML = buku.map(b => `
  <div>
    <h3>${b.judul}</h3>
    <p>${b.penulis} (${b.tahun})</p>
    <p>${b.status} · ${b.lokasi}</p>
  </div>
`).join('');