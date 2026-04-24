// src/controllers/faceController.ts
import { Request, Response } from "express";
import { prisma } from "../index"; // Mengambil koneksi database dari index.ts
import { getFaceEmbedding } from "../utils/faceUtil";
import fs from "fs";

export const registerFace = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { name } = req.body;
    const file = req.file;

    // 1. Validasi Input
    if (!name || !file) {
      res.status(400).json({ error: "Nama dan foto wajah wajib dikirim!" });
      return;
    }

    const imagePath = file.path;

    // Ekstraksi Vektor Menggunakan AI Asli
    const embeddingArray = await getFaceEmbedding(imagePath);

    if (!embeddingArray) {
      // Jika AI tidak menemukan wajah manusia di dalam foto
      res
        .status(400)
        .json({ error: "Wajah tidak terdeteksi pada gambar yang diunggah!" });
      return;
    }

    // Mengubah array menjadi string format vektor PostgreSQL: "[0.123, -0.456, ...]"
    const embeddingString = `[${embeddingArray.join(",")}]`;

    // 3. Simpan ke Database menggunakan Raw SQL
    await prisma.$executeRaw`
      INSERT INTO "FaceData" (name, "imagePath", embedding) 
      VALUES (${name}, ${imagePath}, ${embeddingString}::vector)
    `;

    // 4. Kirim Umpan Balik (Feedback) ke Flutter
    res.status(201).json({
      success: true,
      message: "Registrasi wajah user berhasil disimpan!",
      data: { name, imagePath },
    });
  } catch (error) {
    console.error("Error saat registrasi:", error);
    res
      .status(500)
      .json({ success: false, error: "Terjadi kesalahan pada server" });
  }
};

// Endpoint Pengenalan Wajah & Absensi
export const recognizeFace = async (req: Request, res: Response): Promise<void> => {
  try {
    const file = req.file;
    // Menerima nilai EAR dari Liveness Detection Flutter
    const earValue = parseFloat(req.body.earValue); 

    // 1. Validasi Input
    if (!file || isNaN(earValue)) {
      if (file) fs.unlinkSync(file.path); // Hapus foto jika data tidak lengkap
      res.status(400).json({ error: 'Foto wajah dan nilai EAR wajib dikirim!' });
      return;
    }

    const imagePath = file.path;

    // 2. Ekstraksi Vektor dari Foto Absensi
    const embeddingArray = await getFaceEmbedding(imagePath);

    if (!embeddingArray) {
      fs.unlinkSync(imagePath); // Hapus foto karena tidak ada wajah terdeteksi
      res.status(400).json({ error: 'Wajah tidak terdeteksi pada gambar yang diunggah!' });
      return;
    }

    const embeddingString = `[${embeddingArray.join(',')}]`;

    // 3. Pencarian Kemiripan dengan pgvector (Euclidean Distance)
    // Operator <-> akan menghitung jarak vektor gambar baru dengan semua data di FaceData.
    // LIMIT 1 akan mengambil 1 data yang jaraknya paling dekat (paling mirip).
    const result: any = await prisma.$queryRaw`
      SELECT id, name, (embedding <-> ${embeddingString}::vector) as distance
      FROM "FaceData"
      ORDER BY distance ASC
      LIMIT 1;
    `;

    if (!result || result.length === 0) {
      fs.unlinkSync(imagePath);
      res.status(404).json({ error: 'Belum ada data master wajah di database.' });
      return;
    }

    const bestMatch = result[0];
    
    // THRESHOLD (Ambang Batas)
    // Nilai 0.5 adalah standar umum yang aman. Jika jarak < 0.5, dianggap orang yang sama.
    // Jika nanti saat sidang skripsi sistem sering salah kenali orang, turunkan nilainya (misal 0.4).
    const THRESHOLD = 0.5; 

    // 4. Keputusan Identitas
    if (bestMatch.distance < THRESHOLD) {
      // Wajah Cocok -> Catat Log Absensi
      await prisma.attendanceLog.create({
        data: {
          faceId: bestMatch.id,
          earValue: earValue,
          similarityScore: bestMatch.distance, 
        }
      });

      fs.unlinkSync(imagePath); // Bersihkan file foto absen dari server
      
      res.status(200).json({
        success: true,
        message: `Absensi berhasil! Selamat datang, ${bestMatch.name}.`,
        data: {
          name: bestMatch.name,
          distance: bestMatch.distance,
          earValue: earValue
        }
      });
    } else {
      // Wajah Tidak Dikenali (Jarak lebih besar dari Threshold)
      fs.unlinkSync(imagePath); // Bersihkan file
      res.status(401).json({
        success: false,
        message: 'Wajah tidak dikenali! Identitas tidak cocok dengan database.',
        distance: bestMatch.distance // Berguna untuk pemantauan error saat skripsi
      });
    }

  } catch (error) {
    console.error('Error saat pengenalan wajah:', error);
    if (req.file) fs.unlinkSync(req.file.path); // Keamanan ekstra: hapus file jika terjadi error server
    res.status(500).json({ success: false, error: 'Terjadi kesalahan pada server' });
  }
};

