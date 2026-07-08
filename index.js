const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const path = require('path');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8888;

// =============================================
// Koneksi Database PostgreSQL
// =============================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

pool.connect()
  .then(() => console.log("✅ Koneksi Database berhasil"))
  .catch(err => console.error("❌ Koneksi Database gagal:", err));

// =============================================
// Konfigurasi Aplikasi
// =============================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'hotel-horison-serang-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// =============================================
// Pesan Notifikasi Global
// =============================================
app.use((req, res, next) => {
  if (req.query.pesan === 'berhasil') {
    res.locals.pesan = { tipe: 'sukses', teks: '✅ Berhasil menyimpan data' };
  } else if (req.query.pesan === 'gagal') {
    res.locals.pesan = { tipe: 'error', teks: '❌ Gagal menyimpan data, coba lagi' };
  } else {
    res.locals.pesan = null;
  }
  next();
});

// =============================================
// Rute Utama & Login
// =============================================
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
    const hasil = await pool.query("SELECT * FROM pengguna WHERE username = $1", [username.trim()]);
    const pengguna = hasil.rows[0];

    if (pengguna && password === pengguna.sandi) {
      req.session.user = pengguna;
      if (pengguna.peran === 'SPV') return res.redirect('/spv');
      if (pengguna.peran === 'RA') return res.redirect('/ra');
      if (pengguna.peran === 'OT') return res.redirect('/ot');
    }
    res.render('login', { pesan: '❌ Username atau kata sandi salah!' });
  } catch (err) {
    console.error("Login Error:", err);
    res.render('login', { pesan: '❌ Terjadi kesalahan sistem' });
  }
});

// =============================================
// Rute Panel Supervisor
// =============================================
app.get('/spv', async (req, res) => {
  if (!req.session.user || req.session.user.peran !== 'SPV') return res.redirect('/');
  try {
    const hariIni = new Date().toISOString().split('T')[0];

    // Ambil semua kamar yang aktif
    const kamar = await pool.query(`
      SELECT nomor_kamar, lantai, tipe_kamar FROM kamar 
      WHERE aktif = true 
      ORDER BY nomor_kamar ASC
    `);

    // Ambil tugas dan laporan hari ini
    const tugas = await pool.query(`
      SELECT 
        t.tanggal, t.kamar, t.status_awal, t.petugas, t.selesai,
        l.waktu_masuk, l.waktu_keluar
      FROM tugas t
      LEFT JOIN laporan l 
        ON t.tanggal = l.tanggal AND t.kamar = l.nomor_kamar
      WHERE t.tanggal = $1
    `, [hariIni]);

    // Gabungkan data
    const daftarKamar = kamar.rows.map(k => {
      const dataTugas = tugas.rows.find(t => t.kamar === k.nomor_kamar);
      return {
        ...k,
        status_awal: dataTugas?.status_awal || null,
        petugas: dataTugas?.petugas || null,
        selesai: dataTugas?.selesai || false,
        waktu_masuk: dataTugas?.waktu_masuk || null,
        waktu_keluar: dataTugas?.waktu_keluar || null
      };
    });

    res.render('spv', {
      user: req.session.user,
      daftarKamar,
      tanggal: hariIni,
      pesan: res.locals.pesan
    });
  } catch (err) {
    console.error("Error SPV:", err);
    res.render('spv', {
      user: req.session.user,
      daftarKamar: [],
      tanggal: new Date().toISOString().split('T')[0],
      pesan: { tipe: 'error', teks: '❌ Gagal memuat daftar kamar' }
    });
  }
});

// Simpan tugas dari Supervisor
app.post('/tambah-tugas-banyak', async (req, res) => {
  if (!req.session.user || req.session.user.peran !== 'SPV') return res.redirect('/');
  try {
    const { tanggal, petugas, kamar } = req.body;
    if (!kamar || !tanggal || !petugas) {
      return res.redirect('/spv?pesan=gagal');
    }

    const daftarKamar = Array.isArray(kamar) ? kamar : [kamar];

    for (const nomorKamar of daftarKamar) {
      const status = req.body[`status_${nomorKamar}`] || 'VC';
      await pool.query(`
        INSERT INTO tugas (tanggal, kamar, petugas, status_awal, selesai)
        VALUES ($1, $2, $3, $4, false)
        ON CONFLICT (tanggal, kamar) 
        DO UPDATE SET petugas = $3, status_awal = $4, selesai = false
      `, [tanggal, nomorKamar, petugas, status]);
    }

    res.redirect('/spv?pesan=berhasil');
  } catch (err) {
    console.error("Error Simpan Tugas:", err);
    res.redirect('/spv?pesan=gagal');
  }
});

