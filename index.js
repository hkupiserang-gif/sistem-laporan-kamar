const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 8888;

// === KONEKSI DATABASE ===
const pool = new Pool({
  user: 'postgres',          // Ganti sesuai user DB Anda
  host: 'localhost',
  database: 'nama_database', // Ganti nama DB Anda
  password: 'password_db',   // Ganti sandi DB Anda
  port: 5432
});

// Cek koneksi
pool.connect((err) => {
  if (err) {
    console.error("❌ Gagal koneksi DB:", err);
  } else {
    console.log("✅ Database terhubung dengan baik");
  }
});

// === KONFIGURASI ===
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'horison2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 86400000 }
}));

// === HALAMAN LOGIN ===
app.get('/', (req, res) => {
  if (req.session.user) {
    if (req.session.user.peran === 'SPV') return res.redirect('/spv');
    if (req.session.user.peran === 'RA') return res.redirect('/ra');
    if (req.session.user.peran === 'OT') return res.redirect('/ot');
  }
  res.render('login', { pesan: null });
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const hasil = await pool.query(
      "SELECT * FROM pengguna WHERE username = $1 AND aktif = true",
      [username.trim()]
    );
    const user = hasil.rows[0];

    if (user && user.password === password) {
      req.session.user = {
        id: user.id,
        nama: user.nama,
        peran: user.peran
      };
      if (user.peran === 'SPV') return res.redirect('/spv');
      if (user.peran === 'RA') return res.redirect('/ra');
      if (user.peran === 'OT') return res.redirect('/ot');
    } else {
      res.render('login', { pesan: '❌ Username atau sandi salah' });
    }
  } catch (err) {
    console.error("Login Error:", err);
    res.render('login', { pesan: '❌ Kesalahan sistem, cek koneksi database' });
  }
});

// === PANEL SUPERVISOR ===
app.get('/spv', async (req, res) => {
  if (!req.session.user || req.session.user.peran !== 'SPV') return res.redirect('/');
  try {
    const hariIni = new Date().toISOString().split('T')[0];
    const kamar = await pool.query("SELECT * FROM kamar ORDER BY nomor_kamar");
    const petugas = await pool.query("SELECT nama FROM pengguna WHERE peran = 'RA' AND aktif = true ORDER BY nama");
    const tugas = await pool.query("SELECT * FROM tugas WHERE tanggal = $1 ORDER BY kamar", [hariIni]);

    res.render('spv', {
      user: req.session.user,
      tanggal: hariIni,
      daftarKamar: kamar.rows,
      daftarRA: petugas.rows,
      daftarTugas: tugas.rows
    });
  } catch (err) {
    console.error("SPV Error:", err);
    res.render('spv', { user: req.session.user, pesan: 'Gagal memuat data' });
  }
});

app.post('/tambah-tugas', async (req, res) => {
  try {
    const { tanggal, petugas, kamar, status_awal } = req.body;
    await pool.query(`
      INSERT INTO tugas (tanggal, kamar, petugas, status_awal)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (tanggal, kamar) DO UPDATE SET petugas = $3, status_awal = $4
    `, [tanggal, kamar, petugas, status_awal]);
    res.redirect('/spv?pesan=berhasil');
  } catch (err) {
    console.error("Tugas Error:", err);
    res.redirect('/spv?pesan=gagal');
  }
});

// === PANEL ROOMBOY ===
app.get('/ra', async (req, res) => {
  if (!req.session.user || req.session.user.peran !== 'RA') return res.redirect('/');
  try {
    const hariIni = new Date().toISOString().split('T')[0];
    const tugas = await pool.query(`
      SELECT t.*, l.waktu_masuk, l.waktu_keluar, l.keterangan
      FROM tugas t
      LEFT JOIN laporan l ON t.tanggal = l.tanggal AND t.kamar = l.nomor_kamar
      WHERE t.tanggal = $1 AND t.petugas = $2
      ORDER BY t.kamar
    `, [hariIni, req.session.user.nama]);

    res.render('ra', { user: req.session.user, tugas: tugas.rows });
  } catch (err) {
    console.error("RA Error:", err);
    res.redirect('/');
  }
});

app.post('/simpan-laporan', async (req, res) => {
  try {
    const { tanggal, kamar, waktu_masuk, waktu_keluar, keterangan } = req.body;
    await pool.query(`
      INSERT INTO laporan (tanggal, nomor_kamar, waktu_masuk, waktu_keluar, keterangan, petugas)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (tanggal, nomor_kamar) DO UPDATE
      SET waktu_masuk=$3, waktu_keluar=$4, keterangan=$5
    `, [tanggal, kamar, waktu_masuk || null, waktu_keluar || null, keterangan || '', req.session.user.nama]);

    if (waktu_keluar) {
      await pool.query("UPDATE tugas SET selesai = true WHERE tanggal = $1 AND kamar = $2", [tanggal, kamar]);
    }
    res.redirect('/ra?pesan=berhasil');
  } catch (err) {
    console.error("Laporan Error:", err);
    res.redirect('/ra?pesan=gagal');
  }
});

// === LOGOUT ===
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.listen(PORT, () => {
  console.log(`✅ Server berjalan di http://localhost:${PORT}`);
});
