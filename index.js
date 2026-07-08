const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8888;

// Koneksi Database KHUSUS RAILWAY
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Cek koneksi
pool.connect((err) => {
  if (err) console.error("❌ DB Gagal:", err);
  else console.log("✅ DB Terhubung");
});

// Konfigurasi Dasar
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'horison-hotel-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 86400000 }
}));

// HALAMAN LOGIN
app.get('/', (req, res) => {
  if (req.session.user) {
    if (req.session.user.peran === 'SPV') return res.redirect('/spv');
    if (req.session.user.peran === 'RA') return res.redirect('/ra');
    if (req.session.user.peran === 'OT') return res.redirect('/ot');
  }
  res.render('login', { pesan: null });
});

app.get('/login', (req, res) => {
  res.redirect('/');
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
      req.session.user = { nama: user.nama, peran: user.peran };
      if (user.peran === 'SPV') return res.redirect('/spv');
      if (user.peran === 'RA') return res.redirect('/ra');
      if (user.peran === 'OT') return res.redirect('/ot');
    } else {
      res.render('login', { pesan: '❌ Username atau sandi salah' });
    }
  } catch (err) {
    console.error("Login Error:", err);
    res.render('login', { pesan: '❌ Kesalahan sistem, coba lagi' });
  }
});

// HALAMAN SUPERVISOR
app.get('/spv', async (req, res) => {
  if (!req.session.user || req.session.user.peran !== 'SPV') return res.redirect('/');
  try {
    const hariIni = new Date().toISOString().split('T')[0];
    const kamar = await pool.query("SELECT * FROM kamar ORDER BY nomor_kamar");
    const ra = await pool.query("SELECT nama FROM pengguna WHERE peran = 'RA' AND aktif = true ORDER BY nama");
    const tugas = await pool.query("SELECT * FROM tugas WHERE tanggal = $1 ORDER BY kamar", [hariIni]);

    res.render('spv', {
      user: req.session.user,
      tanggal: hariIni,
      daftarKamar: kamar.rows,
      daftarRA: ra.rows,
      daftarTugas: tugas.rows
    });
  } catch (err) {
    console.error("SPV Error:", err);
    res.redirect('/?pesan=gagal');
  }
});

// HALAMAN ROOMBOY
app.get('/ra', async (req, res) => {
  if (!req.session.user || req.session.user.peran !== 'RA') return res.redirect('/');
  try {
    const hariIni = new Date().toISOString().split('T')[0];
    const tugas = await pool.query(`
      SELECT t.*, l.waktu_masuk, l.waktu_keluar, l.keterangan
      FROM tugas t LEFT JOIN laporan l ON t.tanggal = l.tanggal AND t.kamar = l.nomor_kamar
      WHERE t.tanggal = $1 AND t.petugas = $2 ORDER BY kamar
    `, [hariIni, req.session.user.nama]);
    res.render('ra', { user: req.session.user, tugas: tugas.rows });
  } catch (err) {
    console.error("RA Error:", err);
    res.redirect('/');
  }
});

// LOGOUT
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.listen(PORT, () => console.log(`✅ Server berjalan di port ${PORT}`));