// Endpoint untuk mengambil Daftar Wajah (Daftar Anggota)
export const getFaces = async (req: Request, res: Response): Promise<void> => {
  try {
    // Kita hanya mengambil id, nama, dan path gambar. 
    // Vektor 128-dimensi sengaja TIDAK DIAMBIL agar tidak membuat aplikasi Flutter menjadi lambat.
    const faces = await prisma.$queryRaw`
      SELECT id, name, "imagePath", "createdAt" 
      FROM "FaceData" 
      ORDER BY "createdAt" DESC
    `;

    res.status(200).json({
      success: true,
      data: faces
    });
  } catch (error) {
    console.error('Error saat mengambil daftar wajah:', error);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan pada server' });
  }
};

// API GET LOGS (Diperbarui dengan Filter Tanggal & Statistik)
export const getLogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;
    let start: Date; let end: Date;

    if (startDate && endDate) {
      start = new Date(startDate as string); start.setHours(0, 0, 0, 0);
      end = new Date(endDate as string); end.setHours(23, 59, 59, 999);
    } else {
      const today = new Date();
      start = new Date(today); start.setHours(0, 0, 0, 0);
      end = new Date(today); end.setHours(23, 59, 59, 999);
    }

    // 1. Ambil semua riwayat absen
    const logs: any[] = await prisma.$queryRaw`
      SELECT a.id, a."faceId", a.timestamp, a."earValue", a."similarityScore", f.name
      FROM "AttendanceLog" a JOIN "FaceData" f ON a."faceId" = f.id
      WHERE a.timestamp >= ${start} AND a.timestamp <= ${end}
      ORDER BY a.timestamp DESC;
    `;

    // 2. Ambil SEMUA data anggota terdaftar untuk mencari tahu siapa yang TIDAK hadir
    const allUsers: any[] = await prisma.$queryRaw`SELECT id, name FROM "FaceData" ORDER BY name ASC;`;

    // 3. Proses Pengelompokan (Drill-Down)
    const earliestLogs = new Map<number, { time: Date, name: string }>();
    
    // Cari jam absen PERTAMA untuk setiap orang di rentang tanggal tersebut
    logs.forEach(log => {
      const logDate = new Date(log.timestamp);
      if (!earliestLogs.has(log.faceId)) {
        earliestLogs.set(log.faceId, { time: logDate, name: log.name });
      } else {
        if (logDate < earliestLogs.get(log.faceId)!.time) {
          earliestLogs.set(log.faceId, { time: logDate, name: log.name });
        }
      }
    });

    // Siapkan array kosong untuk menyimpan nama-nama
    const presentList: any[] = [];
    const lateList: any[] = [];
    const absentList: any[] = [];
    
    // Pisahkan yang Hadir dan Terlambat
    earliestLogs.forEach((value, faceId) => {
      const isLate = value.time.getHours() >= 8;
      const userData = { id: faceId, name: value.name, time: value.time };
      
      presentList.push(userData);
      if (isLate) lateList.push(userData);
    });

    // Cari yang Absen (Orang yang ada di 'allUsers', tapi tidak ada di 'earliestLogs')
    allUsers.forEach(user => {
      if (!earliestLogs.has(user.id)) {
        absentList.push({ id: user.id, name: user.name });
      }
    });

    // 4. Kirim Balikan JSON Super Lengkap
    res.status(200).json({
      success: true,
      summary: {
        totalRegistered: allUsers.length,
        totalPresent: presentList.length,
        totalLate: lateList.length,
        totalAbsent: absentList.length,
        // Ini Data Rahasia untuk memunculkan Pop-up di Flutter
        details: {
          registered: allUsers,
          present: presentList,
          late: lateList,
          absent: absentList
        }
      },
      period: { start, end },
      data: logs
    });
  } catch (error) {
    console.error('Error saat mengambil log:', error);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan pada server' });
  }
};

