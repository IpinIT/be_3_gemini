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

// Endpoint untuk mengambil Log Absensi
export const getLogs = async (req: Request, res: Response): Promise<void> => {
  try {
    // Kita menggunakan Prisma Client biasa karena tidak ada urusan dengan pgvector di sini
    const logs = await prisma.attendanceLog.findMany({
      orderBy: {
        timestamp: 'desc' // Urutkan dari absen terbaru ke terlama
      },
      include: {
        faceData: {
          select: {
            name: true // Ambil nama anggota dari tabel FaceData yang berelasi
          }
        }
      }
    });

    // Merapikan format respons agar mudah dibaca oleh Flutter
    const formattedLogs = logs.map(log => ({
      id: log.id,
      name: log.faceData.name, // Nama langsung dimunculkan di depan
      timestamp: log.timestamp,
      earValue: log.earValue,
      similarityScore: log.similarityScore
    }));

    res.status(200).json({
      success: true,
      data: formattedLogs
    });
  } catch (error) {
    console.error('Error saat mengambil log absensi:', error);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan pada server' });
  }
};