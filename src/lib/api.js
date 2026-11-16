import { SUPABASE_URL,SUPABASE_KEY  } from "./config.js";

async function ambilBuku() {
  const res = await fetch(SUPABASE_URL + '/rest/v1/buku?select=*', {
    headers: { apikey: SUPABASE_KEY }   // wajib untuk Supabase
  });

  if (!res.ok) {                         // misalnya 401 atau 404
    console.error('Gagal:', res.status);
    return [];
  }

  return await res.json();               // array buku
}