// =============================================
// Rute Panel Room Attendant
// =============================================
app.get('/ra', async (req, res) => {
  if (!req.session.user || req.session.user.peran !== 'RA') return res.redirect('/');
  try {
    const hariIni = new Date().toISOString().split('T')[0];
    const namaPetugas = req.session.user.nama;

    const hasil = await pool.query(`
      SELECT 
        t.tanggal, t.kamar, t.status_awal,
        l.waktu_masuk, l.waktu_keluar, l.linen, l.amenities, l.keterangan
      FROM tugas t
      LEFT JOIN laporan l 
        ON t.tanggal = l.tanggal AND t.kamar = l.nomor_kamar
      WHERE t.tanggal = $1 AND t.petugas = $2
      ORDER BY t.kamar ASC
    `, [hariIni, namaPetugas]);

    res.render('ra', {
      user: req.session.user,
      tugas: hasil.rows,
      pesan: res.locals.pesan
    });
  } catch (err) {
    console.error("Error RA:", err);
    res.redirect('/?pesan=gagal');
  }
});

// Simpan laporan kebersihan
app.post('/simpan-laporan', async (req, res) => {
  if (!req.session.user || req.session.user.peran !== 'RA') return res.redirect('/');
  try {
    const {
      tanggal, kamar, waktu_masuk, waktu_keluar,
      sheet_double, sheet_single, duvet_double, duvet_single,
      bath_towel, hand_towel, bath_mat, pillow_case,
      tissue, hand_soap, shampoo, shower_gel, tooth_brush,
      sterilizer, shower_cap, slipper, laundry_bag, laundry_list,
      memo_pad, pencil, plastic_bin, tissue_box, coffee, sugar,
      tea, creamer, mineral_water, keterangan
    } = req.body;

    // Data Linen
    const linen = {
      sheet_double: Number(sheet_double) || 0,
      sheet_single: Number(sheet_single) || 0,
      duvet_double: Number(duvet_double) || 0,
      duvet_single: Number(duvet_single) || 0,
      bath_towel: Number(bath_towel) || 0,
      hand_towel: Number(hand_towel) || 0,
      bath_mat: Number(bath_mat) || 0,
      pillow_case: Number(pillow_case) || 0
    };

    // Data Amenities
    const amenities = {
      tissue: Number(tissue) || 0,
      hand_soap: Number(hand_soap) || 0,
      shampoo: Number(shampoo) || 0,
      shower_gel: Number(shower_gel) || 0,
      tooth_brush: Number(tooth_brush) || 0,
      sterilizer: Number(sterilizer) || 0,
      shower_cap: Number(shower_cap) || 0,
      slipper: Number(slipper) || 0,
      laundry_bag: Number(laundry_bag) || 0,
      laundry_list: Number(laundry_list) || 0,
      memo_pad: Number(memo_pad) || 0,
      pencil: Number(pencil) || 0,
      plastic_bin: Number(plastic_bin) || 0,
      tissue_box: Number(tissue_box) || 0,
      coffee: Number(coffee) || 0,
      sugar: Number(sugar) || 0,
      tea: Number(tea) || 0,
      creamer: Number(creamer) || 0,
      mineral_water: Number(mineral_water) || 0
    };

    // Simpan / Update laporan
    await pool.query(`
      INSERT INTO laporan (
        tanggal, nomor_kamar, shift, status_kamar,
        waktu_masuk, waktu_keluar, linen, amenities, keterangan, petugas
      )
      VALUES ($1, $2, 'Morning', $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (tanggal, nomor_kamar)
      DO UPDATE SET
        waktu_masuk = $4, waktu_keluar = $5, linen = $6, amenities = $7,
        keterangan = $8, petugas = $9
    `, [
      tanggal, kamar, 'HK',
      waktu_masuk || null, waktu_keluar || null,
      JSON.stringify(linen), JSON.stringify(amenities),
      keterangan?.trim() || '', req.session.user.nama
    ]);

    // Tandai tugas selesai jika ada waktu keluar
    if (waktu_keluar) {
      await pool.query(`
        UPDATE tugas SET selesai = true 
        WHERE tanggal = $1 AND kamar = $2
      `, [tanggal, kamar]);
    }

    res.redirect('/ra?pesan=berhasil');
  } catch (err) {
    console.error("Error Simpan Laporan:", err);
    res.redirect('/ra?pesan=gagal');
  }
});