// API DELETE LOG (Menghapus satu baris histori absensi)
export const deleteLog = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    // Paksa TypeScript membacanya sebagai teks murni lalu ubah ke Angka
    const numericId = parseInt(id as string, 10);

    // Hapus log dari database
    await prisma.$executeRaw`
      DELETE FROM "AttendanceLog" WHERE id = ${numericId};
    `;

    res.status(200).json({ 
      success: true, 
      message: 'Satu baris riwayat absensi berhasil dihapus!' 
    });
  } catch (error) {
    console.error('Error saat menghapus log:', error);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan pada server' });
  }
};

// Endpoint untuk Edit Nama Anggota (UPDATE)
export const updateFace = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    // PAKSA TYPESCRIPT BACA SEBAGAI STRING MURNI
    const numericId = parseInt(id as string, 10);

    if (!name) {
      res.status(400).json({ error: 'Nama baru tidak boleh kosong!' });
      return;
    }

    const result: any = await prisma.$queryRaw`
      UPDATE "FaceData" 
      SET name = ${name} 
      WHERE id = ${numericId} 
      RETURNING id, name, "imagePath";
    `;

    if (!result || result.length === 0) {
      res.status(404).json({ error: 'Data anggota tidak ditemukan.' });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Nama anggota berhasil diperbarui!',
      data: result[0]
    });
  } catch (error) {
    console.error('Error saat update wajah:', error);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan pada server' });
  }
};

// Endpoint untuk Hapus Anggota (DELETE) beserta File Fotonya
export const deleteFace = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // PAKSA TYPESCRIPT BACA SEBAGAI STRING MURNI
    const numericId = parseInt(id as string, 10);

    // 1. Cari data anggota menggunakan numericId
    const face: any = await prisma.$queryRaw`
      SELECT id, "imagePath" FROM "FaceData" WHERE id = ${numericId};
    `;

    if (!face || face.length === 0) {
      res.status(404).json({ error: 'Data anggota tidak ditemukan.' });
      return;
    }

    const imagePath = face[0].imagePath;

    // 2. Hapus log absensi terlebih dahulu (menghindari Foreign Key error)
    await prisma.attendanceLog.deleteMany({
      where: { faceId: numericId }
    });

    // 3. Hapus data anggota
    await prisma.$executeRaw`
      DELETE FROM "FaceData" WHERE id = ${numericId};
    `;

    // 4. Hapus file foto dari server (baris import fs-nya sudah dihapus dari sini)
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }

    res.status(200).json({ 
      success: true, 
      message: 'Data anggota beserta foto fisiknya berhasil dihapus bersih!' 
    });
  } catch (error) {
    console.error('Error saat menghapus wajah:', error);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan pada server' });
  }
};