// =============================================
// FITUR UNDUH LAPORAN (DIPERBAIKI AGAR TIDAK KOSONG)
// =============================================
app.get('/unduh', async (req, res) => {
  if (!req.session.user || req.session.user.peran !== 'SPV') return res.redirect('/');
  try {
    // Ambil semua laporan lengkap + gabungkan info kamar
    const hasil = await pool.query(`
      SELECT 
        l.tanggal, l.nomor_kamar, k.lantai, k.tipe_kamar,
        l.shift, l.status_kamar, l.waktu_masuk, l.waktu_keluar,
        l.linen, l.amenities, l.keterangan, l.petugas
      FROM laporan l
      LEFT JOIN kamar k ON l.nomor_kamar = k.nomor_kamar
      ORDER BY l.tanggal DESC, l.nomor_kamar ASC
    `);

    if (hasil.rows.length === 0) {
      return res.redirect('/spv?pesan=gagal&teks=Belum ada data laporan');
    }

    // Proses data agar terbaca rapi di CSV
    const dataUntukCsv = hasil.rows.map(item => {
      const linen = item.linen ? JSON.parse(item.linen) : {};
      const amen = item.amenities ? JSON.parse(item.amenities) : {};

      return {
        tanggal: item.tanggal,
        nomor_kamar: item.nomor_kamar,
        lantai: item.lantai || '-',
        tipe_kamar: item.tipe_kamar || '-',
        shift: item.shift,
        status_kamar: item.status_kamar,
        waktu_masuk: item.waktu_masuk || '-',
        waktu_keluar: item.waktu_keluar || '-',
        linen: `Sheet D:${linen.sheet_double || 0} | Sheet S:${linen.sheet_single || 0} | Duvet D:${linen.duvet_double || 0} | Duvet S:${linen.duvet_single || 0} | BT:${linen.bath_towel || 0} | HT:${linen.hand_towel || 0} | BM:${linen.bath_mat || 0} | Pillow:${linen.pillow_case || 0}`,
        amenities: `Tissue:${amen.tissue || 0} | Soap:${amen.hand_soap || 0} | Shampoo:${amen.shampoo || 0} | Gel:${amen.shower_gel || 0} | Sikat:${amen.tooth_brush || 0} | Air:${amen.mineral_water || 0}`,
        keterangan: item.keterangan || '-',
        petugas: item.petugas
      };
    });

    const namaFile = `Laporan_HK_Horison_${new Date().toISOString().slice(0, 10)}.csv`;
    const jalurFile = path.join(__dirname, 'public', namaFile);

    // Tulis file CSV
    const csvWriter = createCsvWriter({
      path: jalurFile,
      header: [
        { id: 'tanggal', title: 'Tanggal' },
        { id: 'nomor_kamar', title: 'Nomor Kamar' },
        { id: 'lantai', title: 'Lantai' },
        { id: 'tipe_kamar', title: 'Tipe Kamar' },
        { id: 'shift', title: 'Shift' },
        { id: 'status_kamar', title: 'Status' },
        { id: 'waktu_masuk', title: 'Waktu Masuk' },
        { id: 'waktu_keluar', title: 'Waktu Keluar' },
        { id: 'linen', title: 'Linen Digunakan' },
        { id: 'amenities', title: 'Perlengkapan' },
        { id: 'keterangan', title: 'Keterangan' },
        { id: 'petugas', title: 'Petugas' }
      ],
      fieldDelimiter: ';'
    });

    await csvWriter.writeRecords(dataUntukCsv);

    // Kirim file ke pengguna
    res.download(jalurFile, namaFile, (err) => {
      if (err) console.error("Error unduh:", err);
      // Hapus file sementara setelah terkirim
      fs.unlink(jalurFile, () => {});
    });

  } catch (err) {
    console.error("Error Unduh Laporan:", err);
    res.redirect('/spv?pesan=gagal');
  }
});

// =============================================
// Rute Lainnya
// =============================================
app.get('/ot', async (req, res) => {
  if (!req.session.user || req.session.user.peran !== 'OT') return res.redirect('/');
  try {
    const hasil = await pool.query(`
      SELECT * FROM request_tamu 
      WHERE petugas = $1 
      ORDER BY tanggal DESC, jam DESC
    `, [req.session.user.nama]);
    res.render('ot', { user: req.session.user, daftarRequest: hasil.rows, pesan: res.locals.pesan });
  } catch (err) {
    console.error("Error OT:", err);
    res.render('ot', { user: req.session.user, daftarRequest: [], pesan: { tipe: 'error', teks: '❌ Gagal memuat data' } });
  }
});

app.post('/simpan-request', async (req, res) => {
  if (!req.session.user || req.session.user.peran !== 'OT') return res.redirect('/');
  try {
    const { tanggal, jam, nomor_kamar, barang, status } = req.body;
    await pool.query(`
      INSERT INTO request_tamu (tanggal, jam, nomor_kamar, barang, status, petugas)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [tanggal, jam, nomor_kamar, barang, status, req.session.user.nama]);
    res.redirect('/ot?pesan=berhasil');
  } catch (err) {
    console.error("Error Simpan Request:", err);
    res.redirect('/ot?pesan=gagal');
  }
});

app.get('/ubah-status/:id', async (req, res) => {
  if (!req.session.user || req.session.user.peran !== 'OT') return res.redirect('/');
  try {
    await pool.query(`
      UPDATE request_tamu SET status = 'Selesai' 
      WHERE id = $1 AND petugas = $2
    `, [req.params.id, req.session.user.nama]);
    res.redirect('/ot');
  } catch (err) {
    console.error("Error Ubah Status:", err);
    res.redirect('/ot?pesan=gagal');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// =============================================
// Jalankan Server
// =============================================
app.listen(PORT, () => {
  console.log(`🚀 Server berjalan di port ${PORT}`);
});
